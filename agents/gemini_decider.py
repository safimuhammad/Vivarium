r"""Cloud :class:`~agents.decider.Decider` backed by the Google Gen AI SDK.

The drop-in counterpart to :class:`agents.decider.OllamaDecider`: it satisfies the
same :class:`~agents.decider.Decider` protocol so the breathing loop is unchanged,
but thinks via a hosted Gemini model (e.g. ``gemini-3.1-flash-lite``) instead of a
local one. This removes the two limits the local path hit on a single Mac -- the
memory/swap ceiling and Ollama's *sequential* inference -- so agents can breathe
concurrently and a run can go longer.

The seam is identical in spirit to the Ollama decider:

* The request/response *translation* is split into small, pure, network-free
  functions (:func:`to_gemini_tools`, :func:`gemini_system_instruction`,
  :func:`to_gemini_contents`, :func:`parse_gemini_response`) so they are unit-tested
  without a key or a network -- mirroring :func:`agents.decider.parse_ollama_response`.
* :class:`GeminiDecider` makes a single, time-bounded async call; its model client is
  injectable (tests pass a fake), and the only line that touches the real SDK/network
  is the lazy client construction (excluded from coverage).

Our chat history and tool schemas are OpenAI/Ollama-shaped; Gemini's request shape
differs (roles ``user``/``model``/``tool``; ``function_call`` / ``function_response``
parts; the system prompt is a separate ``system_instruction``), so the translators
below are where that impedance mismatch is resolved -- in one tested place.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Protocol, cast

from google.genai import types

from agents.decider import DECIDE_TIMEOUT_SECONDS, Decision, ToolCall

#: Environment variable the API key is read from when no key is injected. The key is
#: never hardcoded or logged; in this repo it lives in a gitignored ``.env`` loaded by
#: the runner (see ``scripts/run.py``).
GEMINI_API_KEY_ENV: str = "GEMINI_API_KEY"

#: Sampling temperature for the hosted model. 1.0 is Gemini 3's recommended default
#: (lowering it can degrade the model's reasoning); kept explicit for reproducible intent.
DEFAULT_TEMPERATURE: float = 1.0
#: Reasoning effort per decision (:class:`google.genai.types.ThinkingLevel`). ``"LOW"``
#: suits a single perceive->act breath (fact-retrieval tier), keeping thinking-token cost
#: and latency down; raise it for deeper deliberation.
DEFAULT_THINKING_LEVEL: str = "LOW"


def to_gemini_tools(tools: list[dict[str, Any]]) -> list[types.Tool]:
    """Translate OpenAI/Ollama tool schemas into Gemini tool declarations.

    Each input schema is ``{"type": "function", "function": {"name", "description",
    "parameters": <JSON Schema>}}`` (our :data:`agents.tool_schemas.TOOL_SCHEMAS`
    shape). Gemini groups declarations under a single :class:`google.genai.types.Tool`;
    the JSON-Schema parameters pass through verbatim via ``parameters_json_schema`` (the
    SDK's standard-JSON-Schema entry point), so no per-type rewriting is needed.

    Args:
        tools: Tool schemas offered to the model (Ollama function format); may be empty
            (e.g. the reflection narrative call offers no tools).

    Returns:
        A single-element ``[Tool]`` carrying one ``FunctionDeclaration`` per input, or an
        empty list when ``tools`` is empty (so the caller can omit ``tools`` entirely).
    """
    if not tools:
        return []
    declarations = [
        types.FunctionDeclaration(
            name=tool["function"]["name"],
            description=tool["function"].get("description", ""),
            parameters_json_schema=tool["function"].get("parameters"),
        )
        for tool in tools
    ]
    return [types.Tool(function_declarations=declarations)]


def gemini_system_instruction(messages: list[dict[str, Any]]) -> str | None:
    """Extract the system-prompt text Gemini takes as a separate ``system_instruction``.

    Our history carries the system prompt as a ``{"role": "system"}`` message, but
    Gemini does not accept a ``system`` role in ``contents`` -- the system prompt is a
    top-level config field. Any system messages (normally just one) are joined.

    Args:
        messages: The chat-style message history.

    Returns:
        The joined system text, or ``None`` if there is no system message.
    """
    parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
    return "\n\n".join(parts) if parts else None


def to_gemini_contents(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Translate chat history into Gemini ``contents`` (system handled separately).

    Role mapping: ``user`` -> ``user`` (text part); ``assistant`` -> ``model`` (text
    part and/or one ``function_call`` part per tool call); ``tool`` (a tool result) ->
    ``tool`` (a ``function_response`` part naming the tool and wrapping its string
    result). ``system`` messages are dropped here (see :func:`gemini_system_instruction`).

    Args:
        messages: The chat-style message history (see the module docstring for the
            exact per-role dict shapes produced by the breathing loop).

    Returns:
        Gemini ``contents``: a list of ``{"role", "parts"}`` dicts the SDK accepts.
    """
    contents: list[dict[str, Any]] = []
    for message in messages:
        match message.get("role"):
            case "system":
                continue
            case "user":
                contents.append({"role": "user", "parts": [{"text": message.get("content", "")}]})
            case "assistant":
                parts: list[dict[str, Any]] = []
                if text := message.get("content", ""):
                    parts.append({"text": text})
                for call in message.get("tool_calls", []):
                    function = call["function"]
                    parts.append(
                        {
                            "function_call": {
                                "name": function["name"],
                                "args": function.get("arguments", {}),
                            }
                        }
                    )
                if not parts:  # a model turn must carry at least one part
                    parts.append({"text": ""})
                contents.append({"role": "model", "parts": parts})
            case "tool":
                contents.append(
                    {
                        "role": "tool",
                        "parts": [
                            {
                                "function_response": {
                                    "name": message.get("tool_name", ""),
                                    "response": {"result": message.get("content", "")},
                                }
                            }
                        ],
                    }
                )
    return contents


def parse_gemini_response(response: Any) -> Decision:
    """Map a Gemini ``generate_content`` response into a :class:`Decision` (pure).

    Tolerates missing optional fields so it works against both the real SDK response
    and lightweight test doubles (the same duck-typed approach as
    :func:`agents.decider.parse_ollama_response`). Text parts become
    :attr:`Decision.text` (``thought`` parts, when present, become
    :attr:`Decision.thinking`); each ``function_call`` part becomes a
    :class:`~agents.decider.ToolCall`; ``usage_metadata.prompt_token_count`` becomes
    :attr:`Decision.prompt_tokens` (the compaction safety net) and
    ``usage_metadata.candidates_token_count`` becomes
    :attr:`Decision.completion_tokens` (for cost/observability).

    Args:
        response: A Gemini response (or a structurally compatible double) exposing
            ``candidates[0].content.parts`` (each part exposing ``text`` /
            ``function_call`` / optional ``thought``) and ``usage_metadata``.

    Returns:
        The parsed :class:`Decision`; an empty one if there are no candidates.
    """
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return Decision()

    content = getattr(candidates[0], "content", None)
    parts = (getattr(content, "parts", None) or []) if content is not None else []

    text_chunks: list[str] = []
    thinking_chunks: list[str] = []
    tool_calls: list[ToolCall] = []
    for part in parts:
        function_call = getattr(part, "function_call", None)
        if function_call is not None:
            name = getattr(function_call, "name", "") or ""
            args = getattr(function_call, "args", None) or {}
            tool_calls.append(
                ToolCall(name=name, params=dict(args), id=getattr(function_call, "id", None))
            )
            continue
        if part_text := (getattr(part, "text", None) or ""):
            if getattr(part, "thought", False):
                thinking_chunks.append(part_text)
            else:
                text_chunks.append(part_text)

    prompt_tokens = 0
    completion_tokens = 0
    if (usage := getattr(response, "usage_metadata", None)) is not None:
        prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
        completion_tokens = getattr(usage, "candidates_token_count", 0) or 0

    return Decision(
        text="".join(text_chunks),
        thinking="".join(thinking_chunks),
        tool_calls=tool_calls,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


class _GeminiModels(Protocol):
    """Minimal async surface :class:`GeminiDecider` depends on.

    ``genai.Client(...).aio.models`` satisfies this structurally, as does a test
    double -- the same "depend on a seam" approach as
    :class:`agents.decider._ChatClient`, so the decider is unit-tested without a key.
    """

    async def generate_content(self, **kwargs: Any) -> Any:
        """Send one content-generation request and return the provider's response."""
        ...


class GeminiDecider:
    """Production :class:`~agents.decider.Decider` backed by a hosted Gemini model.

    Makes a single, non-streaming, time-bounded ``generate_content`` call per decision
    and parses the result with :func:`parse_gemini_response`. The call is bounded by
    :attr:`timeout` (default :data:`agents.decider.DECIDE_TIMEOUT_SECONDS`): a wedged
    request raises ``TimeoutError`` rather than hanging the breathing loop, which the
    loop already absorbs as a failed breath and backs off.

    Unlike the Ollama path it is **not** wrapped in
    :class:`~agents.decider.SerializingDecider`: a hosted API serves requests in
    parallel, so all agents may breathe concurrently. The model client is injectable so
    behaviour is unit-testable without a key or network; in production the client is
    lazily constructed from :data:`GEMINI_API_KEY_ENV`.

    Attributes:
        model: Hosted model name to query (e.g. ``"gemini-3.1-flash-lite"``).
        timeout: Per-decision wall-clock budget in seconds.
    """

    def __init__(
        self,
        model: str,
        *,
        api_key: str | None = None,
        timeout: float = DECIDE_TIMEOUT_SECONDS,
        temperature: float = DEFAULT_TEMPERATURE,
        thinking_level: str = DEFAULT_THINKING_LEVEL,
        client: _GeminiModels | None = None,
    ) -> None:
        """Initialise the decider.

        Args:
            model: Hosted model name to query.
            api_key: API key for the SDK; defaults to ``None``, which reads
                :data:`GEMINI_API_KEY_ENV` from the environment at first call. Never
                logged.
            timeout: Per-decision wall-clock budget in seconds; on expiry
                :meth:`decide` raises ``TimeoutError``.
            temperature: Sampling temperature forwarded to the model (default
                :data:`DEFAULT_TEMPERATURE`).
            thinking_level: Reasoning effort forwarded as a
                :class:`~google.genai.types.ThinkingLevel` (case-insensitive; default
                :data:`DEFAULT_THINKING_LEVEL`).
            client: Async models client to use. Defaults to ``None``, which lazily
                constructs ``genai.Client(...).aio.models`` on first call; tests inject
                a double to avoid the network.
        """
        self.model: str = model
        self.timeout: float = timeout
        self.temperature: float = temperature
        self.thinking_level: str = thinking_level
        self._api_key: str | None = api_key
        self._client: _GeminiModels | None = client

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Query the model once (non-streaming, time-bounded) and parse the result.

        Args:
            messages: Chat-style message history (role/content dicts).
            tools: Tool schemas offered to the model (Ollama function format); translated
                to Gemini declarations and omitted from the request when empty.

        Returns:
            The parsed :class:`Decision`.

        Raises:
            TimeoutError: If the model does not respond within :attr:`timeout` seconds
                (the in-flight request is cancelled). The breathing loop catches this
                and ends the breath gracefully.
        """
        client = self._client
        if client is None:  # pragma: no cover - real network client construction
            import httpx
            from google import genai

            key = self._api_key or os.environ.get(GEMINI_API_KEY_ENV)
            # Force the SDK's httpx async transport instead of aiohttp. google-genai
            # 2.10.0 auto-selects aiohttp whenever it is importable, but aiohttp 3.14.x
            # trips an internal ``connector is not None`` assertion under the SDK's
            # session handling. Supplying a custom transport is the SDK's *supported*
            # opt-out (see ``_api_client._use_aiohttp``: a custom transport means
            # "use httpx, not aiohttp"). httpx is always installed (a google-genai dep).
            http_options = types.HttpOptions(
                async_client_args={"transport": httpx.AsyncHTTPTransport()}
            )
            # ``aio.models`` provides ``generate_content`` but is not declared against our
            # loose ``_GeminiModels`` seam; assert the fit at this boundary (mirrors
            # OllamaDecider's cast of ``ollama.AsyncClient``).
            client = cast(
                _GeminiModels, genai.Client(api_key=key, http_options=http_options).aio.models
            )

        config: dict[str, Any] = {
            "system_instruction": gemini_system_instruction(messages),
            "temperature": self.temperature,
            "thinking_config": types.ThinkingConfig(
                thinking_level=types.ThinkingLevel(self.thinking_level.upper())
            ),
        }
        if gemini_tools := to_gemini_tools(tools):
            config["tools"] = gemini_tools

        response = await asyncio.wait_for(
            client.generate_content(
                model=self.model,
                contents=to_gemini_contents(messages),
                config=config,
            ),
            self.timeout,
        )
        return parse_gemini_response(response)

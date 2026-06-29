r"""The agent "decider": the cognition seam between an agent and its model.

A :class:`Decider` turns a chat-style message history plus the available tool
schemas into a :class:`Decision` (free-text, hidden reasoning, and zero or more
:class:`ToolCall`\ s). It is an injected dependency (design DD1): the breathing
loop depends on the :class:`Decider` *protocol*, not on any concrete model, so
tests inject a scripted mock and never touch a live model.

This module provides:

* :class:`ToolCall` / :class:`Decision` -- the decider's return data model.
* :class:`Decider` -- the structural protocol the loop depends on.
* :func:`parse_ollama_response` -- a pure, unit-testable mapping from an Ollama
  chat response to a :class:`Decision` (no network).
* :class:`OllamaDecider` -- the real, non-streaming Ollama implementation
  (design DD2); its single network call is excluded from coverage.
* :func:`make_default_decider` -- factory for the production decider.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

from core.constants import GENERATION_RESERVE_TOKENS

#: Per-decision wall-clock budget for the live Ollama call (seconds). A local
#: model must load (cold start) and then generate with the tool schemas attached,
#: so this is generous; its job is to bound a *wedged* model, not a slow-but-
#: healthy one. On expiry :meth:`OllamaDecider.decide` raises ``TimeoutError``,
#: which the breathing loop already treats as a failed breath (then backs off).
DECIDE_TIMEOUT_SECONDS: float = 120.0

#: Context window (tokens) requested per decision. Ollama defaults every model to a
#: cramped 4096 regardless of its true capacity, which truncates the agent's growing
#: ``lifecycle_history`` mid-run. qwen3 supports far more, so we request 64K -- paired
#: with a q8_0 server-side KV cache (``OLLAMA_KV_CACHE_TYPE=q8_0`` + flash attention)
#: so the cache fits ~16-18GB RAM alongside the model weights. Ollama silently CLAMPS
#: this to the model's trained maximum, so the effective window is whatever the model
#: supports (40960 for qwen3:8b) -- requesting a ceiling keeps us correct across models.
#: This buys runway, not forever: unbounded history is ultimately Sprint 5's job
#: (episodic memory + identity summary instead of the full transcript in-context).
DECIDE_NUM_CTX: int = 65536

#: Hard cap on tokens GENERATED per decision (Ollama ``num_predict``). The window
#: counts prompt + generation together, so to keep ``prompt + generation <= window``
#: the generation side must be bounded -- not just the prompt (Sprint 5.5 compaction
#: bounds the prompt to ``window - GENERATION_RESERVE_TOKENS``; this guarantees the
#: model never spends more than that reserve, closing the other half of the window
#: math). Generous enough for qwen3's thinking + a tool call; a runaway generation is
#: cut off rather than allowed to overflow the context and silently evict the system
#: prompt. Mirrors ``core.constants.GENERATION_RESERVE_TOKENS``.
DECIDE_NUM_PREDICT: int = GENERATION_RESERVE_TOKENS


@dataclass(slots=True)
class ToolCall:
    """A single tool invocation requested by the decider.

    Attributes:
        name: Registered tool name to invoke.
        params: Keyword arguments for the tool (the JSON object the model
            produced); defaults to an empty dict.
        id: Optional provider-supplied call id, used to pair an assistant tool
            call with its ``tool``-role result message. ``None`` when the model
            does not supply one.
    """

    name: str
    params: dict[str, Any] = field(default_factory=dict)
    id: str | None = None


@dataclass(slots=True)
class Decision:
    """The outcome of one :meth:`Decider.decide` call.

    Attributes:
        text: The model's user-facing assistant text (may be empty).
        thinking: The model's hidden reasoning, when exposed by the backend
            (may be empty).
        tool_calls: Tool invocations the model requested; empty for a plain-text
            response (the loop simply continues).
        prompt_tokens: The actual prompt size in tokens for this call, as reported
            by the backend (Ollama ``prompt_eval_count``); ``0`` when unavailable.
            The breathing loop uses it as the ground-truth safety net for
            transcript compaction (Sprint 5.5).
    """

    text: str = ""
    thinking: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    prompt_tokens: int = 0


class Decider(Protocol):
    """Structural protocol for anything that can make an agent's decision.

    Implemented by :class:`OllamaDecider` (production) and the test
    ``MockDecider``. Kept deliberately minimal so the breathing loop depends only
    on this seam.
    """

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Return a :class:`Decision` for the given chat history and tools.

        Args:
            messages: Chat-style message history (role/content dicts).
            tools: Tool schemas offered to the model (Ollama function format).

        Returns:
            The model's :class:`Decision`.
        """
        ...


def parse_ollama_response(response: Any) -> Decision:
    """Map an Ollama chat response into a :class:`Decision` (pure, no network).

    Reads ``response.message`` and tolerates missing optional fields, so it works
    against both real ``ollama`` ``ChatResponse`` objects and lightweight test
    doubles. A response with no tool calls yields a :class:`Decision` whose
    ``tool_calls`` is empty (the loop then just continues on the assistant text).

    Args:
        response: An Ollama chat response (or a structurally compatible double)
            exposing ``message.content`` / ``message.thinking`` /
            ``message.tool_calls`` (each tool call exposing
            ``function.name`` / ``function.arguments`` and an optional ``id``).

    Returns:
        The parsed :class:`Decision`.
    """
    message = getattr(response, "message", None)
    if message is None:
        return Decision()

    text = getattr(message, "content", "") or ""
    thinking = getattr(message, "thinking", "") or ""

    tool_calls: list[ToolCall] = []
    for raw in getattr(message, "tool_calls", None) or []:
        function = getattr(raw, "function", None)
        if function is None:
            continue
        name = getattr(function, "name", "") or ""
        arguments = getattr(function, "arguments", None) or {}
        tool_calls.append(ToolCall(name=name, params=dict(arguments), id=getattr(raw, "id", None)))

    # ``prompt_eval_count`` lives on the response (not ``message``); it is the actual
    # prompt size in tokens, the ground-truth safety net for compaction (Sprint 5.5).
    prompt_tokens = getattr(response, "prompt_eval_count", 0) or 0

    return Decision(
        text=text, thinking=thinking, tool_calls=tool_calls, prompt_tokens=prompt_tokens
    )


class _ChatClient(Protocol):
    """Minimal async chat surface :class:`OllamaDecider` depends on.

    ``ollama.AsyncClient`` satisfies this structurally, as does a test double; it
    lets the decider be unit-tested (response parsing, timeout) without a live
    model -- the same "depend on a seam" approach as :class:`Decider`.
    """

    async def chat(self, **kwargs: Any) -> Any:
        """Send one chat request and return the provider's response."""
        ...


class OllamaDecider:
    """Production :class:`Decider` backed by a local Ollama model (design DD2).

    Makes a single, non-streaming ``ollama.chat`` call per decision and parses
    the result with :func:`parse_ollama_response`. The call is bounded by
    :attr:`timeout` (default :data:`DECIDE_TIMEOUT_SECONDS`): a wedged or
    unresponsive model raises ``TimeoutError`` rather than hanging the breathing
    loop forever -- the loop already absorbs a raising decider as a failed breath
    and backs off.

    The chat client is injectable so the parse/timeout behaviour is unit-testable
    without a network; in production it lazily constructs ``ollama.AsyncClient``.

    Attributes:
        model: Name of the Ollama model to query (e.g. ``"qwen3:8b"``).
        timeout: Per-decision wall-clock budget in seconds.
        num_ctx: Context window (tokens) requested per decision.
    """

    def __init__(
        self,
        model: str,
        *,
        timeout: float = DECIDE_TIMEOUT_SECONDS,
        num_ctx: int = DECIDE_NUM_CTX,
        num_predict: int = DECIDE_NUM_PREDICT,
        client: _ChatClient | None = None,
    ) -> None:
        """Initialise the decider.

        Args:
            model: Name of the Ollama model to query.
            timeout: Per-decision wall-clock budget in seconds; on expiry
                :meth:`decide` raises ``TimeoutError``.
            num_ctx: Context window (tokens) to request, overriding Ollama's
                cramped 4096 default.
            num_predict: Hard cap on tokens generated per decision, so
                ``prompt + generation`` stays within the window (the other half of
                the never-overflow guarantee; see :data:`DECIDE_NUM_PREDICT`).
            client: Chat client to use. Defaults to ``None``, which lazily
                constructs an ``ollama.AsyncClient`` on first call; tests inject a
                double to avoid the network.
        """
        self.model: str = model
        self.timeout: float = timeout
        self.num_ctx: int = num_ctx
        self.num_predict: int = num_predict
        self._client: _ChatClient | None = client

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Query the model once (non-streaming, time-bounded) and parse the result.

        Args:
            messages: Chat-style message history (role/content dicts).
            tools: Tool schemas offered to the model (Ollama function format).

        Returns:
            The parsed :class:`Decision`.

        Raises:
            TimeoutError: If the model does not respond within :attr:`timeout`
                seconds (the in-flight request is cancelled). The breathing loop
                catches this and ends the breath gracefully.
        """
        client = self._client
        if client is None:  # pragma: no cover - real network client construction
            import ollama

            # ``AsyncClient`` provides ``chat`` but is not declared against our
            # loose ``_ChatClient`` seam; assert the fit at this boundary.
            client = cast(_ChatClient, ollama.AsyncClient())
        response = await asyncio.wait_for(
            client.chat(
                model=self.model,
                messages=messages,
                tools=tools,
                stream=False,
                options={"num_ctx": self.num_ctx, "num_predict": self.num_predict},
            ),
            self.timeout,
        )
        return parse_ollama_response(response)


class SerializingDecider:
    """Wrap a :class:`Decider` so only one decision runs at a time.

    Ollama serves requests sequentially (the design's single local model). Letting
    every agent's breathing loop call the model concurrently would thunder-herd it
    and cascade timeouts; this decorator makes "sequential inference, pseudo-parallel
    via asyncio" explicit by guarding the inner ``decide`` with a shared
    :class:`asyncio.Lock`. ``async with`` guarantees the lock is released on normal
    return, exception, timeout, and cancellation, so one failing decision cannot
    wedge every other agent behind a permanently held lock.

    This does not undermine temporal asymmetry: ``pace`` governs an agent's
    inter-breath sleep, not its think time, so a fast-pace agent simply queues for
    the lock more often and still wins more turns over a long run.

    Attributes:
        _inner: The wrapped decider whose ``decide`` is serialized.
        _lock: The mutual-exclusion lock; share one instance across agents to
            serialize them against a single model.
    """

    def __init__(self, inner: Decider, lock: asyncio.Lock | None = None) -> None:
        """Initialise the serializing wrapper.

        Args:
            inner: The decider to serialize (e.g. an :class:`OllamaDecider`).
            lock: A shared lock to serialize on. Defaults to ``None``, which
                creates a fresh :class:`asyncio.Lock`; pass one shared instance to
                serialize several wrappers against the same model.
        """
        self._inner: Decider = inner
        self._lock: asyncio.Lock = lock or asyncio.Lock()

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Acquire the lock, delegate to the inner decider, then release.

        Args:
            messages: Chat-style message history (role/content dicts).
            tools: Tool schemas offered to the model (Ollama function format).

        Returns:
            The inner decider's :class:`Decision`.

        Raises:
            Exception: Re-raises anything the inner decider raises (e.g.
                ``TimeoutError``); the lock is still released via ``async with``.
        """
        async with self._lock:
            return await self._inner.decide(messages, tools)


def make_default_decider(model: str) -> Decider:
    """Build the default production decider for ``model``.

    Args:
        model: Name of the Ollama model the agent should think with.

    Returns:
        A :class:`Decider` (concretely an :class:`OllamaDecider`).
    """
    return OllamaDecider(model)

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

from dataclasses import dataclass, field
from typing import Any, Protocol


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
    """

    text: str = ""
    thinking: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


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

    return Decision(text=text, thinking=thinking, tool_calls=tool_calls)


class OllamaDecider:
    """Production :class:`Decider` backed by a local Ollama model (design DD2).

    Makes a single, non-streaming ``ollama.chat`` call per decision and parses
    the result with :func:`parse_ollama_response`. Network access is
    integration-only and excluded from unit coverage; unit tests use a mock
    decider instead.

    Attributes:
        model: Name of the Ollama model to query (e.g. ``"qwen3:8b"``).
    """

    def __init__(self, model: str) -> None:
        """Initialise the decider.

        Args:
            model: Name of the Ollama model to query.
        """
        self.model: str = model

    async def decide(  # pragma: no cover - exercised only against a live Ollama
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> Decision:
        """Query the model once (non-streaming) and parse the response.

        Args:
            messages: Chat-style message history (role/content dicts).
            tools: Tool schemas offered to the model (Ollama function format).

        Returns:
            The parsed :class:`Decision`.
        """
        import ollama

        client = ollama.AsyncClient()
        response = await client.chat(model=self.model, messages=messages, tools=tools, stream=False)
        return parse_ollama_response(response)


def make_default_decider(model: str) -> Decider:
    """Build the default production decider for ``model``.

    Args:
        model: Name of the Ollama model the agent should think with.

    Returns:
        A :class:`Decider` (concretely an :class:`OllamaDecider`).
    """
    return OllamaDecider(model)

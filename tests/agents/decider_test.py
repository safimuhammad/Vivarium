"""Tests for the decider data model and Ollama response parsing.

Covers the additive Phase-1 scaffolding in :mod:`agents.decider`:
:class:`agents.decider.ToolCall` / :class:`agents.decider.Decision` defaults and
slots, the pure :func:`agents.decider.parse_ollama_response` mapping, and the
scripted :class:`tests.conftest.MockDecider` used by the loop tests. No network
or live Ollama is touched (see ``CLAUDE.md`` Section 5).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from agents.decider import Decision, ToolCall, parse_ollama_response
from tests.conftest import MockDecider


def test_toolcall_defaults() -> None:
    call = ToolCall("wait")
    assert call.name == "wait"
    assert call.params == {}
    assert call.id is None


def test_toolcall_default_params_are_independent() -> None:
    first = ToolCall("a")
    second = ToolCall("b")
    first.params["x"] = 1
    assert second.params == {}


def test_toolcall_uses_slots() -> None:
    call = ToolCall("wait")
    with pytest.raises(AttributeError):
        call.unexpected = "boom"


def test_decision_defaults() -> None:
    decision = Decision()
    assert decision.text == ""
    assert decision.thinking == ""
    assert decision.tool_calls == []


def test_decision_default_tool_calls_are_independent() -> None:
    first = Decision()
    second = Decision()
    first.tool_calls.append(ToolCall("wait"))
    assert second.tool_calls == []


def _fake_response(*, content: str, thinking: str | None, tool_calls: list[Any]) -> SimpleNamespace:
    """Build a minimal stand-in for an ``ollama`` chat response."""
    return SimpleNamespace(
        message=SimpleNamespace(content=content, thinking=thinking, tool_calls=tool_calls)
    )


def _fake_tool_call(
    name: str, arguments: dict[str, Any], call_id: str | None = None
) -> SimpleNamespace:
    """Build a minimal stand-in for an ``ollama`` tool call."""
    return SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments), id=call_id)


def test_parse_ollama_response_with_tool_calls() -> None:
    resp = _fake_response(
        content="Heading east.",
        thinking="beta looks richer",
        tool_calls=[_fake_tool_call("move", {"destination": "beta"}, "call_1")],
    )
    decision = parse_ollama_response(resp)
    assert decision.text == "Heading east."
    assert decision.thinking == "beta looks richer"
    assert len(decision.tool_calls) == 1
    call = decision.tool_calls[0]
    assert call.name == "move"
    assert call.params == {"destination": "beta"}
    assert call.id == "call_1"


def test_parse_ollama_response_plain_text_has_no_tool_calls() -> None:
    resp = _fake_response(content="Just thinking aloud.", thinking=None, tool_calls=[])
    decision = parse_ollama_response(resp)
    assert decision.text == "Just thinking aloud."
    assert decision.thinking == ""
    assert decision.tool_calls == []


def test_parse_ollama_response_multiple_tool_calls() -> None:
    resp = _fake_response(
        content="",
        thinking=None,
        tool_calls=[
            _fake_tool_call("look_around", {}),
            _fake_tool_call("speak", {"message": "hi"}),
        ],
    )
    decision = parse_ollama_response(resp)
    assert [c.name for c in decision.tool_calls] == ["look_around", "speak"]
    assert decision.tool_calls[1].params == {"message": "hi"}


async def test_mock_decider_returns_scripted_decisions_in_order_and_cycles(
    mock_decider: MockDecider,
) -> None:
    first = await mock_decider.decide([], [])
    second = await mock_decider.decide([], [])
    third = await mock_decider.decide([], [])
    assert first.tool_calls[0].name == "look_around"
    assert second.tool_calls[0].name == "wait"
    assert third.tool_calls[0].name == "look_around"  # cycled back to the start
    assert mock_decider.history == [first, second, third]

"""Tests for the decider data model and Ollama response parsing.

Covers the additive Phase-1 scaffolding in :mod:`agents.decider`:
:class:`agents.decider.ToolCall` / :class:`agents.decider.Decision` defaults and
slots, the pure :func:`agents.decider.parse_ollama_response` mapping, and the
scripted :class:`tests.conftest.MockDecider` used by the loop tests. No network
or live Ollama is touched (see ``CLAUDE.md`` Section 5).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from agents.decider import (
    DECIDE_NUM_CTX,
    DECIDE_NUM_PREDICT,
    Decision,
    OllamaDecider,
    SerializingDecider,
    ToolCall,
    parse_ollama_response,
)
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
        call.unexpected = "boom"  # type: ignore[attr-defined]  # slots: no ad-hoc attrs


def test_decision_defaults() -> None:
    decision = Decision()
    assert decision.text == ""
    assert decision.thinking == ""
    assert decision.tool_calls == []
    assert decision.prompt_tokens == 0


def test_decision_default_tool_calls_are_independent() -> None:
    first = Decision()
    second = Decision()
    first.tool_calls.append(ToolCall("wait"))
    assert second.tool_calls == []


def _fake_response(
    *,
    content: str,
    thinking: str | None,
    tool_calls: list[Any],
    prompt_eval_count: int | None = None,
    eval_count: int | None = None,
) -> SimpleNamespace:
    """Build a minimal stand-in for an ``ollama`` chat response."""
    response = SimpleNamespace(
        message=SimpleNamespace(content=content, thinking=thinking, tool_calls=tool_calls)
    )
    if prompt_eval_count is not None:
        response.prompt_eval_count = prompt_eval_count
    if eval_count is not None:
        response.eval_count = eval_count
    return response


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
    assert decision.prompt_tokens == 0  # absent prompt_eval_count -> 0
    assert decision.completion_tokens == 0  # absent eval_count -> 0


def test_parse_ollama_response_reads_prompt_eval_count() -> None:
    resp = _fake_response(content="ok", thinking=None, tool_calls=[], prompt_eval_count=1234)
    decision = parse_ollama_response(resp)
    assert decision.prompt_tokens == 1234  # the real prompt size, for the safety net


def test_parse_ollama_response_reads_eval_count_as_completion_tokens() -> None:
    resp = _fake_response(content="ok", thinking=None, tool_calls=[], eval_count=57)
    decision = parse_ollama_response(resp)
    assert decision.completion_tokens == 57  # generated-token count, for cost accounting


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


async def test_ollama_decider_forwards_request_and_parses_injected_client() -> None:
    """``decide`` awaits the injected client and returns the parsed Decision.

    Exercises the real :meth:`OllamaDecider.decide` path with a structural client
    double (no network): it must forward model/messages/tools and the
    non-streaming flag verbatim, then map the response via
    :func:`parse_ollama_response`.
    """
    captured: dict[str, Any] = {}

    class _FakeClient:
        async def chat(self, **kwargs: Any) -> SimpleNamespace:
            captured.update(kwargs)
            return _fake_response(
                content="Onward.",
                thinking=None,
                tool_calls=[_fake_tool_call("move", {"destination": "grove"})],
            )

    decider = OllamaDecider("test-model", client=_FakeClient())
    decision = await decider.decide([{"role": "user", "content": "go"}], [{"name": "move"}])

    assert decision.text == "Onward."
    assert [c.name for c in decision.tool_calls] == ["move"]
    assert captured["model"] == "test-model"
    assert captured["messages"] == [{"role": "user", "content": "go"}]
    assert captured["tools"] == [{"name": "move"}]
    assert captured["stream"] is False
    # The context window is requested explicitly (Ollama defaults to a cramped 4096
    # regardless of the model's true capacity), and generation is capped so
    # ``prompt + generation`` cannot exceed the window (Sprint 5.5 never-overflow).
    assert captured["options"] == {"num_ctx": DECIDE_NUM_CTX, "num_predict": DECIDE_NUM_PREDICT}


async def test_ollama_decider_forwards_custom_num_ctx() -> None:
    """A per-instance ``num_ctx`` overrides the default in the forwarded options."""
    captured: dict[str, Any] = {}

    class _FakeClient:
        async def chat(self, **kwargs: Any) -> SimpleNamespace:
            captured.update(kwargs)
            return _fake_response(content="ok", thinking=None, tool_calls=[])

    decider = OllamaDecider("test-model", num_ctx=8192, client=_FakeClient())
    await decider.decide([], [])
    assert captured["options"] == {"num_ctx": 8192, "num_predict": DECIDE_NUM_PREDICT}


async def test_ollama_decider_caps_generation_with_num_predict() -> None:
    """Generation is bounded so ``prompt + generation`` stays within the window.

    Capping the prompt alone (compaction) is only half the never-overflow math; the
    model could still generate past the window. ``num_predict`` is the output-side
    cap, defaulting to :data:`DECIDE_NUM_PREDICT` and overridable per instance.
    """
    captured: dict[str, Any] = {}

    class _FakeClient:
        async def chat(self, **kwargs: Any) -> SimpleNamespace:
            captured.update(kwargs)
            return _fake_response(content="ok", thinking=None, tool_calls=[])

    decider = OllamaDecider("test-model", num_predict=256, client=_FakeClient())
    await decider.decide([], [])
    assert captured["options"]["num_predict"] == 256


async def test_ollama_decider_times_out_on_a_hung_client() -> None:
    """A model that never responds raises ``TimeoutError`` (loop then backs off).

    This is the homeostasis-saving fix: an unbounded await on a wedged Ollama is
    bounded by ``timeout`` so the breathing loop degrades to a failed breath
    (which it already absorbs via backoff) instead of hanging forever.
    """

    class _HangingClient:
        async def chat(self, **kwargs: Any) -> SimpleNamespace:
            await asyncio.Event().wait()  # never resolves
            raise AssertionError("unreachable")  # pragma: no cover

    decider = OllamaDecider("test-model", timeout=0.01, client=_HangingClient())
    with pytest.raises(TimeoutError):
        await decider.decide([], [])


async def test_serializing_decider_never_overlaps() -> None:
    """Concurrent decisions through the wrapper run strictly one at a time.

    Mirrors the single-Ollama constraint: many agents may queue, but only one
    inference is ever in flight (``max_seen == 1``).
    """
    inflight = 0
    max_seen = 0

    class _Probe:
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            nonlocal inflight, max_seen
            inflight += 1
            max_seen = max(max_seen, inflight)
            await asyncio.sleep(0.01)
            inflight -= 1
            return Decision(text="ok")

    dec = SerializingDecider(_Probe())
    await asyncio.gather(*[dec.decide([], []) for _ in range(5)])
    assert max_seen == 1  # strictly serialized


async def test_serializing_decider_releases_on_error() -> None:
    """An exception inside the inner decider still releases the lock.

    ``async with`` guarantees release on timeout/cancel/exception, so a single
    failing decision cannot wedge every other agent behind a held lock.
    """

    class _Boom:
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            raise RuntimeError("boom")

    dec = SerializingDecider(_Boom())
    with pytest.raises(RuntimeError):
        await dec.decide([], [])
    assert not dec._lock.locked()  # context manager released it

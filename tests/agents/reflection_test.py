"""Tests for :mod:`agents.reflection` -- schemas, recap rendering, and message build."""

from __future__ import annotations

from agents.reflection import (
    REFLECTION_TOOL_SCHEMAS,
    build_reflection_messages,
    render_recap,
)


def test_reflection_schemas_are_only_memory_tools() -> None:
    names = {schema["function"]["name"] for schema in REFLECTION_TOOL_SCHEMAS}
    assert names == {"remember", "revise_self"}


def test_remember_schema_requires_content_and_importance() -> None:
    schema = next(s for s in REFLECTION_TOOL_SCHEMAS if s["function"]["name"] == "remember")
    props = schema["function"]["parameters"]["properties"]
    assert "content" in props
    assert props["importance"]["enum"] == ["low", "medium", "high"]
    assert set(schema["function"]["parameters"]["required"]) == {"content", "importance"}


def test_render_recap_keeps_only_last_n_non_system_turns() -> None:
    history = [{"role": "system", "content": "persona"}] + [
        {"role": "user", "content": f"perception {i}"} for i in range(10)
    ]
    recap = render_recap(history, turns=3)
    assert "perception 9" in recap
    assert "perception 6" not in recap  # only last 3 (7,8,9)
    assert "persona" not in recap  # system turn excluded


def test_render_recap_handles_empty_history() -> None:
    assert render_recap([{"role": "system", "content": "p"}], turns=3)  # non-empty fallback text


def test_reflection_messages_have_no_consecutive_user_turns() -> None:
    msgs = build_reflection_messages("I am Ada.", "Recently: nothing.")
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "I am Ada." in msgs[0]["content"]
    assert "reflect" in msgs[1]["content"].lower()

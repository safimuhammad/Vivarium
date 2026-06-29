"""Tests for :mod:`agents.recall` -- the ``recall`` action schema and renderer."""

from __future__ import annotations

from agents.recall import RECALL_TOOL_NAME, RECALL_TOOL_SCHEMA, render_recall
from memory.models import Importance, MemoryItem


def _item(content: str) -> MemoryItem:
    return MemoryItem(
        id="wanderer_001-0",
        content=content,
        importance=Importance.LOW,
        created_breath=0,
        created_at=0.0,
    )


# --- schema -----------------------------------------------------------------


def test_recall_schema_names_the_tool_and_requires_query() -> None:
    function = RECALL_TOOL_SCHEMA["function"]
    assert function["name"] == RECALL_TOOL_NAME == "recall"
    assert function["parameters"]["required"] == ["query"]
    assert "query" in function["parameters"]["properties"]


def test_recall_schema_uses_in_world_voice() -> None:
    description = RECALL_TOOL_SCHEMA["function"]["description"].lower()
    for meta_term in ("memory store", "database", "rag", "vector", "simulation", "results"):
        assert meta_term not in description  # DD9: no meta/simulation language


# --- renderer (contract for the TODO(human) implementation) -----------------


def test_render_recall_includes_each_memory_content() -> None:
    items = [_item("the spring lies east of the dead oak"), _item("Kai cannot be trusted")]
    rendered = render_recall(items)
    assert "the spring lies east of the dead oak" in rendered
    assert "Kai cannot be trusted" in rendered


def test_render_recall_empty_reads_differently_from_populated() -> None:
    empty = render_recall([])
    populated = render_recall([_item("a thing worth keeping")])
    assert empty.strip()  # a found-nothing line, not blank
    assert empty != populated  # the two cases are distinguishable to the agent

"""Tests for :mod:`memory.models` -- the ``Importance`` enum and ``MemoryItem``."""

from __future__ import annotations

import pytest

from memory.models import Importance, MemoryItem


def test_importance_from_str_is_case_insensitive() -> None:
    assert Importance.from_str("HIGH") is Importance.HIGH
    assert Importance.from_str("medium") is Importance.MEDIUM
    assert Importance.from_str("  low  ") is Importance.LOW


def test_importance_from_str_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        Importance.from_str("urgent")


def test_memory_item_roundtrips_through_jsonl() -> None:
    item = MemoryItem(
        id="wanderer_001-0",
        content="Kai betrayed me in the meadow.",
        importance=Importance.HIGH,
        created_breath=7,
        created_at=123.5,
    )
    restored = MemoryItem.from_jsonl_line(item.to_jsonl_line())
    assert restored == item


def test_jsonl_line_is_single_line_json() -> None:
    item = MemoryItem("a-0", "multi\nline\ncontent", Importance.LOW, 1, 0.0)
    line = item.to_jsonl_line()
    assert line.count("\n") == 0  # newlines in content are JSON-escaped


def test_memory_item_is_frozen() -> None:
    item = MemoryItem("a-0", "x", Importance.LOW, 1, 0.0)
    with pytest.raises(AttributeError):
        item.content = "mutated"  # type: ignore[misc]

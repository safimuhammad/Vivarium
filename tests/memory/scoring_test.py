"""Tests for :mod:`memory.scoring` -- the pure recency x importance x relevance scorer.

Each test isolates one term (zeroing the other two weights) to prove that term
drives the ranking, which is how the salience design is validated: importance can
beat similarity (the grudge case), recency can beat both, etc.
"""

from __future__ import annotations

from memory.models import Importance, MemoryItem
from memory.scoring import score_memories, select_memories

WEIGHTS = {Importance.LOW: 0.3, Importance.MEDIUM: 0.6, Importance.HIGH: 1.0}


def _item(id_: str, breath: int, importance: Importance) -> MemoryItem:
    return MemoryItem(id_, f"content-{id_}", importance, breath, 0.0)


def _score(
    items: list[MemoryItem],
    distances: dict[str, float],
    breath: int,
    k: int,
    *,
    wr: float = 1.0,
    wi: float = 1.0,
    wv: float = 1.0,
) -> list[MemoryItem]:
    return score_memories(
        items,
        distances,
        breath,
        k,
        w_recency=wr,
        w_importance=wi,
        w_relevance=wv,
        recency_decay=0.97,
        importance_weights=WEIGHTS,
    )


def test_recency_dominates_when_other_terms_equal() -> None:
    items = [_item("old", 0, Importance.MEDIUM), _item("new", 9, Importance.MEDIUM)]
    dist = {"old": 0.5, "new": 0.5}
    ranked = _score(items, dist, breath=10, k=2, wi=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["new", "old"]


def test_importance_dominates_when_other_terms_equal() -> None:
    items = [_item("low", 5, Importance.LOW), _item("high", 5, Importance.HIGH)]
    dist = {"low": 0.5, "high": 0.5}
    ranked = _score(items, dist, breath=5, k=2, wr=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["high", "low"]


def test_relevance_dominates_when_other_terms_equal() -> None:
    items = [_item("far", 5, Importance.MEDIUM), _item("near", 5, Importance.MEDIUM)]
    dist = {"far": 0.9, "near": 0.1}
    ranked = _score(items, dist, breath=5, k=2, wr=0.0, wi=0.0)
    assert [m.id for m in ranked] == ["near", "far"]


def test_importance_can_beat_relevance_the_grudge_case() -> None:
    # A high-importance grudge that is NOT similar to the query should still
    # outrank a low-importance but highly-similar memory when weights are equal.
    items = [_item("grudge", 5, Importance.HIGH), _item("chitchat", 5, Importance.LOW)]
    dist = {"grudge": 0.95, "chitchat": 0.05}  # grudge far, chitchat near
    ranked = _score(items, dist, breath=5, k=2)  # equal weights
    assert ranked[0].id == "grudge"


def test_topk_limits_and_orders() -> None:
    items = [_item(str(i), i, Importance.MEDIUM) for i in range(5)]
    dist = {str(i): 0.5 for i in range(5)}
    ranked = _score(items, dist, breath=4, k=2, wi=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["4", "3"]


def test_missing_distance_is_treated_as_least_relevant() -> None:
    items = [_item("known", 5, Importance.MEDIUM), _item("unknown", 5, Importance.MEDIUM)]
    dist = {"known": 0.1}  # 'unknown' absent → inf distance → 0 relevance
    ranked = _score(items, dist, breath=5, k=2, wr=0.0, wi=0.0)
    assert ranked[0].id == "known"


def test_empty_items_returns_empty() -> None:
    assert _score([], {}, breath=0, k=5) == []


def test_select_memories_reserves_importance_slot() -> None:
    # One old, dissimilar, HIGH-importance grudge vs many recent, similar, LOW ones.
    grudge = _item("grudge", 0, Importance.HIGH)
    chitchat = [_item(f"c{i}", 5 + i, Importance.LOW) for i in range(6)]
    items = [grudge, *chitchat]
    distances = {"grudge": 0.9, **{f"c{i}": 0.05 for i in range(6)}}

    # Pure top-k buries the grudge (the benchmark failure).
    pure = score_memories(
        items, distances, 12, 3,
        w_recency=1.0, w_importance=1.0, w_relevance=1.0,
        recency_decay=0.97, importance_weights=WEIGHTS,
    )
    assert "grudge" not in [m.id for m in pure]

    # A reserved slot guarantees the salient memory surfaces.
    reserved = select_memories(
        items, distances, 12, 3, reserved=1,
        w_recency=1.0, w_importance=1.0, w_relevance=1.0,
        recency_decay=0.97, importance_weights=WEIGHTS,
    )
    assert "grudge" in [m.id for m in reserved]
    assert len(reserved) == 3


def test_select_memories_zero_reserved_matches_pure_topk() -> None:
    items = [_item(str(i), i, Importance.MEDIUM) for i in range(5)]
    distances = {str(i): (i % 3) / 3.0 for i in range(5)}
    pure = score_memories(
        items, distances, 4, 3,
        w_recency=1.0, w_importance=1.0, w_relevance=1.0,
        recency_decay=0.97, importance_weights=WEIGHTS,
    )
    reserved0 = select_memories(
        items, distances, 4, 3, reserved=0,
        w_recency=1.0, w_importance=1.0, w_relevance=1.0,
        recency_decay=0.97, importance_weights=WEIGHTS,
    )
    assert [m.id for m in reserved0] == [m.id for m in pure]


def test_select_memories_empty_returns_empty() -> None:
    assert (
        select_memories(
            [], {}, 0, 5, reserved=1,
            w_recency=1.0, w_importance=1.0, w_relevance=1.0,
            recency_decay=0.97, importance_weights=WEIGHTS,
        )
        == []
    )

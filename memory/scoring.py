"""Pure salience scorer: recency x importance x relevance.

Solves "similarity != salience": vector search supplies only *relevance*, but the
most biographically important memories (a grudge, a bond) are often not similar to
the current moment. Each term is min-max normalized across the candidate set so no
term dominates by raw scale, then combined by a weighted sum. Pure and
deterministic -- no I/O, no model -- so it is exhaustively unit-tested.
"""

from __future__ import annotations

from memory.models import Importance, MemoryItem


def score_memories(
    items: list[MemoryItem],
    distances: dict[str, float],
    current_breath: int,
    k: int,
    *,
    w_recency: float,
    w_importance: float,
    w_relevance: float,
    recency_decay: float,
    importance_weights: dict[Importance, float],
) -> list[MemoryItem]:
    """Return the top-``k`` memories by combined salience score (highest first).

    Args:
        items: Candidate memories.
        distances: ``{item.id: vector distance}`` (lower = more relevant); ids
            absent from the map are treated as maximally distant.
        current_breath: The agent's current subjective time.
        k: Maximum number of memories to return.
        w_recency: Weight on the recency term.
        w_importance: Weight on the importance term.
        w_relevance: Weight on the relevance term.
        recency_decay: Per-breath exponential decay base for recency.
        importance_weights: Numeric weight per :class:`Importance`.

    Returns:
        Up to ``k`` items, ordered by descending combined score. Ties keep the
        input order (stable sort).
    """
    if not items:
        return []
    scored = _score_map(
        items,
        distances,
        current_breath,
        w_recency=w_recency,
        w_importance=w_importance,
        w_relevance=w_relevance,
        recency_decay=recency_decay,
        importance_weights=importance_weights,
    )
    ranked = sorted(items, key=lambda m: scored[m.id], reverse=True)
    return ranked[:k]


def select_memories(
    items: list[MemoryItem],
    distances: dict[str, float],
    current_breath: int,
    k: int,
    *,
    reserved: int,
    w_recency: float,
    w_importance: float,
    w_relevance: float,
    recency_decay: float,
    importance_weights: dict[Importance, float],
) -> list[MemoryItem]:
    """Select up to ``k`` memories, reserving ``reserved`` slots for the most important.

    The reserved slots guarantee that the most biographically important memories
    surface even when many recent + similar memories would otherwise crowd them out
    of a pure top-k (the benchmark's "grudge" failure). The remaining slots are
    filled by the full combined score; the final list is presented in descending
    combined-score order.

    Args:
        items: Candidate memories.
        distances: ``{item.id: vector distance}`` (lower = more relevant).
        current_breath: The agent's current subjective time.
        k: Maximum number of memories to return.
        reserved: How many slots (clamped to ``[0, k]``) to reserve for the
            highest-importance memories (tie-broken by recency, then score).
        w_recency: Weight on the recency term.
        w_importance: Weight on the importance term.
        w_relevance: Weight on the relevance term.
        recency_decay: Per-breath exponential decay base for recency.
        importance_weights: Numeric weight per :class:`Importance`.

    Returns:
        Up to ``k`` items ordered by descending combined score.
    """
    if not items or k <= 0:
        return []
    scored = _score_map(
        items,
        distances,
        current_breath,
        w_recency=w_recency,
        w_importance=w_importance,
        w_relevance=w_relevance,
        recency_decay=recency_decay,
        importance_weights=importance_weights,
    )
    by_score = sorted(items, key=lambda m: scored[m.id], reverse=True)
    reserved = max(0, min(reserved, k))
    if reserved == 0:
        return by_score[:k]

    by_importance = sorted(
        items,
        key=lambda m: (importance_weights[m.importance], m.created_breath, scored[m.id]),
        reverse=True,
    )
    chosen: dict[str, MemoryItem] = {}
    for memory in by_importance[:reserved]:
        chosen[memory.id] = memory
    for memory in by_score:
        if len(chosen) >= k:
            break
        chosen.setdefault(memory.id, memory)
    return sorted(chosen.values(), key=lambda m: scored[m.id], reverse=True)


def _score_map(
    items: list[MemoryItem],
    distances: dict[str, float],
    current_breath: int,
    *,
    w_recency: float,
    w_importance: float,
    w_relevance: float,
    recency_decay: float,
    importance_weights: dict[Importance, float],
) -> dict[str, float]:
    """Return ``{id: combined salience score}`` for every item (shared by both rankers)."""
    recency = {m.id: recency_decay ** max(0, current_breath - m.created_breath) for m in items}
    importance = {m.id: importance_weights[m.importance] for m in items}
    relevance = {m.id: _distance_to_relevance(distances.get(m.id)) for m in items}
    return _combined_scores(
        items, recency, importance, relevance, w_recency, w_importance, w_relevance
    )


def _distance_to_relevance(distance: float | None) -> float:
    """Map a vector distance (lower = closer; ``None``/``inf`` = unknown) to [0, 1]."""
    if distance is None or distance == float("inf"):
        return 0.0
    return 1.0 / (1.0 + max(0.0, distance))


def _combined_scores(
    items: list[MemoryItem],
    recency: dict[str, float],
    importance: dict[str, float],
    relevance: dict[str, float],
    w_recency: float,
    w_importance: float,
    w_relevance: float,
) -> dict[str, float]:
    """Min-max normalize each term across ``items`` and return the weighted sum per id.

    Normalizing per term (rather than summing raw values) keeps the weights honest:
    a term's raw scale (e.g. recency in (0, 1] vs relevance near 0.5) cannot
    dominate by accident, so ``w_*`` are the real dials. The combination is
    additive -- a strong single term can carry a memory -- by design (a salient
    grudge surfaces even when it is not relevant to the moment).
    """
    norm_recency = _normalize(recency)
    norm_importance = _normalize(importance)
    norm_relevance = _normalize(relevance)
    return {
        m.id: (
            w_recency * norm_recency[m.id]
            + w_importance * norm_importance[m.id]
            + w_relevance * norm_relevance[m.id]
        )
        for m in items
    }


def _normalize(values: dict[str, float]) -> dict[str, float]:
    """Min-max normalize a term to [0, 1]; a flat term maps everything to 1.0."""
    low, high = min(values.values()), max(values.values())
    if high == low:
        return dict.fromkeys(values, 1.0)
    return {key: (value - low) / (high - low) for key, value in values.items()}

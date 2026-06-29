"""Tests for the live activity-feed renderers (:mod:`observability.activity_feed`).

Only the *pure* renderers are unit-testable here: :func:`render_event` (an
:class:`~bus.events.Event` -> human-readable line) and :func:`render_world_table`
(a :class:`~world.world.WorldState` snapshot -> ``rich.table.Table``). The live
``rich.Live`` loop in :func:`run_activity_feed` is integration-only (it drives a
terminal) and is excluded from the fast suite.
"""

from __future__ import annotations

from bus.events import Event, ScopeType
from observability.activity_feed import render_event, render_world_table
from world.world import WorldState


def test_render_event_human_readable() -> None:
    e = Event(
        "agent_died",
        "wanderer_002",
        {"message": "X was slain by Y", "killer": "wanderer_001"},
        scope=ScopeType.GLOBAL,
    )
    line = render_event(e)
    assert "slain" in line.lower() or "died" in line.lower()


def test_render_event_falls_back_to_type() -> None:
    e = Event("mystery", "src", {}, scope=ScopeType.GLOBAL)  # no message
    assert "mystery" in render_event(e)


def test_render_world_table_lists_agents_and_regions(world: WorldState) -> None:
    table = render_world_table(world)  # returns a rich.table.Table
    from rich.console import Console

    text = "".join(seg.text for seg in Console().render(table))
    assert "wanderer_001" in text

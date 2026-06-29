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


def test_render_world_table_shows_population_summary(world: WorldState) -> None:
    """The agents table title surfaces total + per-status counts (throughput diagnosis)."""
    from rich.console import Console

    from world.agents import AgentStatus

    # world fixture has 2 ALIVE agents; paralyze one so all three buckets are non-trivial.
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_energy("wanderer_002", -(boris.current_energy - 1.0))  # -> PARALYZED
    assert boris.status is AgentStatus.PARALYZED

    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "2 total" in text
    assert "1 alive" in text
    assert "1 fallen" in text
    assert "0 dead" in text

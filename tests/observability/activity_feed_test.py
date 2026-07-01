"""Tests for the live activity-feed renderers (:mod:`observability.activity_feed`).

Only the *pure* renderers are unit-testable here: :func:`render_event` (an
:class:`~bus.events.Event` -> human-readable line) and :func:`render_world_table`
(a :class:`~world.world.WorldState` snapshot -> ``rich.table.Table``). The live
``rich.Live`` loop in :func:`run_activity_feed` is integration-only (it drives a
terminal) and is excluded from the fast suite.
"""

from __future__ import annotations

from bus.events import Event, ScopeType
from core.constants import HOME_MAX_INTEGRITY
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


def test_render_self_talk_reads_as_a_private_thought() -> None:
    """A self_talk event renders in a distinct thought register, not like speech."""
    event = Event(
        type="self_talk",
        source="a1",
        payload={"message": "I wonder what lies past the hills."},
        scope=ScopeType.PRIVATE,
    )
    assert render_event(event) == "[a1] 💭 I wonder what lies past the hills."


def test_render_event_home_events_are_human_readable() -> None:
    """Message-less home events fall back to a distinct verb per type."""
    for etype, needle in (
        ("home_built", "raised"),
        ("hearth_used", "hearth"),
        ("home_collapsed", "crumble"),
    ):
        event = Event(etype, "wanderer_001", {}, scope=ScopeType.LOCAL)  # no message -> verb
        assert needle in render_event(event).lower()


def test_render_world_table_shows_homes(world: WorldState) -> None:
    """The world-table gains a homes section showing owner + integrity (observer-facing)."""
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=42.0)
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Homes" in text  # the section title
    assert "home_ada" in text  # the home id (unique to the homes section)
    assert "42.0" in text  # its integrity is visible to the observer


def test_render_event_shared_home_events_are_human_readable() -> None:
    """Message-less shared-home events fall back to a distinct verb per type.

    Asserts the FULL mapped phrase, not just a bare word: the raw type strings
    ``home_joined``/``home_left`` themselves already contain "joined"/"left", so a
    needle of just that word would pass even if the ``_EVENT_VERBS`` entry were
    missing and ``render_event`` fell back to the raw type. The full phrase only
    appears via the verb dict.
    """
    for etype, needle in (("home_joined", "joined a home"), ("home_left", "left a home")):
        event = Event(etype, "wanderer_002", {}, scope=ScopeType.LOCAL)  # no message -> verb
        assert needle in render_event(event).lower()


def test_render_world_table_shows_stakeholders_and_scaled_health(world: WorldState) -> None:
    """The homes section surfaces stakeholder count + integrity/max (observer-facing).

    The stakeholder-count assertion is anchored to the home's own row: fixture agent
    ``wanderer_002`` contains the digit "2", so a bare ``"2" in text`` would pass
    vacuously regardless of the Stakeholders column. Splitting into lines and
    checking the home's row specifically closes that gap.
    """
    from rich.console import Console

    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("home_ada", "wanderer_002")  # 2 stakeholders -> ceiling 150
    world.modify_home_integrity("home_ada", 1000.0)  # heal up to 150
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Stakeholders" in text  # the new column
    assert "Health" in text  # integrity/max column header
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    assert "2" in home_rows[0]  # stakeholder count appears IN the home's row
    assert "150.0" in text  # the stakeholder-scaled ceiling M(2)


def test_render_world_table_homes_section_renders_cleanly_with_zero_homes(
    world: WorldState,
) -> None:
    """The homes section (with its new columns) renders with no rows and no error."""
    from rich.console import Console

    assert world.get_all_homes() == []  # world fixture builds no homes
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Homes" in text  # section title still present
    assert "Stakeholders" in text  # new column header still present
    assert "Health" in text  # new column header still present

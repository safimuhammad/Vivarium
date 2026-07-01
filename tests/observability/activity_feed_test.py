"""Tests for the live activity-feed renderers (:mod:`observability.activity_feed`).

Only the *pure* renderers are unit-testable here: :func:`render_event` (an
:class:`~bus.events.Event` -> human-readable line) and :func:`render_world_table`
(a :class:`~world.world.WorldState` snapshot -> ``rich.table.Table``). The live
``rich.Live`` loop in :func:`run_activity_feed` is integration-only (it drives a
terminal) and is excluded from the fast suite.
"""

from __future__ import annotations

from bus.events import Event, ScopeType
from core.constants import (
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
    RUINS_SCAVENGE_FRACTION,
)
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
    assert "Vault" in text  # new column header still present with zero homes
    assert (
        "Status" in text and "Breachers" in text and "Remnant" in text
    )  # new columns with zero homes


def test_render_event_home_started_hoarding_is_human_readable() -> None:
    """A message-less home_started_hoarding falls back to a distinct verb (not the raw type)."""
    event = Event("home_started_hoarding", "home_ada", {}, scope=ScopeType.LOCAL)
    assert "great store" in render_event(event).lower()


def test_render_world_table_shows_vault_column(world: WorldState) -> None:
    """The homes section surfaces each home's vault balance (observer-facing)."""
    from rich.console import Console

    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 120.0)
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Vault" in text  # the new column header
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    assert "120.0" in home_rows[0]  # the vault balance appears IN the home's row


def test_render_event_contest_verbs_are_human_readable() -> None:
    """Message-less contest events fall back to a distinct verb per type (not the raw type)."""
    for etype, needle in (
        ("home_breached", "broke into a home"),
        ("home_thieved", "stripped a home"),
        ("home_colonized", "seized a home"),
        ("ruins_scavenged", "picked over ruins"),
    ):
        event = Event(etype, "wanderer_002", {}, scope=ScopeType.LOCAL)
        assert needle in render_event(event).lower()


def test_render_world_table_marks_a_hoarding_agent(world: WorldState) -> None:
    """The agents section marks a being over a hoarding threshold (carried-2b consistency)."""
    from rich.console import Console

    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOARDING_MATERIALS_THRESHOLD  # hoarding on materials
    text = "".join(seg.text for seg in Console(width=200).render(render_world_table(world)))
    ada_rows = [line for line in text.splitlines() if "wanderer_001" in line]
    assert ada_rows and "hoarding" in ada_rows[0].lower()


def test_render_world_table_marks_a_hoarding_home_and_shows_contest_columns(
    world: WorldState,
) -> None:
    """The homes section marks a hoarding vault and shows Status/Breachers/Remnant.

    The breacher-count check is anchored to the Breachers column specifically (not a
    bare ``"1" in home_rows[0]``): the row already contains the digit "1" from the
    owner id ``wanderer_001`` and the (always-1, owner-is-a-stakeholder) Stakeholders
    count, so a bare substring check would pass vacuously even if the Breachers
    column were broken, empty, or stuck at "0". Splitting the row on the table's
    column separator and indexing the Breachers cell closes that gap (same anti-
    vacuity concern ``test_render_world_table_shows_stakeholders_and_scaled_health``
    documents for its own stakeholder-count check).
    """
    from rich.console import Console

    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", HOARDING_MATERIALS_THRESHOLD + 5.0)  # hoarding home
    world.record_breacher("home_ada", "wanderer_002")
    text = "".join(seg.text for seg in Console(width=250).render(render_world_table(world)))

    assert "Status" in text and "Breachers" in text and "Remnant" in text  # new columns
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    assert "standing" in home_rows[0].lower()
    assert "hoarding" in home_rows[0].lower()  # vault-hoard marker
    # Columns: '', Home, Owner, Region, Status, Stakeholders, Health, Vault, Breachers, Remnant, ''
    cells = [cell.strip() for cell in home_rows[0].split("│")]
    assert cells[8] == "1"  # exactly one breacher, in the Breachers column


def test_render_world_table_shows_a_ruin_row(world: WorldState) -> None:
    """A RUIN renders its status + remnant (observer-facing).

    The remnant check is column-anchored (split on the table's column separator and
    indexed into the Remnant cell), not a bare substring: a bare ``"40.0" in text``
    could coincidentally match some other cell, and a bare ``"40.0" in home_rows[0]``
    would pass even if the value leaked into the wrong column.
    """
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("home_ada")
    text = "".join(seg.text for seg in Console(width=250).render(render_world_table(world)))
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1 and "ruin" in home_rows[0].lower()
    # Columns: '', Home, Owner, Region, Status, Stakeholders, Health, Vault, Breachers, Remnant, ''
    cells = [cell.strip() for cell in home_rows[0].split("│")]
    expected_remnant = RUINS_SCAVENGE_FRACTION * HOME_BUILD_MATERIALS_COST  # vault was 0.0
    assert cells[9] == f"{expected_remnant:.1f}"  # remnant amount, in the Remnant column


def test_render_world_table_blanks_remnant_for_a_standing_home(world: WorldState) -> None:
    """A STANDING home's Remnant cell is a blank placeholder, not a misleading "0.0".

    ``remnant_materials`` defaults to ``0.0`` and is documented as "meaningless while
    STANDING" (``world/homes.py``); rendering it unconditionally would read as a real
    zero balance. Anchored to the Remnant column (not a bare substring) the same way
    the RUIN-row test above is.
    """
    from rich.console import Console

    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    text = "".join(seg.text for seg in Console(width=250).render(render_world_table(world)))
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    # Columns: '', Home, Owner, Region, Status, Stakeholders, Health, Vault, Breachers, Remnant, ''
    cells = [cell.strip() for cell in home_rows[0].split("│")]
    assert cells[9] == "—"  # placeholder, not "0.0"

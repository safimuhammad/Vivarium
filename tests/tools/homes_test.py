"""Tests for :mod:`tools.builtin.homes` — ``build_home``, ``use_hearth``,
``pledge_home``, ``leave_home``.

``build_home`` sinks materials to raise a private home in the being's region and
emits ``home_built``. ``use_hearth`` burns a stakeholder's own materials at a home it
shares for energy (a conversion, never a mint) and emits ``hearth_used``; any
stakeholder (owner or pledged) may use it. ``pledge_home`` joins a co-located being
into a home's stakeholders (sharing its upkeep and hearth) and emits ``home_joined``.
``leave_home`` gives up a being's stake (pruning it, promoting a new owner if needed,
and clamping integrity) and emits ``home_left``. All four report lookup/precondition
failures with ``Error:`` and rule violations with ``Invalid:``.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_ENERGY_THRESHOLD,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.homes import build_home, leave_home, pledge_home, use_hearth
from world.agents import AgentStatus, is_hoarding
from world.world import WorldState

# ---- build_home -----------------------------------------------------------


async def test_build_home_creates_home_deducts_materials_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST + 10.0

    result = await build_home(world, event_bus, "wanderer_001")

    home = world.home_of("wanderer_001")
    assert home is not None
    assert home.region == "alpha"  # built where the being stands
    assert home.integrity == HOME_MAX_INTEGRITY
    assert ada.current_materials == 10.0  # cost deducted
    built = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_built"]
    assert len(built) == 1
    assert built[0].scope is ScopeType.LOCAL
    assert built[0].region == "alpha"
    assert built[0].source == "wanderer_001"
    assert built[0].timestamp == world.now()
    assert result.startswith("You raise a home here.")


async def test_build_home_insufficient_materials_is_invalid_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST - 1.0

    result = await build_home(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert world.home_of("wanderer_001") is None  # nothing built
    assert ada.current_materials == HOME_BUILD_MATERIALS_COST - 1.0  # nothing spent
    assert event_bus.get_events("wanderer_001") == []  # no event


async def test_build_home_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot build (defensive: the registry also guards this)."""
    result = await build_home(world, event_bus, "ghost")
    assert result.startswith("Error:")
    assert world.get_all_homes() == []


async def test_build_home_when_already_owning_one_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST * 3
    assert (await build_home(world, event_bus, "wanderer_001")).startswith("You raise a home here.")
    event_bus.get_events("wanderer_001")  # drain
    mats_after_first = ada.current_materials

    result = await build_home(world, event_bus, "wanderer_001")  # second attempt

    assert result.startswith("Invalid:")
    assert len(world.get_all_homes()) == 1  # still just the one
    assert ada.current_materials == mats_after_first  # no extra cost
    assert event_bus.get_events("wanderer_001") == []


async def test_build_home_when_already_pledged_elsewhere_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A being pledged (stakeholder, not owner) to another's home cannot also build one.

    Regression: ``build_home`` used to check only ``home_of`` (ownership), so a mere
    stakeholder could build a SECOND home and end up staking two -- after which
    ``stakeholder_home_of`` returns the first-inserted home and the being could never
    use the hearth of the home it just built (wrong region). The precondition now
    checks ``stakeholder_home_of``, symmetric with ``pledge_home``.
    """
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("h1", "wanderer_002")  # Boris pledges: stakeholder, not owner
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = HOME_BUILD_MATERIALS_COST * 3  # plenty to build

    result = await build_home(world, event_bus, "wanderer_002")

    assert result.startswith("Invalid:")
    assert len(world.get_all_homes()) == 1  # no second home created
    assert boris.current_materials == HOME_BUILD_MATERIALS_COST * 3  # nothing spent
    assert event_bus.get_events("wanderer_002") == []  # no event


async def test_build_home_recomputes_is_hoarding(world: WorldState, event_bus: EventBus) -> None:
    """Sinking materials into a home can drop a being out of hoarding (is_hoarding recomputed)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOARDING_MATERIALS_THRESHOLD  # exactly hoarding on materials
    assert is_hoarding(ada) is True

    await build_home(world, event_bus, "wanderer_001")

    assert ada.current_materials == HOARDING_MATERIALS_THRESHOLD - HOME_BUILD_MATERIALS_COST
    assert is_hoarding(ada) is False  # the build sank enough materials to end the hoard


# ---- use_hearth -----------------------------------------------------------


async def test_use_hearth_converts_materials_to_energy_at_own_home(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 50.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    burned = HEARTH_MATERIALS_PER_USE  # 50 > 20 -> burns the per-use cap
    assert ada.current_materials == 50.0 - burned
    assert ada.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    events = event_bus.get_events("wanderer_001")
    used = [e for e in events if e.type == "hearth_used"]
    assert len(used) == 1
    assert used[0].scope is ScopeType.LOCAL
    assert used[0].region == "alpha"
    assert used[0].timestamp == world.now()
    # Neither threshold reached (energy 60 < 500, materials 30 < 300): no announce.
    assert [e for e in events if e.type == "agent_started_hoarding"] == []
    assert result.startswith("You rest at your hearth")


async def test_use_hearth_crossing_energy_threshold_announces_hoarding(
    world: WorldState, event_bus: EventBus
) -> None:
    """A hearth-use whose energy credit crosses the hoarding threshold announces it.

    Mirrors the ``harvest_resources``/``transfer_resource`` crossing announce: a being
    that starts NON-hoarding (below both thresholds) and burns materials that push its
    energy at/over :data:`~core.constants.HOARDING_ENERGY_THRESHOLD` emits exactly one
    ``agent_started_hoarding``.
    """
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_energy = HOARDING_ENERGY_THRESHOLD - 10.0  # 490: below, pre-credit
    ada.current_materials = 25.0  # < HOARDING_MATERIALS_THRESHOLD; enough to burn the full cap
    assert is_hoarding(ada) is False

    await use_hearth(world, event_bus, "wanderer_001")

    assert ada.current_energy == HOARDING_ENERGY_THRESHOLD + 10.0  # 490 + 20 burned = 510
    assert is_hoarding(ada) is True  # the hearth's energy credit crossed the threshold
    started = [
        e for e in event_bus.get_events("wanderer_001") if e.type == "agent_started_hoarding"
    ]
    assert len(started) == 1
    assert started[0].scope is ScopeType.LOCAL
    assert started[0].region == "alpha"
    assert started[0].timestamp == world.now()


async def test_use_hearth_partial_burn_conserves_exactly(
    world: WorldState, event_bus: EventBus
) -> None:
    """Fewer materials than the cap burns exactly what's held; energy gained == burned * rate."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 12.0  # < HEARTH_MATERIALS_PER_USE
    ada.current_energy = 40.0

    await use_hearth(world, event_bus, "wanderer_001")

    burned = 12.0
    assert ada.current_materials == 0.0  # all fuel consumed
    assert ada.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    # Conservation: the energy gained is exactly the materials destroyed * rate — no mint.
    assert (ada.current_energy - 40.0) == burned * HEARTH_ENERGY_PER_MATERIAL


async def test_use_hearth_not_at_home_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.move_agent("wanderer_001", "beta") is True  # walk away from the home
    ada.current_materials = 50.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0 and ada.current_energy == 40.0  # nothing converted


async def test_use_hearth_without_a_home_is_error(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 50.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Error:")
    assert ada.current_materials == 50.0


async def test_use_hearth_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot use a hearth (defensive: the registry also guards this)."""
    result = await use_hearth(world, event_bus, "ghost")
    assert result.startswith("Error:")


async def test_use_hearth_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """Paralysis stays social: a fallen being cannot self-revive at its own hearth."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 50.0
    world.modify_agent_energy("wanderer_001", -(ada.current_energy - 1.0))  # -> PARALYZED
    assert ada.status is AgentStatus.PARALYZED

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0  # no conversion
    assert ada.status is AgentStatus.PARALYZED  # still fallen; only a friend can revive


async def test_use_hearth_with_no_materials_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 0.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_energy == 40.0  # no energy minted from nothing


# ---- pledge_home ------------------------------------------------------------


async def test_pledge_home_joins_as_stakeholder_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert world.is_stakeholder("h1", "wanderer_002") is True
    joined = [e for e in event_bus.get_events("wanderer_002") if e.type == "home_joined"]
    assert len(joined) == 1
    assert joined[0].scope is ScopeType.LOCAL
    assert joined[0].region == "alpha"
    assert joined[0].source == "wanderer_002"
    assert joined[0].timestamp == world.now()
    assert result.startswith("You pledge yourself to this home")


async def test_pledge_home_unknown_home_is_error(world: WorldState, event_bus: EventBus) -> None:
    result = await pledge_home(world, event_bus, "wanderer_002", "nope")
    assert result.startswith("Error:")


async def test_pledge_home_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot pledge (defensive: the registry also guards this)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    result = await pledge_home(world, event_bus, "ghost", "h1")

    assert result.startswith("Error:")
    assert world.is_stakeholder("h1", "ghost") is False


async def test_pledge_home_not_co_located_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.move_agent("wanderer_002", "beta") is True  # walk away

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_pledge_home_when_already_in_a_home_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.build_home(
        "h2", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")  # already owns h2

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_pledge_home_when_already_a_stakeholder_elsewhere_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """The at-most-one-home invariant blocks a plain (non-owner) stakeholder too.

    ``wanderer_002`` never owns anything here — it pledges into ``h1`` (owned by
    ``wanderer_001``), then tries to also pledge into ``h2`` (owned by a third,
    unregistered id — ``WorldState.build_home`` does not require the owner to be a
    live agent). The second pledge must be rejected even though ``wanderer_002``
    holds no ownership anywhere, proving the guard checks stakeholder-anywhere, not
    just ``home_of``.
    """
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.build_home(
        "h2", "wanderer_003", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    first = await pledge_home(world, event_bus, "wanderer_002", "h1")
    assert first.startswith("You pledge yourself to this home")
    event_bus.get_events("wanderer_002")  # drain

    result = await pledge_home(world, event_bus, "wanderer_002", "h2")

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h2", "wanderer_002") is False
    assert world.is_stakeholder("h1", "wanderer_002") is True  # unchanged: still only in h1
    assert event_bus.get_events("wanderer_002") == []  # no event from the rejected second pledge


async def test_pledge_home_already_a_stakeholder_of_this_home_is_a_benign_noop(
    world: WorldState, event_bus: EventBus
) -> None:
    """Re-pledging to the SAME home is a benign no-op, not the generic multi-home rejection.

    Distinct from :func:`test_pledge_home_when_already_in_a_home_is_invalid` (a DIFFERENT
    home, genuinely rejected): re-pledging to the home you already tend is idempotent and
    harmless, so it gets its own message rather than the "you may share only one" rejection.
    """
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    first = await pledge_home(world, event_bus, "wanderer_002", "h1")
    assert first.startswith("You pledge yourself to this home")
    event_bus.get_events("wanderer_002")  # drain

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")  # pledge again, same home

    assert result == "You already tend this home."
    home = world.get_home("h1")
    assert home is not None
    assert home.stakeholders.count("wanderer_002") == 1  # no duplicate entry
    assert event_bus.get_events("wanderer_002") == []  # no second event


async def test_pledge_home_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_energy("wanderer_002", -(boris.current_energy - 1.0))  # -> PARALYZED
    assert boris.status is AgentStatus.PARALYZED

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


# ---- leave_home -----------------------------------------------------------


async def test_leave_home_departs_prunes_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("h1", "wanderer_002")
    event_bus.get_events("wanderer_002")  # drain

    result = await leave_home(world, event_bus, "wanderer_002")

    assert world.is_stakeholder("h1", "wanderer_002") is False  # pruned
    left = [e for e in event_bus.get_events("wanderer_002") if e.type == "home_left"]
    assert len(left) == 1
    assert left[0].scope is ScopeType.LOCAL and left[0].region == "alpha"
    assert result.startswith("You give up your place")


async def test_leave_home_owner_departs_promotes_and_clamps(
    world: WorldState, event_bus: EventBus
) -> None:
    """An owner leaving promotes the survivor and clamps integrity — same rule as death."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("h1", "wanderer_002")  # [001, 002] -> M(2)=150
    world.modify_home_integrity("h1", 100.0)  # heal up to 150

    await leave_home(world, event_bus, "wanderer_001")  # owner leaves

    home = world.get_home("h1")
    assert home is not None
    assert home.owner_id == "wanderer_002"  # promoted
    assert home.integrity == 100.0  # clamped to M(1)


async def test_leave_home_when_not_in_a_home_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    result = await leave_home(world, event_bus, "wanderer_002")
    assert result.startswith("Error:")


async def test_leave_home_last_stakeholder_leaves_standing_empty_home(
    world: WorldState, event_bus: EventBus
) -> None:
    """The sole stakeholder leaving empties the home but leaves it standing (the tick decays it)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    result = await leave_home(world, event_bus, "wanderer_001")

    home = world.get_home("h1")
    assert home is not None  # standing, not deleted -- the world-tick decays it later
    assert home.stakeholders == []
    assert home.integrity == HOME_MAX_INTEGRITY  # re-clamped to max_integrity(0) == BASE, unchanged
    assert result.startswith("You give up your place")


async def test_leave_home_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot leave (defensive: the registry also guards this)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    result = await leave_home(world, event_bus, "ghost")

    assert result.startswith("Error:")
    assert world.is_stakeholder("h1", "ghost") is False


# ---- use_hearth widened to stakeholders -----------------------------------


async def test_use_hearth_works_for_nonowner_stakeholder_and_burns_personal_materials(
    world: WorldState, event_bus: EventBus
) -> None:
    """A pledged (non-owner) stakeholder may hearth; it burns their OWN materials (conservation)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("h1", "wanderer_002")  # Boris is a stakeholder, not the owner
    boris = world.get_agent("wanderer_002")
    ada = world.get_agent("wanderer_001")
    assert boris is not None and ada is not None
    boris.current_materials = 50.0
    boris.current_energy = 40.0
    ada.current_materials = 5.0  # the OWNER's stock must be untouched
    ada.current_energy = 5.0

    result = await use_hearth(world, event_bus, "wanderer_002")

    burned = HEARTH_MATERIALS_PER_USE
    assert boris.current_materials == 50.0 - burned  # burned from Boris's own stock
    assert boris.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    assert (
        ada.current_materials == 5.0 and ada.current_energy == 5.0
    )  # owner untouched (no vault fuel)
    used = [e for e in event_bus.get_events("wanderer_002") if e.type == "hearth_used"]
    assert len(used) == 1
    assert result.startswith("You rest at your hearth")

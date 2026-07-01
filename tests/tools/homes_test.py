"""Tests for :mod:`tools.builtin.homes` — ``build_home``, ``use_hearth``,
``pledge_home``, ``leave_home``, ``deposit_to_home``, ``withdraw_from_home``.

``build_home`` sinks materials to raise a private home in the being's region and
emits ``home_built``. ``use_hearth`` burns a stakeholder's own materials at a home it
shares for energy (a conversion, never a mint) and emits ``hearth_used``; any
stakeholder (owner or pledged) may use it. ``pledge_home`` joins a co-located being
into a home's stakeholders (sharing its upkeep and hearth) and emits ``home_joined``.
``leave_home`` gives up a being's stake (pruning it, promoting a new owner if needed,
and clamping integrity) and emits ``home_left``. ``deposit_to_home`` moves a
stakeholder's personal materials into the home's shared vault (conserved: deduct
personal first, then credit the vault) and emits ``home_started_hoarding`` only on
the crossing into a home-level hoard. ``withdraw_from_home`` is the inverse: it moves
materials from the vault back into personal stock (conserved: deduct the vault first,
then credit personal) and is always silent (a withdrawal only lowers the vault, so it
can never cross into a hoard). All six report lookup/precondition failures with
``Error:`` and rule violations with ``Invalid:``.
"""

from __future__ import annotations

import pytest

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    BREAKIN_ENERGY_COST,
    BREAKIN_INTEGRITY_DAMAGE,
    BREAKIN_MATERIALS_COST,
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_ENERGY_THRESHOLD,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tests.conftest import FakeClock
from tools.builtin.homes import (
    break_in,
    build_home,
    deposit_to_home,
    leave_home,
    pledge_home,
    use_hearth,
    withdraw_from_home,
)
from world.agents import AgentState, AgentStatus, is_hoarding
from world.homes import HomeStatus, home_is_hoarding
from world.tick import tick
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


# ---- deposit_to_home --------------------------------------------------------


async def test_deposit_to_home_moves_personal_to_vault_conserving(
    world: WorldState, event_bus: EventBus
) -> None:
    """A deposit moves materials personal -> vault, exactly (personal down == vault up)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 40.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert ada.current_materials == 60.0  # personal down 40
    assert home.vault_materials == 40.0  # vault up 40 (conserved: same 40 moved)
    # Silent per-deposit: no home_started_hoarding (well below threshold) and no plain event.
    assert [
        e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"
    ] == []
    assert result.startswith("You set")


async def test_deposit_to_home_cannot_deposit_more_than_personal(
    world: WorldState, event_bus: EventBus
) -> None:
    """Requesting more than the being holds is Invalid and mutates nothing (no mint)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 10.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 25.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 10.0  # untouched
    assert home.vault_materials == 0.0  # nothing minted into the vault
    assert event_bus.get_events("wanderer_001") == []


async def test_deposit_to_home_crossing_threshold_announces_once(
    world: WorldState, event_bus: EventBus
) -> None:
    """A deposit that lifts the vault to/over the hoard threshold emits one home_started_hoarding.

    A second deposit while ALREADY hoarding must NOT re-announce (mirrors the per-agent
    was_hoarding snapshot: only the crossing is announced).
    """
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    home = world.get_home("home_ada")
    assert home is not None
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD - 10.0  # just below
    ada.current_materials = 100.0
    assert home_is_hoarding(home) is False

    await deposit_to_home(world, event_bus, "wanderer_001", 20.0)  # crosses to +10 over

    assert home.vault_materials == HOARDING_MATERIALS_THRESHOLD + 10.0
    assert home_is_hoarding(home) is True
    started = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"]
    assert len(started) == 1
    assert started[0].scope is ScopeType.LOCAL
    assert started[0].region == "alpha"
    assert started[0].timestamp == world.now()

    # Deposit again while already hoarding -> no second announcement.
    await deposit_to_home(world, event_bus, "wanderer_001", 20.0)
    started_again = [
        e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"
    ]
    assert started_again == []


async def test_deposit_to_home_not_at_home_region_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A stakeholder standing away from its home cannot deposit (region check)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.move_agent("wanderer_001", "beta") is True  # walk away from the home
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0  # nothing moved


async def test_deposit_to_home_non_stakeholder_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """A being that stakes no home (co-located with another's home or not) cannot deposit."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")  # in alpha, but NOT a stakeholder of home_ada
    assert boris is not None
    boris.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_002", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Error:")
    assert boris.current_materials == 100.0 and home.vault_materials == 0.0


async def test_deposit_to_home_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A fallen being cannot tend its home's store (mirrors use_hearth's ALIVE guard)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0
    world.modify_agent_energy("wanderer_001", -(ada.current_energy - 1.0))  # -> PARALYZED
    assert ada.status is AgentStatus.PARALYZED

    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0


async def test_deposit_to_home_unknown_agent_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """A missing being cannot deposit (defensive: the registry also guards this)."""
    result = await deposit_to_home(world, event_bus, "ghost", 20.0)
    assert result.startswith("Error:")


async def test_deposit_to_home_non_positive_amount_is_rejected(
    world: WorldState, event_bus: EventBus
) -> None:
    """A zero/negative amount is rejected before any mutation (shared amount coercion)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", -5.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0


# ---- withdraw_from_home -----------------------------------------------------


async def test_withdraw_from_home_moves_vault_to_personal_conserving(
    world: WorldState, event_bus: EventBus
) -> None:
    """A withdrawal moves materials vault -> personal, exactly (vault down == personal up)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 60.0)
    ada.current_materials = 10.0

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 25.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert home.vault_materials == 35.0  # vault down 25
    assert ada.current_materials == 35.0  # personal up 25 (conserved: same 25 moved)
    assert event_bus.get_events("wanderer_001") == []  # withdrawal is silent
    assert result.startswith("You draw")


async def test_withdraw_from_home_cannot_withdraw_more_than_vault(
    world: WorldState, event_bus: EventBus
) -> None:
    """Requesting more than the vault holds is Invalid and mutates nothing (no mint)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 30.0)
    ada.current_materials = 10.0

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 50.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 30.0  # untouched
    assert ada.current_materials == 10.0  # nothing minted to personal


async def test_withdraw_from_home_not_at_home_region_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    assert world.move_agent("wanderer_001", "beta") is True  # walk away

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 10.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 40.0  # nothing moved


async def test_withdraw_from_home_non_stakeholder_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    boris = world.get_agent("wanderer_002")  # co-located, not a stakeholder
    assert boris is not None
    boris.current_materials = 5.0

    result = await withdraw_from_home(world, event_bus, "wanderer_002", 10.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Error:")
    assert home.vault_materials == 40.0 and boris.current_materials == 5.0


async def test_withdraw_from_home_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A fallen being cannot draw from its home's store (mirrors use_hearth's ALIVE guard)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    ada.current_materials = 10.0
    world.modify_agent_energy("wanderer_001", -(ada.current_energy - 1.0))  # -> PARALYZED
    assert ada.status is AgentStatus.PARALYZED

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 40.0 and ada.current_materials == 10.0


async def test_withdraw_from_home_unknown_agent_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    result = await withdraw_from_home(world, event_bus, "ghost", 10.0)
    assert result.startswith("Error:")


async def test_withdraw_from_home_non_positive_amount_is_rejected(
    world: WorldState, event_bus: EventBus
) -> None:
    """A zero/negative amount is rejected before any mutation (shared amount coercion)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    ada.current_materials = 10.0

    result = await withdraw_from_home(world, event_bus, "wanderer_001", -5.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 40.0 and ada.current_materials == 10.0


async def test_deposit_then_withdraw_conserves_total_materials_and_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """The single most valuable test: vault ops MOVE materials, never mint; energy is untouched.

    Totals are summed across agents + regions + home vaults. A deposit then a withdrawal
    leaves both the world's total materials AND its total energy exactly where they started
    (region regen is not run here, so the sums are strictly invariant).
    """

    def total_materials(w: WorldState) -> float:
        return (
            sum(a.current_materials for a in w.get_all_agents())
            + sum(r.current_materials for r in w.get_all_regions())
            + sum(h.vault_materials for h in w.get_all_homes())
        )

    def total_energy(w: WorldState) -> float:
        return sum(a.current_energy for a in w.get_all_agents()) + sum(
            r.current_energy for r in w.get_all_regions()
        )

    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0
    materials_before = total_materials(world)
    energy_before = total_energy(world)

    await deposit_to_home(world, event_bus, "wanderer_001", 40.0)
    await withdraw_from_home(world, event_bus, "wanderer_001", 15.0)

    assert total_materials(world) == pytest.approx(materials_before)  # nothing minted/lost
    assert total_energy(world) == pytest.approx(energy_before)  # vault is materials-only


# ---- RUIN status guards (L2c Task 2) --------------------------------------


async def test_pledge_home_to_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """A being cannot pledge to a ruin (get_home returns it, so this guard is real)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["h1"].status = HomeStatus.RUIN
    result = await pledge_home(world, event_bus, "wanderer_002", "h1")
    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_use_hearth_in_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """A stakeholder cannot hearth in a ruin (defence-in-depth: kept as a stakeholder here)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN  # keep stakeholders (do NOT use make_ruin)
    ada.current_materials = 50.0
    result = await use_hearth(world, event_bus, "wanderer_001")
    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0  # nothing burned


async def test_deposit_to_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN
    ada.current_materials = 100.0
    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and world.homes["home_ada"].vault_materials == 0.0


async def test_withdraw_from_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.deposit_to_home_vault("home_ada", 40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN
    result = await withdraw_from_home(world, event_bus, "wanderer_001", 10.0)
    assert result.startswith("Invalid:")
    assert world.homes["home_ada"].vault_materials == 40.0


async def test_leave_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["h1"].status = HomeStatus.RUIN  # keep the owner as a stakeholder
    result = await leave_home(world, event_bus, "wanderer_001")
    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_001") is True  # still bound


# ---- break_in (L2c Task 3) -------------------------------------------------


def _add_raiders(world: WorldState, event_bus: EventBus, *ids: str) -> None:
    """Add ALIVE, well-supplied raiders co-located in ``alpha`` (subscribed to the bus)."""
    for rid in ids:
        world.add_agent(
            AgentState(
                id=rid,
                name=rid.title(),
                persona="p",
                current_position="alpha",
                current_energy=100.0,
                current_materials=100.0,
                status=AgentStatus.ALIVE,
            )
        )
        event_bus.subscribe(rid)


async def test_break_in_damages_integrity_and_records_the_breacher(
    world: WorldState, event_bus: EventBus
) -> None:
    """A valid break_in wears the home by BREAKIN_INTEGRITY_DAMAGE and records the raider."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    boris = world.get_agent("wanderer_002")  # co-located, NOT a stakeholder of h1
    assert boris is not None

    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    home = world.get_home("h1")
    assert home is not None
    assert home.integrity == 100.0 - BREAKIN_INTEGRITY_DAMAGE  # 75
    assert home.breachers == {"wanderer_002"}
    assert home.status is HomeStatus.STANDING
    assert result.startswith("You batter")


async def test_break_in_cost_is_a_pure_sink(world: WorldState, event_bus: EventBus) -> None:
    """The energy+materials cost is destroyed — credited to NO agent/region/vault
    (conservation)."""

    def total_energy(w: WorldState) -> float:
        return sum(a.current_energy for a in w.get_all_agents()) + sum(
            r.current_energy for r in w.get_all_regions()
        )

    def total_materials(w: WorldState) -> float:
        return (
            sum(a.current_materials for a in w.get_all_agents())
            + sum(r.current_materials for r in w.get_all_regions())
            + sum(h.vault_materials for h in w.get_all_homes())
        )

    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = 100.0  # round starting balance (fixture default is 50.0)
    e0, m0 = total_energy(world), total_materials(world)

    await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    assert boris.current_energy == 100.0 - BREAKIN_ENERGY_COST
    assert boris.current_materials == 100.0 - BREAKIN_MATERIALS_COST
    assert total_energy(world) == pytest.approx(e0 - BREAKIN_ENERGY_COST)  # gone, not moved
    assert total_materials(world) == pytest.approx(m0 - BREAKIN_MATERIALS_COST)


async def test_break_in_breaches_at_zero_and_announces(
    world: WorldState, event_bus: EventBus
) -> None:
    """A blow driving integrity <= 0 breaches: home_breached fires; home STANDING at 0
    (outcome is Task 4)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=BREAKIN_INTEGRITY_DAMAGE
    )  # one blow from breach
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    home = world.get_home("h1")
    assert home is not None
    assert home.integrity == 0.0
    assert home.status is HomeStatus.STANDING  # Task 4 executes the intent; here it just breaches
    breached = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_breached"]
    assert len(breached) == 1
    assert breached[0].scope is ScopeType.LOCAL and breached[0].region == "alpha"
    assert "break" in result.lower()


async def test_break_in_lone_raider_is_out_healed_across_a_window(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A lone raider (1 blow/window) is out-healed by one covered repair tick and burns
    resources."""
    ada = world.get_agent("wanderer_001")
    boris = world.get_agent("wanderer_002")
    assert ada is not None and boris is not None
    ada.current_materials = 1000.0  # owner solvent -> covered repair every tick
    boris.current_materials = 100.0  # round starting balance (fixture default is 50.0)
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)

    await break_in(world, event_bus, "wanderer_002", "h1", "thieve")  # -25 -> 75
    fake_clock.advance(5.0)
    await tick(world, event_bus)  # +HOME_REPAIR_PER_SECOND*5 == +50 -> clamped to 100

    home = world.get_home("h1")
    assert home is not None and home.integrity == 100.0  # out-healed, no progress
    # But the raider still paid (self-limiting).
    assert boris.current_energy == 100.0 - BREAKIN_ENERGY_COST
    assert boris.current_materials == 100.0 - BREAKIN_MATERIALS_COST


async def test_break_in_coordinated_group_out_damages_one_repair_window(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Three raiders in one window out-damage a single repair tick (> 2/window -> net progress)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 1000.0
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    _add_raiders(world, event_bus, "raider_a", "raider_b")  # + wanderer_002 = three raiders

    for rid in ("wanderer_002", "raider_a", "raider_b"):  # 3 * 25 == 75 in one window
        await break_in(world, event_bus, rid, "h1", "thieve")
    home = world.get_home("h1")
    assert home is not None and home.integrity == 25.0  # 100 - 75

    fake_clock.advance(5.0)
    await tick(world, event_bus)  # covered repair +50 -> 75 (< 100: the group made net progress)
    assert home.integrity == 75.0
    # Accumulated (not fully repaired).
    assert home.breachers == {"wanderer_002", "raider_a", "raider_b"}


async def test_break_in_guards(world: WorldState, event_bus: EventBus) -> None:
    """Every guard rejects with no mutation: bad intent, unknown home, own home, not
    co-located, too poor."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    ada = world.get_agent("wanderer_001")
    boris = world.get_agent("wanderer_002")
    assert ada is not None and boris is not None

    bad_intent = await break_in(world, event_bus, "wanderer_002", "h1", "wreck")
    assert bad_intent.startswith("Invalid:")
    no_home = await break_in(world, event_bus, "wanderer_002", "nope", "thieve")
    assert no_home.startswith("Error:")
    own_home = await break_in(world, event_bus, "wanderer_001", "h1", "thieve")
    assert own_home.startswith("Invalid:")
    assert world.move_agent("wanderer_002", "beta") is True
    not_co_located = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")
    assert not_co_located.startswith("Invalid:")
    assert world.move_agent("wanderer_002", "alpha") is True
    boris.current_materials = BREAKIN_MATERIALS_COST - 1.0  # too poor
    assert (await break_in(world, event_bus, "wanderer_002", "h1", "thieve")).startswith("Invalid:")
    assert world.homes["h1"].integrity == 100.0  # nothing above ever damaged the home
    assert world.homes["h1"].breachers == set()


# ---- break_in thieve outcome (L2c Task 4a) ---------------------------------


async def test_break_in_thieve_splits_vault_conserved_and_leaves_standing_at_zero(
    world: WorldState, event_bus: EventBus
) -> None:
    """The breaching blow with intent=thieve splits the vault among co-located living breachers,
    zeros it, leaves the home STANDING at 0 (MANDATORY #2), and conserves the materials moved."""
    world.build_home(
        "h1",
        "wanderer_001",
        "alpha",
        built_at=world.now(),
        integrity=2 * BREAKIN_INTEGRITY_DAMAGE,
    )  # two blows from breach
    world.deposit_to_home_vault("h1", 90.0)
    _add_raiders(world, event_bus, "raider_a")
    boris = world.get_agent("wanderer_002")
    raider_a = world.get_agent("raider_a")
    assert boris is not None and raider_a is not None
    boris.current_materials = 40.0
    raider_a.current_materials = 40.0

    # raider_a: -25 -> 25 (pre-breach, records raider_a).
    await break_in(world, event_bus, "raider_a", "h1", "thieve")
    # wanderer_002: -25 -> 0 -> breach + thieve.
    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    home = world.get_home("h1")
    assert home is not None
    assert home.status is HomeStatus.STANDING  # MANDATORY #2: standing at 0, NOT a ruin
    assert home.integrity == 0.0
    assert home.vault_materials == 0.0  # emptied
    # 90 split two ways == 45 each (remainder to the final striker, wanderer_002).
    assert boris.current_materials == pytest.approx(40.0 - BREAKIN_MATERIALS_COST + 45.0)
    assert raider_a.current_materials == pytest.approx(40.0 - BREAKIN_MATERIALS_COST + 45.0)
    thieved = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_thieved"]
    assert len(thieved) == 1
    assert thieved[0].scope is ScopeType.LOCAL and thieved[0].region == "alpha"
    assert "strip" in result.lower()


async def test_break_in_thieve_excludes_departed_or_dead_breachers(
    world: WorldState, event_bus: EventBus
) -> None:
    """A breacher who left the region (or died) is not a recipient; the whole vault still goes to
    the remaining co-located living breachers (Σ == vault; remainder to the final striker)."""
    world.build_home(
        "h1",
        "wanderer_001",
        "alpha",
        built_at=world.now(),
        integrity=2 * BREAKIN_INTEGRITY_DAMAGE,
    )
    world.deposit_to_home_vault("h1", 100.0)
    _add_raiders(world, event_bus, "raider_a")
    boris = world.get_agent("wanderer_002")
    raider_a = world.get_agent("raider_a")
    assert boris is not None and raider_a is not None
    boris.current_materials = 0.0

    # Records raider_a, integrity -> 25.
    await break_in(world, event_bus, "raider_a", "h1", "thieve")
    assert world.move_agent("raider_a", "beta") is True  # raider_a wanders off before the breach
    # wanderer_002 needs to afford the cost; give it materials for the break_in fee only.
    boris.current_materials = BREAKIN_MATERIALS_COST
    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")  # breach + thieve

    home = world.get_home("h1")
    assert home is not None and home.vault_materials == 0.0
    # Only wanderer_002 is co-located+alive -> it takes the whole 100 (remainder-to-final-striker).
    assert boris.current_materials == pytest.approx(100.0)  # 0 after paying the fee, +100 loot
    assert "strip" in result.lower()

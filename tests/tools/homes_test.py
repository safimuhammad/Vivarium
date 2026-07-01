"""Tests for :mod:`tools.builtin.homes` — ``build_home`` and ``use_hearth``.

``build_home`` sinks materials to raise a private home in the being's region and
emits ``home_built``. ``use_hearth`` burns materials at the being's own home for
energy (a conversion, never a mint) and emits ``hearth_used``. Both report
lookup/precondition failures with ``Error:`` and rule violations with ``Invalid:``.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.homes import build_home, use_hearth
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
    used = [e for e in event_bus.get_events("wanderer_001") if e.type == "hearth_used"]
    assert len(used) == 1
    assert used[0].scope is ScopeType.LOCAL
    assert used[0].region == "alpha"
    assert used[0].timestamp == world.now()
    assert result.startswith("You rest at your hearth")


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

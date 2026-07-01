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
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.homes import build_home
from world.agents import is_hoarding
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

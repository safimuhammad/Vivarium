"""Map-registry and gate-handoff coverage for regional spatial travel."""

from __future__ import annotations

import pytest

from bus.event_bus import EventBus
from core.constants import MOVE_ENERGY_COST, PARALYSIS_ENERGY_THRESHOLD
from tests.conftest import FakeClock
from tools.builtin.homes import use_hearth
from tools.builtin.movement import move, stop_moving
from world.agents import AgentState, AgentStatus
from world.homes import Home
from world.regions import Region
from world.spatial import SpatialWorld, SpatialWorldBundle
from world.world import WorldState


def _map(region_id: str, neighbor: str, *, include_gates: bool = True) -> SpatialWorld:
    """Return a tiny map with one exact departure and one exact arrival gate."""
    payload: dict[str, object] = {
        "version": 1,
        "region_id": region_id,
        "map_id": f"{region_id}:regional-test",
        "layout_fingerprint": f"{region_id}-regional-test",
        "tile_size": 32,
        "width": 3,
        "height": 1,
        "topology": "bounded",
        "walkable": [[1, 1, 1]],
        "landmarks": [
            {
                "id": f"arrival-{neighbor}",
                "name": f"Arrival from {neighbor}",
                "x": 16,
                "y": 16,
                "affordances": ["entrance"],
            },
            {
                "id": f"gate-{neighbor}",
                "name": f"Path toward {neighbor}",
                "x": 80,
                "y": 16,
                "affordances": ["exit"],
            },
        ],
        # This is intentionally distinct from the entrance, proving a migration
        # never falls back to deterministic/random staging placement.
        "spawn_points": [{"id": "ordinary-spawn", "x": 48, "y": 16}],
        "initial_pressure": {"populationHighWater": 1, "builtFootprintHighWater": 0},
    }
    if include_gates:
        payload["gates"] = [
            {
                "from_region": region_id,
                "to_region": neighbor,
                "role": "departure",
                "x": 80,
                "y": 16,
            },
            {
                "from_region": neighbor,
                "to_region": region_id,
                "role": "arrival",
                "x": 16,
                "y": 16,
            },
        ]
    return SpatialWorld.from_mapping(payload)


def _regions() -> list[Region]:
    """Return a two-way spatial region pair."""
    return [
        Region("alpha", "Alpha.", ["beta"], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0),
        Region("beta", "Beta.", ["alpha"], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0),
    ]


def test_v2_bundle_constructs_one_map_per_region() -> None:
    """The v2 exporter container preserves independently validated v1 maps."""
    alpha = _map("alpha", "beta")
    beta = _map("beta", "alpha")

    bundle = SpatialWorldBundle.from_mapping(
        {
            "version": 2,
            "regions": [
                {
                    "version": 1,
                    "region_id": alpha.region_id,
                    "map_id": alpha.map_id,
                    "layout_fingerprint": alpha.layout_fingerprint,
                    "tile_size": alpha.tile_size,
                    "width": alpha.columns,
                    "height": alpha.rows,
                    "topology": "bounded",
                    "walkable": [[1, 1, 1]],
                    "landmarks": [site.to_json() for site in alpha.landmarks],
                    "gates": [gate.to_json() for gate in alpha.gates],
                    "spawn_points": [{"id": "ordinary-spawn", "x": 48, "y": 16}],
                    "initial_pressure": {
                        "populationHighWater": 1,
                        "builtFootprintHighWater": 0,
                    },
                },
                {
                    "version": 1,
                    "region_id": beta.region_id,
                    "map_id": beta.map_id,
                    "layout_fingerprint": beta.layout_fingerprint,
                    "tile_size": beta.tile_size,
                    "width": beta.columns,
                    "height": beta.rows,
                    "topology": "bounded",
                    "walkable": [[1, 1, 1]],
                    "landmarks": [site.to_json() for site in beta.landmarks],
                    "gates": [gate.to_json() for gate in beta.gates],
                    "spawn_points": [{"id": "ordinary-spawn", "x": 48, "y": 16}],
                    "initial_pressure": {
                        "populationHighWater": 1,
                        "builtFootprintHighWater": 0,
                    },
                },
            ],
        }
    )

    assert [spatial.region_id for spatial in bundle.regions] == ["alpha", "beta"]
    assert bundle.by_region("beta").departure_gate("alpha") is not None


def test_region_journey_uses_gates_and_never_respawns_at_the_target() -> None:
    """A paid move stays local until its exit and then enters at the paired gate."""
    clock = FakeClock(start=10.0)
    alpha = _map("alpha", "beta")
    beta = _map("beta", "alpha")
    walker = AgentState("walker", "Walker", "", "alpha", 40.0, 0.0, AgentStatus.ALIVE)
    world = WorldState(_regions(), [walker], clock=clock, spatial=alpha)
    world.attach_spatial(beta)

    outcome = world.begin_region_travel("walker", "beta", move_energy_cost=5.0)

    assert world.spatial is alpha  # legacy singleton callers retain their first attached map.
    assert world.spatial_for_region("beta") is beta
    assert world.spatial_for_agent("walker") is alpha
    assert outcome.travel is not None
    assert outcome.travel.destination_region == "beta"
    assert outcome.travel.id.startswith("alpha:walker:travel:")
    assert walker.current_energy == 35.0
    assert walker.current_position == "alpha"
    assert alpha.position_at("walker", clock())["travel"] is not None

    clock.advance(outcome.travel.arrives_at - clock())
    transition = alpha.tick(clock())[0]
    handoff = world.complete_region_travel(alpha, transition)

    assert handoff.destination_region == "beta"
    assert walker.current_position == "beta"
    assert not alpha.has_agent("walker")
    assert beta.position_at("walker", clock())["x"] == 16.0
    assert beta.position_at("walker", clock())["y"] == 16.0
    assert world.spatial_for_agent("walker") is beta

    returning = world.begin_region_travel("walker", "alpha", move_energy_cost=5.0)
    assert returning.travel is not None
    clock.advance(returning.travel.arrives_at - clock())
    world.complete_region_travel(beta, beta.tick(clock())[0])

    departing_again = world.begin_region_travel("walker", "beta", move_energy_cost=5.0)
    assert departing_again.travel is not None
    assert departing_again.travel.id == "alpha:walker:travel:2"


def test_repeated_regional_intent_never_rechecks_or_charges_the_paid_cost() -> None:
    """A retry keeps an accepted gate journey even after its first payment."""
    clock = FakeClock(start=10.0)
    walker = AgentState("walker", "Walker", "", "alpha", 11.0, 0.0, AgentStatus.ALIVE)
    world = WorldState(_regions(), [walker], clock=clock, spatial=_map("alpha", "beta"))
    world.attach_spatial(_map("beta", "alpha"))

    first = world.begin_region_travel("walker", "beta", move_energy_cost=MOVE_ENERGY_COST)
    repeated = world.begin_region_travel("walker", "beta", move_energy_cost=MOVE_ENERGY_COST)

    assert first.status == "started"
    assert repeated.status == "already_traveling"
    assert repeated.travel is first.travel
    assert walker.current_energy == 6.0


@pytest.mark.parametrize(
    "energy",
    [MOVE_ENERGY_COST - 1, MOVE_ENERGY_COST, MOVE_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD],
)
@pytest.mark.parametrize("has_local_route", [False, True])
async def test_exhausting_regional_journey_is_rejected_atomically(
    energy: float, has_local_route: bool
) -> None:
    """A new paid walk must leave usable energy and preserve any rejected redirect."""
    clock = FakeClock(start=10.0)
    source = _map("alpha", "beta")
    walker = AgentState("walker", "Walker", "", "alpha", energy, 0.0, AgentStatus.ALIVE)
    world = WorldState(_regions(), [walker], clock=clock, spatial=source)
    world.attach_spatial(_map("beta", "alpha"))
    bus = EventBus(world)
    assert bus.subscribe("walker")
    if has_local_route:
        source.begin_travel("walker", "arrival-beta", clock())
    original_route = source.active_travel("walker")
    original_position = source.position_at("walker", clock())

    result = await move(world, bus, "walker", "beta")

    assert result.startswith("Invalid: Cannot move to beta,")
    assert walker.current_position == "alpha"
    assert walker.current_energy == energy
    assert walker.status is AgentStatus.ALIVE
    assert source.active_travel("walker") is original_route
    assert source.position_at("walker", clock()) == original_position
    assert source.tick(clock()) == []
    assert bus.get_events("walker") == []


def test_zero_distance_gate_journey_still_runs_the_explicit_handoff() -> None:
    """Standing on an exit never bypasses the destination entrance contract."""
    clock = FakeClock(start=10.0)
    source = _map("alpha", "beta")
    destination = _map("beta", "alpha")
    walker = AgentState("walker", "Walker", "", "alpha", 20.0, 0.0, AgentStatus.ALIVE)
    world = WorldState(_regions(), [walker], clock=clock, spatial=source)
    world.attach_spatial(destination)
    departure = source.departure_gate("beta")
    assert departure is not None
    source.remove_agent(walker.id)
    source.place_at(walker.id, departure.point(), clock())

    outcome = world.begin_region_travel("walker", "beta", move_energy_cost=MOVE_ENERGY_COST)

    assert outcome.status == "started"
    assert outcome.travel is not None
    assert outcome.travel.arrives_at == clock()
    transition = source.tick(clock())[0]
    handoff = world.complete_region_travel(source, transition)
    assert handoff.destination_position.x == 16.0
    assert walker.current_position == "beta"


async def test_mapped_edge_with_missing_gate_fails_without_legacy_relocation() -> None:
    """Missing map-gate data remains a loud rejected command, never a teleport."""
    clock = FakeClock(start=10.0)
    walker = AgentState("walker", "Walker", "", "alpha", 20.0, 0.0, AgentStatus.ALIVE)
    world = WorldState(
        _regions(),
        [walker],
        clock=clock,
        spatial=_map("alpha", "beta", include_gates=False),
    )
    world.attach_spatial(_map("beta", "alpha"))
    bus = EventBus(world)
    assert bus.subscribe("walker")

    result = await move(world, bus, "walker", "beta")

    assert result.startswith("Invalid: Cannot move to beta, No matched authored gate")
    assert walker.current_position == "alpha"
    assert walker.current_energy == 20.0
    assert bus.get_events("walker") == []


async def test_move_uses_a_timed_gate_journey_and_stop_keeps_the_paid_cost() -> None:
    """Mapped moves do not publish legacy migration until an actual handoff."""
    clock = FakeClock(start=10.0)
    walker = AgentState("walker", "Walker", "", "alpha", 20.0, 0.0, AgentStatus.ALIVE)
    world = WorldState(_regions(), [walker], clock=clock, spatial=_map("alpha", "beta"))
    world.attach_spatial(_map("beta", "alpha"))
    bus = EventBus(world)
    assert bus.subscribe("walker")

    started = await move(world, bus, "walker", "beta")

    assert started == "Started travelling from alpha to beta."
    assert walker.current_position == "alpha"
    assert walker.current_energy == 15.0
    events = bus.get_events("walker")
    assert [event.type for event in events] == ["spatial_travel_started"]
    assert events[0].payload["destination_region"] == "beta"
    assert events[0].payload["move_energy_cost"] == MOVE_ENERGY_COST
    assert events[0].payload["agent_energy_before"] == 20.0
    assert events[0].payload["agent_energy"] == 15.0

    assert await move(world, bus, "walker", "beta") == "Already travelling to beta."
    assert walker.current_energy == 15.0
    assert bus.get_events("walker") == []

    assert await stop_moving(world, bus, "walker") == "Came to rest at your current position."
    stopped = bus.get_events("walker")
    assert [event.type for event in stopped] == ["spatial_travel_cancelled"]
    assert stopped[0].payload["destination_region"] == "beta"
    assert walker.current_energy == 15.0


@pytest.mark.parametrize("has_fuel", [False, True])
async def test_hearth_rest_cancels_travel_only_after_successful_validation(has_fuel: bool) -> None:
    """Accepted hearth rest freezes feet; an invalid hearth request preserves travel."""
    clock = FakeClock(start=10.0)
    source = _map("alpha", "beta")
    walker = AgentState(
        "walker", "Walker", "", "alpha", 30.0, 10.0 if has_fuel else 0.0, AgentStatus.ALIVE
    )
    world = WorldState(_regions(), [walker], clock=clock, spatial=source)
    world.attach_spatial(_map("beta", "alpha"))
    world.homes["hearth"] = Home(
        "hearth", "walker", "alpha", 100.0, clock(), clock(), stakeholders=["walker"]
    )
    bus = EventBus(world)
    assert bus.subscribe("walker")
    await move(world, bus, "walker", "beta")
    bus.get_events("walker")
    travel = source.active_travel("walker")
    assert travel is not None
    clock.advance((travel.arrives_at - clock()) / 2)
    resting_position = source.position_at("walker", clock())

    result = await use_hearth(world, bus, "walker")

    if not has_fuel:
        assert result.startswith("Invalid:")
        assert source.active_travel("walker") is travel
        assert source.position_at("walker", clock()) == resting_position
        assert bus.get_events("walker") == []
        return

    assert result.startswith("You rest at your hearth")
    assert source.active_travel("walker") is None
    events = bus.get_events("walker")
    assert [event.type for event in events] == ["spatial_travel_cancelled", "hearth_used"]
    assert events[0].payload["spatial"]["travel"] is None
    assert source.position_at("walker", clock())["travel"] is None
    clock.advance(travel.arrives_at - clock() + 1)
    assert source.tick(clock()) == []
    final_position = source.position_at("walker", clock())
    assert final_position["x"] == resting_position["x"]
    assert final_position["y"] == resting_position["y"]
    assert walker.current_position == "alpha"

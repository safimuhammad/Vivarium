"""Physical perception tests with no model or wall-clock dependency."""

import asyncio
from typing import Any, cast

from agents.compaction import estimate_tokens
from agents.decider import Decision, SerializingDecider
from agents.runtime import Agent
from agents.spatial_perception import SpatialAwareness, spatial_agent_visible
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from observability.event_log import InMemoryEventLog
from tests.conftest import FakeClock, MockDecider
from tests.world.spatial_test import _navigation_config
from tools.registry import ToolRegistry
from world.regions import Region
from world.spatial import SpatialCurrentRead, SpatialLandmark, SpatialPoint, SpatialWorld
from world.world import WorldState


def test_fresh_positions_changes_and_read_only_observation(world: WorldState) -> None:
    """Seeing and remembering are separate; movement updates the next observation."""
    config = _navigation_config()
    config["spawn_points"] = [{"id": "west", "x": 16, "y": 48}, {"id": "east", "x": 144, "y": 48}]
    spatial = SpatialWorld.from_mapping(config)
    world.spatial = spatial
    world.add_region(Region("nirvana", "A grove", [], 1, 1, 100, 100, 500, 500))
    first, second = world.get_all_agents()[:2]
    first.current_position = second.current_position = "nirvana"
    spatial.spawn(first.id, staging_id="west")
    spatial.spawn(second.id, staging_id="east")
    awareness = SpatialAwareness(world, first.id, radius_tiles=2)
    before = spatial.position_at(first.id, 0)
    initial = awareness.render(0)
    assert second.name not in initial
    assert "Known destinations" in initial and "spring" in initial
    assert "Energy available here" not in initial
    awareness.commit()
    spatial.begin_travel(first.id, "spring", 0, speed=32)
    latest = awareness.render(6)
    assert second.name in latest and "Now in view" in latest
    assert "Energy available here" in latest
    assert "persona" not in latest and second.persona not in latest
    assert spatial.position_at(first.id, 0)["x"] == before["x"]
    assert spatial_agent_visible(world, first.id, second.id, 6, radius_tiles=2)
    assert not spatial_agent_visible(world, first.id, second.id, 0, radius_tiles=2)


def test_harvest_context_matches_physical_eligibility_and_current_supply(
    world: WorldState,
) -> None:
    """Current harvesting facts follow movement, arrival, resource type and depletion."""
    config = _navigation_config(collision=[0] * 15)
    config["landmarks"] = [
        {"id": "spring", "name": "Spring", "x": 144, "y": 48, "affordances": ["energy"]},
        {"id": "grove", "name": "Grove", "x": 16, "y": 16, "affordances": ["materials"]},
    ]
    spatial = SpatialWorld.from_mapping(config)
    world.spatial = spatial
    region = Region("nirvana", "A grove", [], 1, 1, 100, 70, 500, 500)
    world.add_region(region)
    state = world.get_all_agents()[0]
    state.current_position = "nirvana"
    spatial.spawn(state.id)
    awareness = SpatialAwareness(world, state.id)

    initial = awareness.render(0)
    assert "energy: unavailable here" in initial
    assert "materials: unavailable here" in initial
    assert "nearest known matching site: Spring [destination_id: spring]" in initial
    assert "nearest known matching site: Grove [destination_id: grove]" in initial

    assert spatial.begin_travel(state.id, "spring", 0, speed=32).travel is not None
    # Arrival time alone does not finalize a journey. Observation must agree
    # with the actual harvesting rule even at the destination before a tick.
    assert spatial.can_gather(state.id, "energy", 10) is None
    assert "energy: unavailable while walking" in awareness.render(10)
    spatial.tick(10)
    assert spatial.can_gather(state.id, "energy", 10) is not None
    arrived = awareness.render(10)
    assert "energy: harvestable here; shared supply 100" in arrived
    assert "materials: unavailable here" in arrived
    assert "nearest known matching site: Grove [destination_id: grove]" in arrived
    region.current_energy = 0
    assert "energy: depleted here; shared supply 0" in awareness.render(10)
    region.current_energy = 12
    assert "energy: harvestable here; shared supply 12" in awareness.render(11)
    assert spatial.begin_travel(state.id, "grove", 11, speed=32).travel is not None
    spatial.tick(21)
    assert spatial.can_gather(state.id, "materials", 21) is not None
    final = awareness.render(21)
    assert "materials: harvestable here; shared supply 70" in final
    assert "energy: unavailable here" in final


def test_awareness_matches_full_snapshot_reference_for_moving_neighbors(
    world: WorldState,
) -> None:
    """The lightweight neighbor read renders byte-for-byte like snapshot-backed reads."""

    class SnapshotBackedCurrentReadSpatialWorld(SpatialWorld):
        """Reference map that reconstructs the new value from the pre-change snapshot path."""

        def current_read(self, agent_id: str, now: float) -> SpatialCurrentRead:
            snapshot = self.position_at(agent_id, now)
            travel = snapshot["travel"]
            destination_id = None
            if isinstance(travel, dict):
                candidate = travel.get("destination_id")
                if isinstance(candidate, str):
                    destination_id = candidate
            return SpatialCurrentRead(
                point=SpatialPoint(cast(float, snapshot["x"]), cast(float, snapshot["y"])),
                destination_id=destination_id,
                observed_at=cast(float, snapshot["observed_at"]),
            )

    config = _navigation_config(collision=[0] * 15)
    config["landmarks"] = [
        {
            "id": "spring",
            "name": "Quiet Spring",
            "x": 144,
            "y": 48,
            "affordances": ["energy"],
        },
        {
            "id": "grove",
            "name": "North Grove",
            "x": 16,
            "y": 16,
            "affordances": ["materials"],
        },
    ]
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 48},
        {"id": "east", "x": 144, "y": 48},
    ]
    spatial = SpatialWorld.from_mapping(config)
    snapshot_reference = cast(
        SnapshotBackedCurrentReadSpatialWorld,
        SnapshotBackedCurrentReadSpatialWorld.from_mapping(config),
    )
    world.add_region(Region("nirvana", "A grove", [], 1, 1, 100, 100, 500, 500))
    first, second = world.get_all_agents()[:2]
    first.current_position = second.current_position = "nirvana"
    for map_state in (spatial, snapshot_reference):
        map_state.spawn(first.id, staging_id="west")
        map_state.spawn(second.id, staging_id="east")
        assert map_state.begin_travel(first.id, "spring", 0.0, speed=32.0).travel is not None
        assert map_state.begin_travel(second.id, "grove", 0.0, speed=32.0).travel is not None

    current = SpatialAwareness(world, first.id, radius_tiles=8)
    reference = SpatialAwareness(world, first.id, radius_tiles=8)
    for now in (0.0, 1.5, 6.0):
        world.spatial = spatial
        current_view = current.render(now)
        current.commit()
        world.spatial = snapshot_reference
        reference_view = reference.render(now)
        reference.commit()
        assert current_view == reference_view


def test_neighbor_senses_and_visibility_avoid_neighbor_snapshots(world: WorldState) -> None:
    """Only the observer builds a full snapshot; local tests use fresh typed reads."""

    class SnapshotGuardSpatialWorld(SpatialWorld):
        """Fail if sensing asks the former full-snapshot path for another being."""

        _observer_id: str
        snapshot_agent_ids: list[str]
        landmark_reads: int

        def begin_guarding(self, observer_id: str) -> None:
            """Reset per-read counters for one observer."""
            self._observer_id = observer_id
            self.snapshot_agent_ids = []
            self.landmark_reads = 0

        def position_at(self, agent_id: str, now: float) -> dict[str, object]:
            """Allow the observer snapshot but reject all neighbor snapshots."""
            self.snapshot_agent_ids.append(agent_id)
            if agent_id != self._observer_id:
                raise AssertionError(f"Neighbor {agent_id!r} requested a full spatial snapshot.")
            return super().position_at(agent_id, now)

        def _landmark_at(self, point: SpatialPoint) -> SpatialLandmark | None:
            """Count snapshot landmark lookups while preserving the map implementation."""
            self.landmark_reads += 1
            return super()._landmark_at(point)

    config = _navigation_config(collision=[0] * 15)
    config["landmarks"] = [
        {
            "id": "spring",
            "name": "Quiet Spring",
            "x": 144,
            "y": 48,
            "affordances": ["energy"],
        },
        {
            "id": "grove",
            "name": "North Grove",
            "x": 16,
            "y": 16,
            "affordances": ["materials"],
        },
    ]
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 48},
        {"id": "east", "x": 144, "y": 48},
    ]
    spatial = cast(SnapshotGuardSpatialWorld, SnapshotGuardSpatialWorld.from_mapping(config))
    world.spatial = spatial
    world.add_region(Region("nirvana", "A grove", [], 1, 1, 100, 100, 500, 500))
    first, second = world.get_all_agents()[:2]
    first.current_position = second.current_position = "nirvana"
    spatial.spawn(first.id, staging_id="west")
    spatial.spawn(second.id, staging_id="east")
    assert spatial.begin_travel(second.id, "grove", 0.0, speed=32.0).travel is not None

    spatial.begin_guarding(first.id)
    view = SpatialAwareness(world, first.id, radius_tiles=5).render(0.0)
    assert second.name in view and "walking toward grove" in view
    assert spatial.snapshot_agent_ids == [first.id]
    assert spatial.landmark_reads == 1

    spatial.begin_guarding(first.id)
    assert spatial_agent_visible(world, first.id, second.id, 0.0, radius_tiles=5)
    assert not spatial_agent_visible(world, first.id, second.id, 0.0, radius_tiles=3)
    assert spatial.snapshot_agent_ids == []
    assert spatial.landmark_reads == 0


async def test_runtime_refreshes_spatial_context_when_local_inference_starts(
    world: WorldState, fake_clock: FakeClock
) -> None:
    """A being walks while queued; the model sees the new position and fresh event."""
    world.add_region(Region("nirvana", "A grove", [], 1, 1, 100, 100, 500, 500))
    spatial = SpatialWorld.from_mapping(_navigation_config())
    world.spatial = spatial
    state = world.get_all_agents()[0]
    state.current_position = "nirvana"
    spatial.spawn(state.id)
    bus = EventBus(world)
    registry = ToolRegistry(world, bus)
    observed: list[list[dict[str, Any]]] = []

    class Probe:
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            observed.append(messages)
            return Decision(text="I see the spring")

    lock = asyncio.Lock()
    await lock.acquire()
    agent = Agent(state.id, world, bus, registry, decider=SerializingDecider(Probe(), lock))
    spatial.begin_travel(state.id, "spring", fake_clock(), speed=32)
    await agent.perceive()
    assert "energy: unavailable while walking" in agent.lifecycle_history[-1]["content"]
    task = asyncio.create_task(agent.decide())
    await asyncio.sleep(0)
    fake_clock.advance(6)
    spatial.tick(fake_clock())
    await bus.publish(
        Event(
            type="speak",
            source=state.id,
            payload={"message": "A fresh sound"},
            scope=ScopeType.LOCAL,
            region="nirvana",
            timestamp=fake_clock(),
        )
    )
    lock.release()
    await task
    assert "Your position: (4.5, 1.5)" in observed[0][-1]["content"]
    assert "A fresh sound" in observed[0][-1]["content"]
    assert "energy: harvestable here; shared supply 100" in observed[0][-1]["content"]
    assert len([m for m in agent.lifecycle_history if m["role"] == "user"]) == 1
    world.regions["nirvana"].current_energy = 17
    await agent.perceive()
    await agent.decide()
    assert "energy: harvestable here; shared supply 17" in observed[1][-1]["content"]


async def test_local_events_use_positions_at_emission_and_never_deliver_private_thoughts(
    world: WorldState,
) -> None:
    """Near listeners hear speech; a distant listener cannot hear it retroactively."""
    config = _navigation_config()
    config.update(
        width=40,
        height=1,
        walkable=[[1] * 40],
        spawn_points=[{"id": "west", "x": 16, "y": 16}, {"id": "east", "x": 1200, "y": 16}],
    )
    config["landmarks"] = [
        {"id": "spring", "name": "Spring", "x": 1200, "y": 16, "affordances": ["energy"]}
    ]
    world.spatial = SpatialWorld.from_mapping(config)
    first, second = world.get_all_agents()[:2]
    first.current_position = second.current_position = "nirvana"
    world.spatial.spawn(first.id, staging_id="west")
    world.spatial.spawn(second.id, staging_id="east")
    bus = EventBus(world)
    bus.subscribe(first.id)
    bus.subscribe(second.id)
    await bus.publish(
        Event(
            type="speak",
            source=first.id,
            payload={"message": "Too far"},
            scope=ScopeType.LOCAL,
            region="nirvana",
            timestamp=world.now(),
        )
    )
    assert bus.get_events(second.id) == []
    await bus.publish(
        Event(
            type="agent_paralyzed",
            source="system",
            payload={"agent_id": first.id},
            scope=ScopeType.LOCAL,
            region="nirvana",
            timestamp=world.now(),
        )
    )
    assert bus.get_events(second.id) == []
    await bus.publish(
        Event(
            type="self_talk",
            source=first.id,
            payload={"message": "Secret thought"},
            scope=ScopeType.PRIVATE,
            timestamp=world.now(),
        )
    )
    assert bus.get_events(second.id) == []


def test_nearby_home_is_observed_without_private_vault(world: WorldState) -> None:
    """Homes have locations; a distant building and someone else's vault are not senses."""
    config = _navigation_config()
    config["home_plots"] = [
        {
            "id": "plot-a",
            "x": 80,
            "y": 16,
            "door": {"x": 144, "y": 48},
            "hard_rects": [{"x": 64, "y": 64, "width": 10, "height": 10}],
        }
    ]
    world.spatial = SpatialWorld.from_mapping(config)
    world.add_region(Region("nirvana", "A grove", [], 1, 1, 100, 100, 500, 500))
    first, second = world.get_all_agents()[:2]
    first.current_position = second.current_position = "nirvana"
    world.spatial.spawn(first.id)
    assert world.build_home("home-secret", second.id, "nirvana", built_at=0, integrity=100)
    home = world.get_home("home-secret")
    assert home is not None
    home.vault_materials = 347
    awareness = SpatialAwareness(world, first.id, radius_tiles=2)
    assert "home-secret" not in awareness.render(0)
    world.spatial.begin_travel(first.id, "spring", 0, speed=32)
    nearby = awareness.render(6)
    assert "home-secret" in nearby and "347" not in nearby


async def test_final_prepared_context_stays_inside_budget(world: WorldState) -> None:
    """Refreshing the offered actions must not restore a truncated, oversized persona."""
    state = world.get_all_agents()[0]
    state.persona = "A very long remembered identity. " * 10000
    bus = EventBus(world)
    agent = Agent(state.id, world, bus, ToolRegistry(world, bus), MockDecider())
    await agent.perceive()
    messages, tools = agent._prepare_fresh_decision()
    assert estimate_tokens(messages, tools) <= agent._prompt_budget


async def test_lifecycle_event_carries_spatial_authority_before_checkpoint(
    world: WorldState,
) -> None:
    """Birth and entry establish authority, exit explicitly clears it, without editing events."""
    spatial = SpatialWorld.from_mapping(_navigation_config())
    world.spatial = spatial
    state = world.get_all_agents()[0]
    state.current_position = "nirvana"
    spatial.spawn(state.id)
    log = InMemoryEventLog()
    bus = EventBus(world, log)
    bus.subscribe(state.id)
    for kind in ("agent_born", "agent_entered_region", "agent_left_region"):
        event = Event(
            kind,
            state.id,
            {"agent_id": state.id},
            ScopeType.LOCAL,
            region="nirvana",
            timestamp=world.now(),
        )
        await bus.publish(event)
        assert "spatial" not in event.payload
        delivered = bus.get_events(state.id)[0]
        if kind == "agent_left_region":
            assert delivered.payload["spatial"] is None
        else:
            assert delivered.payload["spatial"] == spatial.position_at(state.id, event.timestamp)

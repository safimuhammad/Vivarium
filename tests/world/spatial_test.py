"""Tests for the deterministic, map-backed spatial navigation engine."""

from __future__ import annotations

import math

import pytest

from tests.conftest import FakeClock
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.spatial import (
    SpatialCurrentRead,
    SpatialNavigationError,
    SpatialRouteUnavailable,
    SpatialWorld,
)
from world.world import WorldState


def _navigation_config(
    *,
    collision: list[int] | None = None,
) -> dict[str, object]:
    """Return a tiny, fully connected map with one central obstacle."""
    collision_cells = (
        collision
        if collision is not None
        else [
            0,
            0,
            0,
            0,
            0,
            0,
            1,
            1,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
    )
    return {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:test-layout",
        "layout_fingerprint": "test-layout-fingerprint",
        "tile_size": 32,
        "width": 5,
        "height": 3,
        "walkable": [
            [1 if collision_cells[row * 5 + column] == 0 else 0 for column in range(5)]
            for row in range(3)
        ],
        "landmarks": [
            {
                "id": "spring",
                "name": "Quiet Spring",
                "x": 144,
                "y": 48,
                "affordances": ["energy"],
            }
        ],
        "spawn_points": [{"x": 16, "y": 48}],
        "initial_pressure": {"populationHighWater": 2, "builtFootprintHighWater": 0},
        "home_footprints": [],
    }


def test_spatial_world_loads_an_exported_grid_and_pixel_landmarks() -> None:
    """A spatial map preserves its pixel geometry and public read-only metadata."""
    spatial = SpatialWorld.from_mapping(_navigation_config())

    assert spatial.version == 1
    assert spatial.region_id == "nirvana"
    assert spatial.map_id == "nirvana:test-layout"
    assert spatial.layout_fingerprint == "test-layout-fingerprint"
    assert spatial.tile_size == 32
    assert spatial.columns == 5 and spatial.rows == 3
    assert spatial.is_tile_walkable(0, 0)
    assert not spatial.is_tile_walkable(1, 1)
    assert spatial.is_walkable(16, 16)
    assert not spatial.is_walkable(48, 48)
    assert [landmark.id for landmark in spatial.landmarks] == ["spring"]
    assert spatial.landmarks[0].x == 144.0
    assert spatial.landmarks[0].affordances == ("energy",)


def test_astar_route_is_continuous_around_collision_and_arrives_on_tick() -> None:
    """A journey follows the exported terrain rather than clipping through a wall."""
    clock = FakeClock(start=0.0)
    spatial = SpatialWorld.from_mapping(_navigation_config())
    spatial.spawn("wanderer_001")

    outcome = spatial.begin_travel("wanderer_001", "spring", clock(), speed=32.0)

    assert outcome.status == "started"
    assert outcome.travel is not None
    assert [(point.x, point.y) for point in outcome.travel.route] == [
        # The central row is blocked, so deterministic A* chooses the upper detour.
        (16.0, 48.0),
        (16.0, 16.0),
        (48.0, 16.0),
        (80.0, 16.0),
        (112.0, 16.0),
        (144.0, 16.0),
        (144.0, 48.0),
    ]
    assert outcome.travel.started_at == 0.0
    assert outcome.travel.arrives_at == 6.0

    clock.advance(1.5)
    mid_route = spatial.position_at("wanderer_001", clock())
    assert mid_route["x"] == 32.0
    assert mid_route["y"] == 16.0
    assert mid_route["at_landmark"] is None
    assert mid_route["travel"] is not None

    clock.advance(4.5)
    events = spatial.tick(clock())
    assert [event.kind for event in events] == ["travel_arrived"]
    arrived = spatial.position_at("wanderer_001", clock())
    assert arrived["x"] == 144.0
    assert arrived["y"] == 48.0
    assert arrived["at_landmark"] == "spring"
    assert arrived["travel"] is None


def test_current_read_tracks_position_and_destination_across_route_transitions() -> None:
    """The hot perception read stays fresh while routes start, redirect, stop, and arrive."""
    clock = FakeClock(start=0.0)
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
    spatial = SpatialWorld.from_mapping(config)
    spatial.spawn("wanderer_001")

    standing = spatial.current_read("wanderer_001", clock())
    assert isinstance(standing, SpatialCurrentRead)
    assert (standing.point.x, standing.point.y) == (16.0, 48.0)
    assert standing.destination_id is None
    assert standing.observed_at == 0.0

    spatial.begin_travel("wanderer_001", "spring", clock(), speed=32.0)
    clock.advance(1.5)
    walking = spatial.current_read("wanderer_001", clock())
    assert (walking.point.x, walking.point.y) == (64.0, 48.0)
    assert walking.destination_id == "spring"
    assert walking.observed_at == 1.5

    spatial.begin_travel("wanderer_001", "grove", clock(), speed=32.0)
    redirected = spatial.current_read("wanderer_001", clock())
    assert (redirected.point.x, redirected.point.y) == (64.0, 48.0)
    assert redirected.destination_id == "grove"
    assert redirected.observed_at == 1.5

    clock.advance(0.5)
    spatial.cancel_travel("wanderer_001", clock())
    stopped = spatial.current_read("wanderer_001", clock())
    assert stopped.destination_id is None
    assert stopped.observed_at == 2.0

    journey = spatial.begin_travel("wanderer_001", "spring", clock(), speed=32.0).travel
    assert journey is not None
    clock.advance(journey.arrives_at - clock())
    pending_arrival = spatial.current_read("wanderer_001", clock())
    assert (pending_arrival.point.x, pending_arrival.point.y) == (144.0, 48.0)
    assert pending_arrival.destination_id == "spring"
    assert pending_arrival.observed_at == journey.arrives_at
    spatial.tick(clock())
    arrived = spatial.current_read("wanderer_001", clock())
    assert (arrived.point.x, arrived.point.y) == (144.0, 48.0)
    assert arrived.destination_id is None
    assert arrived.observed_at == journey.arrives_at


@pytest.mark.parametrize("now", [math.nan, math.inf, -math.inf])
def test_current_read_rejects_non_finite_observation_time(now: float) -> None:
    """The lightweight read has the same finite-time boundary as snapshots."""
    spatial = SpatialWorld.from_mapping(_navigation_config())
    spatial.spawn("wanderer_001")

    with pytest.raises(SpatialNavigationError, match="now must be a finite number"):
        spatial.current_read("wanderer_001", now)


def test_repeated_goal_is_idempotent_and_stop_keeps_the_actual_position() -> None:
    """Repeating a destination never restarts its clock; stopping never snaps a route."""
    clock = FakeClock(start=0.0)
    spatial = SpatialWorld.from_mapping(_navigation_config())
    spatial.spawn("wanderer_001")
    first = spatial.begin_travel("wanderer_001", "spring", clock(), speed=32.0)
    assert first.travel is not None

    clock.advance(1.5)
    repeated = spatial.begin_travel("wanderer_001", "spring", clock(), speed=32.0)
    assert repeated.status == "already_traveling"
    assert repeated.travel is first.travel
    assert repeated.travel.started_at == 0.0
    assert repeated.travel.arrives_at == 6.0

    cancelled = spatial.cancel_travel("wanderer_001", clock(), reason="stopped")
    assert cancelled is not None
    assert cancelled.kind == "travel_cancelled"
    assert cancelled.position.x == 32.0
    assert cancelled.position.y == 16.0
    stopped = spatial.position_at("wanderer_001", clock())
    assert stopped["x"] == 32.0
    assert stopped["y"] == 16.0
    assert stopped["travel"] is None


def test_unreachable_destination_fails_without_altering_the_active_position() -> None:
    """An obstacle wall returns a clear route error rather than teleporting through it."""
    blocked = [
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
    ]
    spatial = SpatialWorld.from_mapping(_navigation_config(collision=blocked))
    spatial.spawn("wanderer_001")

    with pytest.raises(SpatialRouteUnavailable, match="No walkable route"):
        spatial.begin_travel("wanderer_001", "spring", 0.0)

    assert spatial.position_at("wanderer_001", 0.0)["x"] == 16.0
    assert spatial.position_at("wanderer_001", 0.0)["travel"] is None


def test_region_metadata_retains_export_pressure_and_landmark_affordances() -> None:
    """Reconnect snapshots preserve the exact recipe inputs and site permissions."""
    spatial = SpatialWorld.from_mapping(_navigation_config())

    assert spatial.spatial_metadata() == {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:test-layout",
        "layout_fingerprint": "test-layout-fingerprint",
        "tile_size": 32,
        "columns": 5,
        "rows": 3,
        "topology": "bounded",
        "initial_pressure": {"populationHighWater": 2, "builtFootprintHighWater": 0},
        "landmarks": [
            {
                "id": "spring",
                "name": "Quiet Spring",
                "x": 144.0,
                "y": 48.0,
                "affordances": ["energy"],
            }
        ],
    }


def test_world_attaches_spatial_positions_for_founders_and_newborns() -> None:
    """Only beings in the spatial region receive deterministic legal grid positions."""
    clock = FakeClock(start=0.0)
    spatial = SpatialWorld.from_mapping(_navigation_config())
    nirvana = Region(
        name="nirvana",
        description="A shared valley.",
        connections=["warm_springs"],
        energy_rate=1.0,
        materials_rate=1.0,
        current_energy=100.0,
        current_materials=100.0,
        max_energy=500.0,
        max_materials=500.0,
    )
    springs = Region(
        name="warm_springs",
        description="A legacy region.",
        connections=["nirvana"],
        energy_rate=1.0,
        materials_rate=1.0,
        current_energy=100.0,
        current_materials=100.0,
        max_energy=500.0,
        max_materials=500.0,
    )
    founder = AgentState(
        id="founder_001",
        name="Founder",
        persona="",
        current_position="nirvana",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    legacy = AgentState(
        id="legacy_001",
        name="Legacy",
        persona="",
        current_position="warm_springs",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )

    world = WorldState([nirvana, springs], [founder, legacy], clock=clock, spatial=spatial)

    assert spatial.has_agent("founder_001")
    assert not spatial.has_agent("legacy_001")
    newborn = AgentState(
        id="newborn_001",
        name="Newborn",
        persona="",
        current_position="nirvana",
        current_energy=20.0,
        current_materials=0.0,
        status=AgentStatus.ALIVE,
    )
    assert world.add_agent(newborn)
    assert spatial.has_agent("newborn_001")
    position = spatial.position_at("newborn_001", clock())
    x = position["x"]
    y = position["y"]
    assert isinstance(x, float)
    assert isinstance(y, float)
    assert spatial.is_walkable(x, y)


def test_world_lifecycle_and_partially_mapped_moves_preserve_spatial_journeys() -> None:
    """Paralysis stops routes; a missing matched map cannot trigger a legacy exit."""
    clock = FakeClock(start=0.0)
    spatial = SpatialWorld.from_mapping(_navigation_config())
    nirvana = Region(
        "nirvana", "A shared valley.", ["warm_springs"], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0
    )
    springs = Region(
        "warm_springs", "A legacy region.", ["nirvana"], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0
    )
    founder = AgentState("founder_001", "Founder", "", "nirvana", 100.0, 50.0, AgentStatus.ALIVE)
    world = WorldState([nirvana, springs], [founder], clock=clock, spatial=spatial)
    spatial.begin_travel("founder_001", "spring", clock(), speed=32.0)

    clock.advance(1.5)
    assert world.modify_agent_energy("founder_001", -100.0)
    stopped = spatial.position_at("founder_001", clock())
    assert stopped["x"] == 32.0 and stopped["y"] == 16.0
    assert stopped["travel"] is None
    assert [(event.kind, event.reason) for event in spatial.tick(clock())] == [
        ("travel_cancelled", "status:paralyzed")
    ]

    assert world.modify_agent_energy("founder_001", 100.0)
    spatial.begin_travel("founder_001", "spring", clock(), speed=32.0)
    clock.advance(0.5)
    assert not world.move_agent("founder_001", "warm_springs")
    assert founder.current_position == "nirvana"
    assert spatial.has_agent("founder_001")
    assert spatial.position_at("founder_001", clock())["travel"] is not None
    assert spatial.tick(clock()) == []


def test_home_plot_blocks_a_route_and_keeps_its_assignment_until_removed() -> None:
    """A built home claims production geometry without snapping a walker through it."""
    config = _navigation_config(collision=[0] * 15)
    config["home_plots"] = [
        {
            "id": "plot-middle",
            "x": 64,
            "y": 32,
            "door": {"x": 80, "y": 16},
            "hard_rects": [{"x": 64, "y": 32, "width": 32, "height": 32}],
        }
    ]
    spatial = SpatialWorld.from_mapping(config)
    spatial.spawn("walker")
    first = spatial.begin_travel("walker", "spring", 0.0, speed=32.0)
    assert first.travel is not None
    assert (80.0, 48.0) in [(point.x, point.y) for point in first.travel.route]

    first_plot = spatial.assign_home("home-one", 0.0)

    assert spatial.home_snapshot("home-one") == {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:test-layout",
        "plot_id": first_plot.id,
        "x": first_plot.x,
        "y": first_plot.y,
        "door": first_plot.door.to_json(),
    }
    assert spatial.position_at("walker", 0.0)["travel"] is None
    assert [(event.kind, event.reason) for event in spatial.tick(0.0)] == [
        ("travel_cancelled", "home_built")
    ]
    spatial.release_home("home-one")
    assert spatial.home_snapshot("home-one") is None


def test_home_plot_refuses_to_cover_a_current_agent() -> None:
    """Placement never invents a house around a person or a duplicate spawn point."""
    config = _navigation_config(collision=[0] * 15)
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 16},
        {"id": "east", "x": 48, "y": 16},
        {"id": "inside", "x": 80, "y": 48},
    ]
    config["home_plots"] = [
        {
            "id": "only-plot",
            "x": 64,
            "y": 32,
            "door": {"x": 80, "y": 16},
            "hard_rects": [{"x": 64, "y": 32, "width": 32, "height": 32}],
        }
    ]
    spatial = SpatialWorld.from_mapping(config)
    spatial.spawn("stationary", staging_id="inside")

    assert not spatial.can_assign_home(0.0)
    with pytest.raises(SpatialNavigationError, match="No unoccupied shelter plot"):
        spatial.assign_home("home-inside", 0.0)


def test_home_plots_and_spawns_choose_distinct_deterministic_legal_locations() -> None:
    """Different homes and founders spread across authored locations before fallback ground."""
    config = _navigation_config(collision=[0] * 15)
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 16},
        {"id": "east", "x": 48, "y": 16},
    ]
    config["home_plots"] = [
        {
            "id": "plot-one",
            "x": 64,
            "y": 32,
            "door": {"x": 80, "y": 16},
            "hard_rects": [{"x": 64, "y": 32, "width": 32, "height": 32}],
        },
        {
            "id": "plot-two",
            "x": 96,
            "y": 0,
            "door": {"x": 112, "y": 16},
            "hard_rects": [{"x": 96, "y": 0, "width": 32, "height": 32}],
        },
    ]
    spatial = SpatialWorld.from_mapping(config)
    first_plot = spatial.assign_home("home-one", 0.0)
    second_plot = spatial.assign_home("home-two", 0.0)
    assert first_plot.id != second_plot.id

    separate = SpatialWorld.from_mapping(config)
    west = separate.spawn("first", staging_id="west")
    east = separate.spawn("second", staging_id="west")
    fallback = separate.spawn("third", staging_id="west")
    assert east != west
    assert fallback not in {west, east}
    assert separate.is_walkable(fallback.x, fallback.y)


def test_spawn_skips_a_staging_anchor_blocked_by_an_occupied_home_plot() -> None:
    """A new home never leaves a dormant authored anchor legal for a newborn."""
    config = _navigation_config(collision=[0] * 15)
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 48},
        {"id": "east", "x": 144, "y": 48},
    ]
    config["home_plots"] = [
        {
            "id": "east-shelter",
            "x": 144,
            "y": 48,
            "door": {"x": 144, "y": 16},
            "hard_rects": [{"x": 128, "y": 32, "width": 32, "height": 32}],
        }
    ]
    spatial = SpatialWorld.from_mapping(config)
    founder = spatial.spawn("founder", staging_id="west", now=0.0)
    spatial.assign_home("home-east", 0.0)

    newborn = spatial.spawn("newborn", staging_id="east", now=0.0)

    assert (newborn.x, newborn.y) != (144.0, 48.0)
    assert newborn != founder
    assert spatial.is_walkable(newborn.x, newborn.y)


def test_world_add_agent_samples_arrived_walker_before_the_navigator_ticks() -> None:
    """A newborn does not stack on a route that has arrived between navigator polls."""
    clock = FakeClock(start=0.0)
    config = _navigation_config(collision=[0] * 15)
    config["spawn_points"] = [
        {"id": "west", "x": 16, "y": 48},
        {"id": "east", "x": 144, "y": 48},
    ]
    spatial = SpatialWorld.from_mapping(config)
    walker = AgentState(
        "walker",
        "Walker",
        "",
        "nirvana",
        100.0,
        0.0,
        AgentStatus.ALIVE,
    )
    region = Region("nirvana", "A shared valley.", [], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0)
    spatial.spawn(walker.id, staging_id="west", now=clock())
    world = WorldState([region], [walker], clock=clock, spatial=spatial)
    travel = spatial.begin_travel(walker.id, "spring", clock(), speed=32.0).travel
    assert travel is not None
    clock.advance(travel.arrives_at - clock())
    assert spatial.position_at(walker.id, clock())["x"] == 144.0

    newborn = AgentState(
        "newborn",
        "Newborn",
        "",
        "nirvana",
        100.0,
        0.0,
        AgentStatus.ALIVE,
    )

    assert world.add_agent(newborn)
    newborn_position = spatial.position_at(newborn.id, clock())
    assert newborn_position["x"] == 16.0
    assert newborn_position["y"] == 48.0

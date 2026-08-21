"""Tests for JSON-ready live world snapshots."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from core.constants import (
    GENESIS_SEED,
    HOARDING_ENERGY_THRESHOLD,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_MAX_INTEGRITY,
    RUINS_SCAVENGE_FRACTION,
)
from observability.run_context import build_run_context
from observability.snapshot import (
    serialize_agent,
    serialize_home,
    serialize_pending_proposals,
    serialize_region,
    serialize_snapshot_for_run,
    serialize_world_snapshot,
)
from tests.conftest import FakeClock
from world.agents import AgentState, AgentStatus
from world.homes import HomeStatus
from world.regions import ResourceTypes
from world.world import WorldState


def _records(snapshot: dict[str, object], key: str) -> list[dict[str, object]]:
    """Return a typed record list from a JSON snapshot."""
    return cast(list[dict[str, object]], snapshot[key])


def test_world_snapshot_envelope_is_json_ready_and_deterministically_ordered(
    world: WorldState,
    fake_clock: FakeClock,
) -> None:
    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=9)

    assert snapshot["schema"] == 1
    assert snapshot["run_id"] == "run-123"
    assert snapshot["world_time"] == fake_clock()
    assert snapshot["event_cursor"] == 9
    assert [agent["id"] for agent in _records(snapshot, "agents")] == [
        "wanderer_001",
        "wanderer_002",
    ]
    assert [agent["home_id"] for agent in _records(snapshot, "agents")] == [None, None]
    assert [region["name"] for region in _records(snapshot, "regions")] == ["alpha", "beta"]
    assert snapshot["homes"] == []
    assert snapshot["ruins"] == []
    assert snapshot["pending_proposals"] == []
    assert snapshot["region_pressure"] == [
        {
            "region": "alpha",
            "population_high_water": 2,
            "built_footprint_high_water": 0,
        },
        {
            "region": "beta",
            "population_high_water": 0,
            "built_footprint_high_water": 0,
        },
    ]
    json.dumps(snapshot, allow_nan=False, sort_keys=True)


def test_world_snapshot_region_pressure_is_detached_from_live_counters(
    world: WorldState,
) -> None:
    """Mutating one JSON result cannot corrupt later pressure checkpoints."""
    first = serialize_world_snapshot(world, run_id="run-123", event_cursor=1)
    pressure = cast(list[dict[str, object]], first["region_pressure"])
    pressure[0]["population_high_water"] = 999
    pressure.reverse()

    second = serialize_world_snapshot(world, run_id="run-123", event_cursor=2)

    assert second["region_pressure"] == [
        {
            "region": "alpha",
            "population_high_water": 2,
            "built_footprint_high_water": 0,
        },
        {
            "region": "beta",
            "population_high_water": 0,
            "built_footprint_high_water": 0,
        },
    ]


def test_snapshot_serializes_agents_regions_and_home_derived_fields(
    world: WorldState,
    fake_clock: FakeClock,
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_energy = HOARDING_ENERGY_THRESHOLD
    ada.last_mated_at = fake_clock()
    ada.offspring_count = 2

    assert world.build_home(
        "home_shared",
        "wanderer_001",
        "alpha",
        built_at=fake_clock(),
        integrity=HOME_MAX_INTEGRITY,
    )
    assert world.add_stakeholder("home_shared", "wanderer_002")
    assert world.deposit_to_home_vault("home_shared", HOARDING_MATERIALS_THRESHOLD)
    assert world.record_breacher("home_shared", "wanderer_002")
    assert world.record_breacher("home_shared", "wanderer_001")

    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=3)
    agents = {agent["id"]: agent for agent in _records(snapshot, "agents")}
    assert agents["wanderer_001"] == {
        "id": "wanderer_001",
        "name": "Ada",
        "persona": "Curious and careful.",
        "position": "alpha",
        "energy": HOARDING_ENERGY_THRESHOLD,
        "materials": 50.0,
        "status": "alive",
        "last_mated_at": fake_clock(),
        "offspring_count": 2,
        "died_at": None,
        "home_id": "home_shared",
        "is_hoarding": True,
    }
    assert agents["wanderer_002"]["home_id"] == "home_shared"
    assert agents["wanderer_002"]["is_hoarding"] is False

    regions = {region["name"]: region for region in _records(snapshot, "regions")}
    assert regions["alpha"] == {
        "name": "alpha",
        "description": "A modest meadow.",
        "connections": ["beta"],
        "energy_rate": 1.0,
        "materials_rate": 1.0,
        "current_energy": 100.0,
        "current_materials": 100.0,
        "max_energy": 500.0,
        "max_materials": 500.0,
    }

    assert snapshot["ruins"] == []
    assert snapshot["homes"] == [
        {
            "home_id": "home_shared",
            "owner_id": "wanderer_001",
            "region": "alpha",
            "integrity": HOME_MAX_INTEGRITY,
            "max_integrity": 150.0,
            "built_at": fake_clock(),
            "last_upkeep_at": fake_clock(),
            "last_integrity_at": fake_clock(),
            "stakeholders": ["wanderer_001", "wanderer_002"],
            "vault_materials": HOARDING_MATERIALS_THRESHOLD,
            "status": "standing",
            "ruined_at": None,
            "remnant_materials": 0.0,
            "breachers": ["wanderer_001", "wanderer_002"],
            "is_hoarding": True,
        }
    ]


def test_snapshot_separates_ruins_and_serializes_pending_proposals(
    world: WorldState,
    fake_clock: FakeClock,
) -> None:
    resources = {
        ResourceTypes.ENERGY: 50.0,
        ResourceTypes.MATERIALS: 30.0,
    }
    assert world.add_proposal("wanderer_001", "wanderer_002", resources)

    assert world.build_home(
        "home_ruin",
        "wanderer_001",
        "beta",
        built_at=fake_clock(),
        integrity=HOME_MAX_INTEGRITY,
    )
    assert world.deposit_to_home_vault("home_ruin", 20.0)
    fake_clock.advance(5.0)
    assert world.make_ruin("home_ruin")

    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=12)
    assert snapshot["homes"] == []
    assert snapshot["ruins"] == [
        {
            "home_id": "home_ruin",
            "owner_id": "wanderer_001",
            "region": "beta",
            "integrity": HOME_MAX_INTEGRITY,
            "max_integrity": 100.0,
            "built_at": 1_000_000.0,
            "last_upkeep_at": 1_000_000.0,
            "last_integrity_at": 1_000_000.0,
            "stakeholders": [],
            "vault_materials": 0.0,
            "status": "ruin",
            "ruined_at": 1_000_005.0,
            "remnant_materials": RUINS_SCAVENGE_FRACTION * 100.0,
            "breachers": [],
            "is_hoarding": False,
        }
    ]
    assert snapshot["pending_proposals"] == [
        {
            "initiator_id": "wanderer_001",
            "target_id": "wanderer_002",
            "timestamp": 1_000_000.0,
            "resources": {
                "energy": 50.0,
                "materials": 30.0,
            },
        }
    ]
    json.dumps(snapshot, allow_nan=False)


def test_snapshot_for_run_uses_run_context_id(
    world: WorldState,
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "world.yaml"
    config_path.write_text("regions: []\nagents: []\n", encoding="utf-8")
    run_context = build_run_context(
        config_path=config_path,
        seed=7,
        model="mock",
        provider="ollama",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=lambda: 123.0,
    )

    snapshot = serialize_snapshot_for_run(world, run_context, event_cursor=4)

    assert snapshot["run_id"] == run_context.run_id
    assert snapshot["event_cursor"] == 4


def test_individual_serializers_return_json_ready_values(world: WorldState) -> None:
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None
    assert region is not None

    assert serialize_agent(agent, home_id=None)["status"] == "alive"
    assert serialize_region(region)["connections"] == ["beta"]

    assert world.build_home(
        "home_solo",
        "wanderer_001",
        "alpha",
        built_at=world.now(),
        integrity=HOME_MAX_INTEGRITY,
    )
    home = world.get_home("home_solo")
    assert home is not None
    assert serialize_home(home)["status"] == "standing"

    assert world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 10.0})
    assert serialize_pending_proposals(world)[0]["resources"] == {"energy": 10.0}


def test_agent_home_id_ignores_ruin_stakeholders_if_state_is_malformed(
    world: WorldState,
) -> None:
    """A ruin cannot be a being's current home even if stale stakeholders remain."""
    assert world.build_home(
        "home_stale_ruin",
        "wanderer_001",
        "alpha",
        built_at=world.now(),
        integrity=HOME_MAX_INTEGRITY,
    )
    home = world.get_home("home_stale_ruin")
    assert home is not None
    home.status = HomeStatus.RUIN
    home.stakeholders = ["wanderer_001"]

    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=1)

    agents = {agent["id"]: agent for agent in _records(snapshot, "agents")}
    assert agents["wanderer_001"]["home_id"] is None
    assert snapshot["homes"] == []
    assert _records(snapshot, "ruins")[0]["home_id"] == "home_stale_ruin"


# --- The seed persona is a run constant, published once ----------------------


def _born_from_the_seed(world: WorldState) -> None:
    """Give every being the shared genesis persona, as a real world does.

    ``config/schema.py`` sets it for founders and ``tools/builtin/mating.py`` sets the
    same constant for offspring; nothing anywhere reassigns it. The shared fixture
    uses distinct personas, which is the *authored* case rather than the ordinary one.
    """
    for agent in world.get_all_agents():
        agent.persona = GENESIS_SEED


def test_the_snapshot_publishes_the_seed_persona_once_instead_of_per_being(
    world: WorldState,
) -> None:
    """Measured: personas were 51.7% of a 5-being snapshot and every one identical.

    ``GENESIS_SEED`` is set once for founders and once for offspring and never
    reassigned, so a checkpoint was one run constant repeated N times -- written
    every 5 seconds plus on 19 event types. It is now stated once.
    """
    _born_from_the_seed(world)

    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=1)

    assert snapshot["seed_persona"] == GENESIS_SEED
    for agent in _records(snapshot, "agents"):
        assert "persona" not in agent


def test_an_authored_persona_is_never_flattened_into_the_run_constant(
    world: WorldState,
) -> None:
    """A viewer-written persona is per-being and must survive on its own being."""
    _born_from_the_seed(world)
    authored = world.get_agent("wanderer_001")
    assert authored is not None
    authored.persona = "I keep what I find."

    snapshot = serialize_world_snapshot(world, run_id="run-123", event_cursor=1)

    agents = {agent["id"]: agent for agent in _records(snapshot, "agents")}
    assert agents["wanderer_001"]["persona"] == "I keep what I find."
    assert "persona" not in agents["wanderer_002"]
    assert snapshot["seed_persona"] == GENESIS_SEED


def test_a_run_with_its_own_default_persona_omits_that_one_instead(
    world: WorldState,
) -> None:
    """The omitted value is whatever the run says its default is, not a constant."""
    for being in world.get_all_agents():
        being.persona = "We begin together."

    snapshot = serialize_world_snapshot(
        world,
        run_id="run-123",
        event_cursor=1,
        seed_persona="We begin together.",
    )

    assert snapshot["seed_persona"] == "We begin together."
    for record in _records(snapshot, "agents"):
        assert "persona" not in record


def test_the_snapshot_shrinks_and_stops_growing_with_the_roster(world: WorldState) -> None:
    """The measured pathology was linear-in-roster, not merely large.

    Personas were 51.7% of a 5-being snapshot and 66.4% of a 30-being one. Stating
    the constant once removes the growth entirely: one copy at any roster size.
    """
    _born_from_the_seed(world)
    for index in range(3, 31):
        assert world.add_agent(
            AgentState(
                id=f"wanderer_{index:03d}",
                name=f"Agent {index}",
                persona=GENESIS_SEED,
                current_position="alpha",
                current_energy=50.0,
                current_materials=10.0,
                status=AgentStatus.ALIVE,
            )
        )

    encoded = json.dumps(
        serialize_world_snapshot(world, run_id="run-123", event_cursor=1),
        ensure_ascii=False,
    )

    assert encoded.count(GENESIS_SEED[:40]) == 1
    assert len(encoded.encode("utf-8")) < 30 * len(GENESIS_SEED)

"""JSON-ready world snapshots for live frontend observers.

Events explain what changed; snapshots are the authoritative state the browser
reconciles to. This module serializes the live :class:`world.world.WorldState`
without mutating it and without depending on terminal renderers.
"""

from __future__ import annotations

from typing import Any

from core.constants import GENESIS_SEED
from observability.run_context import RunContext
from world.agents import AgentState, is_hoarding
from world.homes import Home, HomeStatus, home_is_hoarding, max_integrity
from world.regions import Region, ResourceTypes
from world.world import WorldState

JsonObject = dict[str, object]


def serialize_world_snapshot(
    world: WorldState,
    *,
    run_id: str,
    event_cursor: int,
    seed_persona: str = GENESIS_SEED,
) -> JsonObject:
    """Return the current authoritative world snapshot.

    The run's default persona is stated **once**, as ``seed_persona``, and omitted
    from every being born from it. Measured before this: personas were 51.7% of a
    5-being snapshot and 66.4% of a 30-being one, every one of them byte-identical,
    re-written every world tick plus on 19 event types -- a single run constant
    repeated once per being. A being whose persona *differs* from the run's default
    (a viewer wrote one on the configuration screen) still carries its own; an
    authored identity is never flattened into the constant.

    Args:
        world: Live world state to serialize.
        run_id: Run identifier from :class:`observability.run_context.RunContext`.
        event_cursor: Current event cursor from the live feed.
        seed_persona: The words this run's beings are born from by default. Any
            being carrying exactly these words omits its own copy.

    Returns:
        A JSON-ready dict matching the Layer 2b frontend contract.
    """
    home_ids_by_agent = _home_ids_by_agent(world)
    home_snapshots = [serialize_home(home) for home in _sorted_homes(world)]
    return {
        "schema": 1,
        "run_id": run_id,
        "world_time": world.now(),
        "event_cursor": event_cursor,
        "seed_persona": seed_persona,
        "agents": [
            serialize_agent(
                agent,
                home_id=home_ids_by_agent.get(agent.id),
                seed_persona=seed_persona,
            )
            for agent in sorted(world.get_all_agents(), key=lambda item: item.id)
        ],
        "regions": [
            serialize_region(region)
            for region in sorted(world.get_all_regions(), key=lambda item: item.name)
        ],
        "homes": [home for home in home_snapshots if home["status"] == HomeStatus.STANDING.value],
        "ruins": [home for home in home_snapshots if home["status"] == HomeStatus.RUIN.value],
        "pending_proposals": serialize_pending_proposals(world),
        "region_pressure": serialize_region_pressure(world),
    }


def serialize_snapshot_for_run(
    world: WorldState,
    run_context: RunContext,
    *,
    event_cursor: int,
) -> JsonObject:
    """Return a world snapshot using a run context for the run id and seed persona."""
    return serialize_world_snapshot(
        world,
        run_id=run_context.run_id,
        event_cursor=event_cursor,
        seed_persona=run_context.seed_persona,
    )


def serialize_agent(
    agent: AgentState,
    *,
    home_id: str | None,
    seed_persona: str = GENESIS_SEED,
) -> JsonObject:
    """Return a JSON-ready agent snapshot.

    ``persona`` is present **only when this being's differs from the run's default**.
    The default is stated once on the snapshot envelope, so repeating it here would
    be the same constant written once per being, per checkpoint, forever.

    Args:
        agent: The being to serialize.
        home_id: The being's current standing home, or ``None``.
        seed_persona: The run's default persona; a being carrying exactly these
            words omits its own copy.

    Returns:
        A JSON-ready dict, with ``persona`` present only where it was authored.
    """
    persona = {} if agent.persona == seed_persona else {"persona": agent.persona}
    return {
        "id": agent.id,
        "name": agent.name,
        **persona,
        "position": agent.current_position,
        "energy": agent.current_energy,
        "materials": agent.current_materials,
        "status": agent.status.value,
        "last_mated_at": agent.last_mated_at,
        "offspring_count": agent.offspring_count,
        "died_at": agent.died_at,
        "home_id": home_id,
        "is_hoarding": is_hoarding(agent),
    }


def serialize_region(region: Region) -> JsonObject:
    """Return a JSON-ready region snapshot."""
    return {
        "name": region.name,
        "description": region.description,
        "connections": list(region.connections),
        "energy_rate": region.energy_rate,
        "materials_rate": region.materials_rate,
        "current_energy": region.current_energy,
        "current_materials": region.current_materials,
        "max_energy": region.max_energy,
        "max_materials": region.max_materials,
    }


def serialize_home(home: Home) -> JsonObject:
    """Return a JSON-ready standing-home or ruin snapshot."""
    return {
        "home_id": home.home_id,
        "owner_id": home.owner_id,
        "region": home.region,
        "integrity": home.integrity,
        "max_integrity": max_integrity(len(home.stakeholders)),
        "built_at": home.built_at,
        "last_upkeep_at": home.last_upkeep_at,
        "last_integrity_at": home.last_integrity_at,
        "stakeholders": list(home.stakeholders),
        "vault_materials": home.vault_materials,
        "status": home.status.value,
        "ruined_at": home.ruined_at,
        "remnant_materials": home.remnant_materials,
        "breachers": sorted(home.breachers),
        "is_hoarding": home_is_hoarding(home),
    }


def serialize_pending_proposals(world: WorldState) -> list[JsonObject]:
    """Return pending mating proposals sorted by initiator and target id."""
    proposals: list[JsonObject] = []
    for initiator_id, target_id in sorted(world.pending_proposals):
        proposal = world.pending_proposals[(initiator_id, target_id)]
        proposals.append(
            {
                "initiator_id": initiator_id,
                "target_id": target_id,
                "timestamp": proposal.get("timestamp"),
                "resources": _serialize_resources(proposal.get("resources")),
            }
        )
    return proposals


def serialize_region_pressure(world: WorldState) -> list[JsonObject]:
    """Return detached capacity pressure records in deterministic region order."""
    return [
        {
            "region": pressure.region,
            "population_high_water": pressure.population_high_water,
            "built_footprint_high_water": pressure.built_footprint_high_water,
        }
        for pressure in world.get_region_pressure()
    ]


def _home_ids_by_agent(world: WorldState) -> dict[str, str]:
    """Return the first deterministic stakeholder home id for each agent."""
    home_ids: dict[str, str] = {}
    for home in _sorted_homes(world):
        if home.status is not HomeStatus.STANDING:
            continue
        for agent_id in sorted(home.stakeholders):
            home_ids.setdefault(agent_id, home.home_id)
    return home_ids


def _sorted_homes(world: WorldState) -> list[Home]:
    """Return homes in deterministic id order."""
    return sorted(world.get_all_homes(), key=lambda item: item.home_id)


def _serialize_resources(resources: Any) -> dict[str, float]:
    """Convert ResourceTypes-keyed proposal resources to JSON object keys."""
    if not isinstance(resources, dict):
        return {}
    serialized: dict[str, float] = {}
    for resource_type, amount in resources.items():
        key = (
            resource_type.value if isinstance(resource_type, ResourceTypes) else str(resource_type)
        )
        serialized[key] = float(amount)
    return serialized

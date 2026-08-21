"""Provider-free producer for deterministic C00-C17 Mock Chronicle manifests."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from collections.abc import Callable, Coroutine, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agents.decider import Decision
from agents.runtime import Agent
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    BREAKIN_ENERGY_COST,
    BREAKIN_MATERIALS_COST,
    CORPSE_DECAY_SECONDS,
    HOME_BUILD_MATERIALS_COST,
    MATING_MAX_OFFSPRING,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
    RUINS_PERSIST_SECONDS,
)
from core.rng import make_rng
from observability.event_log import InMemoryEventLog, serialize_event
from observability.snapshot import serialize_world_snapshot
from tools.builtin import BUILTIN_TOOLS, register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.tick import tick
from world.world import WorldState

from .catalog import (
    CANONICAL_CHRONICLES,
    CANONICAL_TOOL_NAMES,
    FROZEN_GRAPH_LIFECYCLE_ORACLES,
    FROZEN_POSITIVE_ORACLES,
    OCCURRENCE_QUALIFIED_EVENT_MARKERS,
)
from .oracles import validate_manifest

ROOT = Path(__file__).resolve().parents[3]
WORLD_CONFIG = ROOT / "config/world.yaml"

JsonObject = dict[str, Any]
ExpectedResult = str | Callable[["_Scenario"], str]


def _expected_markers(chronicle_id: str, entries: list[JsonObject]) -> list[str]:
    """Return deterministic semantic marker authority for a Chronicle manifest."""
    occurrence_types = OCCURRENCE_QUALIFIED_EVENT_MARKERS.get(chronicle_id, frozenset())
    event_markers = {
        (
            f"event:{entry['event']['type']}@cursor:{entry['cursor']}"
            if entry["event"]["type"] in occurrence_types
            else f"event:{entry['event']['type']}"
        )
        for entry in entries
    }
    return [*sorted(event_markers), "checkpoint:final"]


_RULE_REJECTIONS: dict[str, tuple[JsonObject, str]] = {
    "accept_mating": (
        {"target": "wanderer_003", "message": "No proposal."},
        "Error: Pending proposal not found.",
    ),
    "attack": ({"target": "wanderer_001"}, "Invalid: You cannot attack yourself."),
    "break_in": (
        {"target_home": "missing-home", "intent": "invalid"},
        "Invalid: You must mean either to take a home's store (thieve) or seize it (colonize).",
    ),
    "deposit_to_home": (
        {"amount": 0.0},
        "Invalid: 'amount' must be a positive number, but got 0.0.",
    ),
    "harvest_resources": (
        {"resource_type": "energy", "amount": 0.0},
        "Invalid: 'amount' must be a positive number, but got 0.0.",
    ),
    "initiate_mating": (
        {
            "target": "wanderer_002",
            "message": "Too little.",
            "resources": {"energy": 1.0, "materials": 1.0},
        },
        "Invalid: A mating proposal must commit at least 50 energy and 30 materials.",
    ),
    "move": (
        {"destination": "warm_springs"},
        "Invalid: Cannot move to warm_springs, it is not reachable from warm_springs.",
    ),
    "pledge_home": (
        {"home_id": "missing-home"},
        "Error: There is no such home here to pledge to.",
    ),
    "reject_mating": (
        {"target": "wanderer_003", "message": "No proposal."},
        "Error: No pending proposal found.",
    ),
    "scavenge_ruins": (
        {"target_home": "missing-home", "amount": 0.0},
        "Invalid: 'amount' must be a positive number, but got 0.0.",
    ),
    "speak": (
        {"message": "   "},
        "Invalid: Cannot speak — message must be a non-empty string.",
    ),
    "transfer_resource": (
        {"target": "wanderer_001", "resource_type": "energy", "amount": 1.0},
        "Invalid: You cannot transfer resources to yourself.",
    ),
    "withdraw_from_home": (
        {"amount": 0.0},
        "Invalid: 'amount' must be a positive number, but got 0.0.",
    ),
}

_PRODUCER_TOOL_MUTATIONS: dict[str, list[JsonObject]] = {
    "accept_mating": [
        {"path": "/agents/wanderer_002/energy", "before": 100.0, "after": 50.0},
        {"path": "/agents/wanderer_002/materials", "before": 45.0, "after": 15.0},
        {"path": "/agents/@count", "before": 4, "after": 5},
        {"path": "/pending_proposals/@count", "before": 1, "after": 0},
    ],
    "attack": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 85.0},
        {"path": "/agents/wanderer_002/energy", "before": 20.0, "after": 0.0},
        {"path": "/agents/wanderer_002/status", "before": "alive", "after": "paralyzed"},
    ],
    "break_in": [
        {"path": "/agents/wanderer_002/energy", "before": 200.0, "after": 185.0},
        {"path": "/agents/wanderer_002/materials", "before": 145.0, "after": 135.0},
        {"path": "/homes/home_c07/integrity", "before": 50.0, "after": 25.0},
        {"path": "/homes/home_c07/breachers", "before": [], "after": ["wanderer_002"]},
    ],
    "build_home": [
        {"path": "/agents/wanderer_001/materials", "before": 400.0, "after": 320.0},
        {"path": "/agents/wanderer_001/home_id", "before": None, "after": "home_b86b89df"},
        {"path": "/homes/@count", "before": 0, "after": 1},
    ],
    "deposit_to_home": [
        {"path": "/agents/wanderer_001/materials", "before": 300.0, "after": 200.0},
        {"path": "/homes/home_b86b89df/vault_materials", "before": 0.0, "after": 100.0},
    ],
    "harvest_resources": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 101.0},
        {"path": "/regions/warm_springs/current_energy", "before": 90.0, "after": 89.0},
    ],
    "initiate_mating": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 50.0},
        {"path": "/agents/wanderer_001/materials", "before": 45.0, "after": 15.0},
        {"path": "/pending_proposals/@count", "before": 0, "after": 1},
    ],
    "leave_home": [
        {"path": "/agents/wanderer_001/home_id", "before": "home_b86b89df", "after": None},
        {
            "path": "/homes/home_b86b89df/owner_id",
            "before": "wanderer_001",
            "after": "wanderer_002",
        },
        {
            "path": "/homes/home_b86b89df/stakeholders",
            "before": ["wanderer_001", "wanderer_002"],
            "after": ["wanderer_002"],
        },
    ],
    "look_around": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 100.0},
        {
            "path": "/agents/wanderer_001/position",
            "before": "warm_springs",
            "after": "warm_springs",
        },
    ],
    "move": [
        {
            "path": "/agents/wanderer_001/position",
            "before": "warm_springs",
            "after": "nirvana_east",
        },
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 95.0},
    ],
    "pledge_home": [
        {"path": "/agents/wanderer_002/home_id", "before": None, "after": "home_b86b89df"},
        {
            "path": "/homes/home_b86b89df/stakeholders",
            "before": ["wanderer_001"],
            "after": ["wanderer_001", "wanderer_002"],
        },
        {"path": "/homes/home_b86b89df/max_integrity", "before": 100.0, "after": 150.0},
    ],
    "reject_mating": [
        {"path": "/agents/wanderer_001/energy", "before": 50.0, "after": 100.0},
        {"path": "/agents/wanderer_001/materials", "before": 15.0, "after": 45.0},
        {"path": "/pending_proposals/@count", "before": 1, "after": 0},
    ],
    "scavenge_ruins": [
        {"path": "/agents/wanderer_002/materials", "before": 45.0, "after": 50.0},
        {"path": "/ruins/home_c09/remnant_materials", "before": 60.0, "after": 55.0},
    ],
    "speak": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 99.5},
    ],
    "transfer_resource": [
        {"path": "/agents/wanderer_001/materials", "before": 45.0, "after": 44.0},
        {"path": "/agents/wanderer_002/materials", "before": 45.0, "after": 46.0},
    ],
    "use_hearth": [
        {"path": "/agents/wanderer_001/energy", "before": 100.0, "after": 120.0},
        {"path": "/agents/wanderer_001/materials", "before": 320.0, "after": 300.0},
    ],
    "withdraw_from_home": [
        {"path": "/agents/wanderer_001/materials", "before": 200.0, "after": 225.0},
        {"path": "/homes/home_b86b89df/vault_materials", "before": 100.0, "after": 75.0},
    ],
}


class _NeverDecider:
    """Provider-free runtime seam that must never be asked to decide."""

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        raise AssertionError("the Chronicle producer must not invoke a decider")


@dataclass(slots=True)
class _FakeClock:
    """Small monotonic fake clock used by every producer action and tick."""

    value: float

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        assert seconds >= 0.0
        self.value += seconds


@dataclass(slots=True)
class _Scenario:
    """One isolated seeded world, real registry, bus, log, and assertion ledger."""

    chronicle_id: str
    seed: int
    run_id: str
    clock: _FakeClock
    world: WorldState
    log: InMemoryEventLog
    bus: EventBus
    registry: ToolRegistry
    initial_snapshot: JsonObject
    assertions: list[JsonObject] = field(default_factory=list)
    producer_results: dict[str, str] = field(default_factory=dict)
    captured_checkpoints: list[JsonObject] = field(default_factory=list)

    async def invoke(
        self,
        tool: str,
        actor: str,
        params: JsonObject,
        *,
        expected: ExpectedResult,
        outcome: str,
        mutation: bool,
        event_delta: int | None,
        record_assertion: bool = True,
    ) -> str:
        """Invoke a real registered builtin and assert result/state/event ownership."""
        before_events = len(self.log.events)
        before_state = self.snapshot(before_events)
        result = await self.registry.invoke(tool, actor, params)
        wanted = expected(self) if callable(expected) else expected
        assert result == wanted, (tool, result, wanted)
        actual_delta = len(self.log.events) - before_events
        if event_delta is not None:
            assert actual_delta == event_delta, (tool, actual_delta, event_delta)
        after_state = self.snapshot(before_events)
        assert (after_state != before_state) is mutation, tool
        state_unchanged = after_state == before_state
        if outcome == "rejected":
            assert actual_delta == 0
            assert state_unchanged
        if record_assertion:
            exact_events = [serialize_event(event) for event in self.log.events[before_events:]]
            checkpoint_truth: JsonObject = {}
            if actual_delta == 0 and outcome == "success":
                reason = "world_tick"
                checkpoint_truth = {"reason": reason, "snapshot": after_state}
                self.captured_checkpoints.append(
                    {
                        "schema": 1,
                        "type": "world_snapshot_checkpoint",
                        "reason": reason,
                        "run_id": self.run_id,
                        "world_time": after_state["world_time"],
                        "event_cursor": after_state["event_cursor"],
                        "snapshot": after_state,
                    }
                )
            mutation_expectations = (
                copy.deepcopy(_PRODUCER_TOOL_MUTATIONS[tool]) if outcome == "success" else []
            )
            for expectation in mutation_expectations:
                assert _snapshot_path(before_state, expectation["path"]) == expectation["before"]
                assert _snapshot_path(after_state, expectation["path"]) == expectation["after"]
            self.assertions.append(
                {
                    "tool": tool,
                    "outcome": outcome,
                    "result": result,
                    "invocationLayer": "builtin",
                    "before": before_state,
                    "after": after_state,
                    "events": exact_events,
                    "checkpointTruth": checkpoint_truth,
                    "mutationExpectations": mutation_expectations,
                }
            )
            self.producer_results[tool] = result
        return result

    async def reject_missing_params(self, tool: str, actor: str = "wanderer_001") -> None:
        """Assert registry-boundary and valid-parameter real-builtin rejection paths."""
        required = {
            name: [
                parameter.name
                for parameter in __import__("inspect").signature(function).parameters.values()
                if parameter.name not in {"world", "event_bus", "agent_id"}
                and parameter.default is __import__("inspect").Parameter.empty
            ]
            for name, function in BUILTIN_TOOLS.items()
        }[tool]
        assert required, f"{tool} has no required model parameters; use a real rule rejection"
        expected = f"Error: '{tool}' needs parameter(s): {', '.join(required)}."
        await self.invoke(
            tool,
            actor,
            {},
            expected=expected,
            outcome="boundary-rejected",
            mutation=False,
            event_delta=0,
        )
        params, expected = _RULE_REJECTIONS[tool]
        await self.invoke(
            tool,
            actor,
            copy.deepcopy(params),
            expected=expected,
            outcome="rejected",
            mutation=False,
            event_delta=0,
        )

    def snapshot(self, cursor: int | None = None) -> JsonObject:
        return serialize_world_snapshot(
            self.world,
            run_id=self.run_id,
            event_cursor=len(self.log.events) if cursor is None else cursor,
        )

    def capture_checkpoint(self) -> JsonObject:
        """Capture exact state at the current event cursor for later transport."""
        snapshot = self.snapshot()
        self.captured_checkpoints.append(
            {
                "schema": 1,
                "type": "world_snapshot_checkpoint",
                "reason": "world_tick",
                "run_id": self.run_id,
                "world_time": snapshot["world_time"],
                "event_cursor": snapshot["event_cursor"],
                "snapshot": snapshot,
            }
        )
        return snapshot

    def seal_initial_snapshot(self) -> JsonObject:
        """Replace cursor-zero truth after silent setup and before any public event."""
        assert not self.log.events, "initial truth cannot be resealed after public events"
        self.initial_snapshot = self.snapshot(0)
        return self.initial_snapshot


def _snapshot_path(snapshot: JsonObject, path: str) -> Any:
    """Resolve one frozen assertion path against a serialized world snapshot."""
    parts = path.strip("/").split("/")
    collection_name, entity_id = parts[:2]
    collection = snapshot[collection_name]
    assert isinstance(collection, list)
    if entity_id == "@count":
        assert len(parts) == 2
        return len(collection)
    assert len(parts) == 3
    field_name = parts[2]
    identity_key = {
        "agents": "id",
        "regions": "name",
        "homes": "home_id",
        "ruins": "home_id",
    }.get(collection_name)
    assert identity_key is not None
    entity = next(item for item in collection if item[identity_key] == entity_id)
    return entity[field_name]


def _new_scenario(chronicle_id: str) -> _Scenario:
    """Build a configured four-region world with deterministic RNG and fake time."""
    from config.loader import load_config

    seed = 30_000 + int(chronicle_id[1:])
    clock = _FakeClock(1_800_000_000.0 + int(chronicle_id[1:]) * 10_000.0)
    loaded = load_config(WORLD_CONFIG, seed=seed)
    world = WorldState(
        copy.deepcopy(loaded.get_all_regions()),
        copy.deepcopy(loaded.get_all_agents()),
        rng=make_rng(seed),
        clock=clock,
    )
    log = InMemoryEventLog()
    bus = EventBus(world, event_log=log)
    for agent in world.get_all_agents():
        assert bus.subscribe(agent.id)
    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    assert set(registry.list_tools()) == set(CANONICAL_TOOL_NAMES) == set(BUILTIN_TOOLS)
    run_id = f"mock-{chronicle_id.lower()}-v1"
    return _Scenario(
        chronicle_id=chronicle_id,
        seed=seed,
        run_id=run_id,
        clock=clock,
        world=world,
        log=log,
        bus=bus,
        registry=registry,
        initial_snapshot=serialize_world_snapshot(world, run_id=run_id, event_cursor=0),
    )


def _resolved(event: JsonObject) -> JsonObject:
    payload = event["payload"]
    resolved: JsonObject = {"actor_id": payload.get("actor_id", event["source"])}
    for key in ("target_id", "victim_id", "receiver_id", "recipient_id"):
        if isinstance(payload.get(key), str):
            resolved["target_id"] = payload[key]
            break
    region = payload.get("region", event.get("region"))
    if isinstance(region, str):
        resolved["region"] = region
    home_id = payload.get("home_id", payload.get("target_home"))
    if isinstance(home_id, str):
        resolved["home_id"] = home_id
    return resolved


def _presentation_record(kind: str, label: str, **payload: Any) -> JsonObject:
    """Return an explicitly labeled schema-1 non-mechanic presentation record."""
    return {"schema": 1, "kind": kind, "label": label, "payload": payload}


def _fixture_authorship(records: list[JsonObject] | None = None) -> JsonObject:
    return {
        "labeled": True,
        "mechanicEventsFabricated": False,
        "handAuthoredEnvelopeCount": 0,
        "recordCount": len(records or []),
    }


def _checkpoint_safety_for_reason(reason: str) -> str:
    """Return the safety class production derives from a checkpoint reason."""
    if reason == "world_tick":
        return "safe-world-tick"
    if reason.startswith("event:"):
        return "archive-event"
    return "archive-manual"


def _graph_lifecycle_oracle(
    scenario: _Scenario,
    final_snapshot: JsonObject,
) -> JsonObject | None:
    """Return trusted Graph ownership truth and cross-check snapshot high-water marks."""
    authored = FROZEN_GRAPH_LIFECYCLE_ORACLES.get(scenario.chronicle_id)
    if authored is None:
        return None
    snapshots = [
        scenario.initial_snapshot,
        *[checkpoint["snapshot"] for checkpoint in scenario.captured_checkpoints],
        final_snapshot,
    ]
    if "actors" in authored:
        actor_lifecycle = authored["actors"]
        assert isinstance(actor_lifecycle, Mapping)
        actor_peak = actor_lifecycle.get("peak")
        assert isinstance(actor_peak, int)
        assert actor_peak == max(len(snapshot["agents"]) for snapshot in snapshots)
    if "homes" in authored:
        home_lifecycle = authored["homes"]
        assert isinstance(home_lifecycle, Mapping)
        home_peak = home_lifecycle.get("peak")
        assert isinstance(home_peak, int)
        assert home_peak == max(
            len(snapshot["homes"]) + len(snapshot["ruins"]) for snapshot in snapshots
        )
        visibility_segments = home_lifecycle.get("visibilitySegments")
        if visibility_segments is not None:
            assert isinstance(visibility_segments, list) and visibility_segments
            created = home_lifecycle.get("created")
            assert isinstance(created, int)
            assert created == sum(len(segment["homeIds"]) for segment in visibility_segments)
    return copy.deepcopy(authored)


def _manifest(
    scenario: _Scenario,
    *,
    negative: list[str],
    terminal: JsonObject | None = None,
    presentation_records: list[JsonObject] | None = None,
    checkpoint_reason: str = "world_tick",
) -> JsonObject:
    events = [serialize_event(event) for event in scenario.log.events]
    entries = [
        {
            "cursor": index,
            "event": event,
            "resolved": _resolved(event),
            "snapshot_after": None,
        }
        for index, event in enumerate(events, start=1)
    ]
    final_snapshot = scenario.snapshot()
    checkpoint = {
        "schema": 1,
        "type": "world_snapshot_checkpoint",
        "reason": checkpoint_reason,
        "run_id": scenario.run_id,
        "world_time": final_snapshot["world_time"],
        "event_cursor": final_snapshot["event_cursor"],
        "snapshot": final_snapshot,
    }
    expected_terminal: JsonObject = {
        "toolAssertions": scenario.assertions,
        "producerResults": scenario.producer_results,
        "fixtureAuthorship": _fixture_authorship(presentation_records),
        "presentationRecords": presentation_records or [],
        "finalSnapshot": final_snapshot,
        "semanticOracle": {
            "positive": list(FROZEN_POSITIVE_ORACLES[scenario.chronicle_id]),
            "negative": list(negative),
            "terminal": ["final-checkpoint-aligned", "run-identity-preserved"],
        },
    }
    graph_lifecycle_oracle = _graph_lifecycle_oracle(scenario, final_snapshot)
    if graph_lifecycle_oracle is not None:
        expected_terminal["graphLifecycleOracle"] = graph_lifecycle_oracle
    assert terminal is None or "graphLifecycleOracle" not in terminal
    expected_terminal.update(terminal or {})
    manifest: JsonObject = {
        "id": scenario.chronicle_id,
        "slug": CANONICAL_CHRONICLES[scenario.chronicle_id],
        "version": 1,
        "seed": scenario.seed,
        "runId": scenario.run_id,
        "initialSnapshot": scenario.initial_snapshot,
        "entries": entries,
        "checkpoints": [
            *[
                {"line": index, "checkpoint": captured, "safety": "safe-world-tick"}
                for index, captured in enumerate(scenario.captured_checkpoints, start=1)
            ],
            {
                "line": len(scenario.captured_checkpoints) + 1,
                "checkpoint": checkpoint,
                "safety": _checkpoint_safety_for_reason(checkpoint_reason),
            },
        ],
        "expectedMarkers": _expected_markers(scenario.chronicle_id, entries),
        "expectedFinalCursor": len(entries),
        "expectedTerminal": expected_terminal,
        "negativeAssertions": negative,
    }
    validate_manifest(manifest)
    return manifest


async def _build_c00() -> JsonObject:
    s = _new_scenario("C00")
    s.clock.advance(1.0)
    await tick(s.world, s.bus)
    assert not s.log.events
    return _manifest(
        s,
        negative=["no-east-west-edge", "no-observer-action", "no-fabricated-condition-event"],
        terminal={
            "ownership": "observer-snapshot",
            "tickSteps": 1,
            "presentationAuthority": {
                "kind": "silent-checkpoint",
                "terminal": {
                    "cursor": 0,
                    "runId": s.run_id,
                    "source": "live",
                    "sourceKey": f"live:{s.run_id}",
                },
            },
        },
    )


async def _build_c01() -> JsonObject:
    s = _new_scenario("C01")
    await s.reject_missing_params("move")
    await s.invoke(
        "move",
        "wanderer_001",
        {"destination": "nirvana_east"},
        expected="Agent Moved from warm_springs to nirvana_east Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
    )
    return _manifest(s, negative=["no-teleport", "no-forbidden-edge"])


async def _build_c02() -> JsonObject:
    s = _new_scenario("C02")
    path = [
        "nirvana_east",
        "warm_springs",
        "nirvana_west",
        "nirvana",
        "warm_springs",
        "nirvana_east",
        "nirvana",
        "nirvana_west",
        "warm_springs",
        "nirvana",
    ]
    origin = "nirvana"
    for destination in path:
        await s.invoke(
            "move",
            "wanderer_003",
            {"destination": destination},
            expected=f"Agent Moved from {origin} to {destination} Successfully",
            outcome="success",
            mutation=True,
            event_delta=2,
            record_assertion=False,
        )
        origin = destination
        s.clock.advance(1.0)
    return _manifest(s, negative=["no-nirvana-east-to-nirvana-west-shortcut"])


async def _build_c03() -> JsonObject:
    s = _new_scenario("C03")
    await s.reject_missing_params("harvest_resources")
    await s.invoke(
        "harvest_resources",
        "wanderer_001",
        {"resource_type": "energy", "amount": 1.0},
        expected=(
            "Successfully harvested ResourceTypes.ENERGY from Region warm_springs\n"
            " Agent Energy: 101.0|Agent Materials: 45.0\n"
            " Region Energy: 89.0|Region Materials:80.0 "
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.reject_missing_params("transfer_resource")
    await s.invoke(
        "transfer_resource",
        "wanderer_001",
        {"target": "wanderer_002", "resource_type": "materials", "amount": 1.0},
        expected=(
            "Successfully transferred ResourceTypes.MATERIALS to Agent ID:wanderer_002|"
            "Agent Name:Mae,\n Agent Energy:101.0| Agent Materials:44.0"
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    return _manifest(s, negative=["no-reciprocal-trade", "no-silent-harvest"])


def _mating_request_result() -> str:
    return (
        "Successfully sent the mating request to agent ID:wanderer_002|Agent Name:Mae, "
        "mating request is subject to proposal acceptance, in case of reject or timeout your "
        "committed resources will be returned back to you."
    )


async def _build_c04() -> JsonObject:
    s = _new_scenario("C04")
    await s.invoke(
        "initiate_mating",
        "wanderer_003",
        {
            "target": "wanderer_002",
            "message": "Can a distant voice reach you?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=(
            "Successfully sent the mating request to agent ID:wanderer_002|Agent Name:Mae, "
            "mating request is subject to proposal acceptance, in case of reject or timeout your "
            "committed resources will be returned back to you."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "reject_mating",
        "wanderer_002",
        {"target": "wanderer_003", "message": "I hear you, but not now."},
        expected=(
            "Rejection successful, Agent ID:wanderer_003|Agent Name:Dick informed of rejection."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.reject_missing_params("initiate_mating")
    await s.invoke(
        "initiate_mating",
        "wanderer_001",
        {
            "target": "wanderer_002",
            "message": "Shall we bring forth a new life?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_mating_request_result(),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.reject_missing_params("accept_mating", actor="wanderer_002")

    def accepted(sc: _Scenario) -> str:
        children = [
            agent
            for agent in sc.world.get_all_agents()
            if agent.id not in {"wanderer_001", "wanderer_002", "wanderer_003", "wanderer_004"}
        ]
        assert len(children) == 1
        child = children[0]
        return (
            f"Successfully accepted mating, Your offspring is now born with Agent ID:{child.id}|"
            f"Agent Name:{child.name},Your Child is now in this world, talk, coach, nurture it "
            "collectively if you wish so with your partner.\n Parent Details:\n "
            "Agent ID:wanderer_001|Agent Name:Joe and Agent ID:wanderer_002|Agent Name:Mae"
        )

    await s.invoke(
        "accept_mating",
        "wanderer_002",
        {"target": "wanderer_001", "message": "Yes."},
        expected=accepted,
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    return _manifest(s, negative=["no-acceptance-event", "no-parent-persona-inheritance"])


async def _build_c05() -> JsonObject:
    s = _new_scenario("C05")
    await s.invoke(
        "initiate_mating",
        "wanderer_001",
        {
            "target": "wanderer_002",
            "message": "Together?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_mating_request_result(),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.reject_missing_params("reject_mating", actor="wanderer_002")
    await s.invoke(
        "reject_mating",
        "wanderer_002",
        {"target": "wanderer_001", "message": "Not now."},
        expected=(
            "Rejection successful, Agent ID:wanderer_001|Agent Name:Joe informed of rejection."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.invoke(
        "initiate_mating",
        "wanderer_001",
        {
            "target": "wanderer_002",
            "message": "Another season?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_mating_request_result(),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS + 1.0)
    before = len(s.log.events)
    await tick(s.world, s.bus)
    assert len(s.log.events) == before + 1
    assert s.log.events[-1].type == "mating_proposal_timeout"
    await s.invoke(
        "initiate_mating",
        "wanderer_003",
        {
            "target": "wanderer_004",
            "message": "Will this remain possible?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=(
            "Successfully sent the mating request to agent ID:wanderer_004|Agent Name:Allen, "
            "mating request is subject to proposal acceptance, in case of reject or timeout your "
            "committed resources will be returned back to you."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    assert s.world.record_mating("wanderer_003", s.world.now())
    await s.invoke(
        "accept_mating",
        "wanderer_004",
        {"target": "wanderer_003", "message": "Yes."},
        expected=(
            "Invalid: This mating proposal is no longer valid (the initiator is on cooldown or "
            "at their offspring cap); their committed resources have been refunded."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "initiate_mating",
        "wanderer_003",
        {
            "target": "wanderer_004",
            "message": "Again?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected="Invalid: You mated too recently; you must wait before mating again.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
        record_assertion=False,
    )
    allen = s.world.get_agent("wanderer_004")
    assert allen is not None
    allen.offspring_count = MATING_MAX_OFFSPRING
    await s.invoke(
        "initiate_mating",
        allen.id,
        {
            "target": "wanderer_003",
            "message": "One more?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected="Invalid: You have reached the maximum number of offspring.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
        record_assertion=False,
    )
    return _manifest(
        s, negative=["no-child-on-reject", "no-stranded-escrow"], terminal={"tickSteps": 1}
    )


async def _build_c06() -> JsonObject:
    s = _new_scenario("C06")
    joe = s.world.get_agent("wanderer_001")
    assert joe is not None
    s.world.modify_agent_materials(joe.id, 355.0)
    await s.invoke(
        "build_home",
        joe.id,
        {},
        expected="You raise a home here. It cost you 80 materials; you have 320.0 left.",
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.invoke(
        "build_home",
        joe.id,
        {},
        expected="Invalid: You already have or share a home; you may hold only one.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
    )
    home = s.world.stakeholder_home_of(joe.id)
    assert home is not None
    await s.reject_missing_params("pledge_home", actor="wanderer_002")
    await s.invoke(
        "pledge_home",
        "wanderer_002",
        {"home_id": home.home_id},
        expected=(
            "You pledge yourself to this home; you now share its keep and may rest at its "
            "hearth. 2 beings tend it now."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.invoke(
        "use_hearth",
        "wanderer_003",
        {},
        expected="Error: You have no home here to rest in.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
    )
    await s.invoke(
        "use_hearth",
        joe.id,
        {},
        expected=(
            "You rest at your hearth, burning 20.0 materials for 20.0 energy. "
            "Energy: 120.0, Materials: 300.0."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.reject_missing_params("deposit_to_home")
    await s.invoke(
        "deposit_to_home",
        joe.id,
        {"amount": 100.0},
        expected=(
            "You set 100.0 materials into your home's store. It now holds 100.0 "
            "materials; you hold 200.0."
        ),
        outcome="success",
        mutation=True,
        event_delta=0,
    )
    await s.reject_missing_params("withdraw_from_home")
    await s.invoke(
        "withdraw_from_home",
        joe.id,
        {"amount": 25.0},
        expected=(
            "You draw 25.0 materials from your home's store. It now holds 75.0 "
            "materials; you hold 225.0."
        ),
        outcome="success",
        mutation=True,
        event_delta=0,
    )
    s.world.modify_agent_materials(joe.id, 225.0)
    await s.invoke(
        "deposit_to_home",
        joe.id,
        {"amount": 225.0},
        expected=(
            "You set 225.0 materials into your home's store. It now holds 300.0 "
            "materials; you hold 225.0."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "leave_home",
        "wanderer_003",
        {},
        expected="Error: You do not belong to any home to leave.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
    )
    await s.invoke(
        "leave_home",
        joe.id,
        {},
        expected="You give up your place in this home; its keep and hearth are no longer yours.",
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    assert home.owner_id == "wanderer_002"
    return _manifest(
        s,
        negative=["no-deposit-event-below-hoard", "no-withdrawal-event"],
        terminal={"ownerPromotion": {"from": joe.id, "to": "wanderer_002"}},
    )


def _prepare_contest(s: _Scenario, *, home_id: str, integrity: float, vault: float) -> None:
    s.world.build_home(
        home_id, "wanderer_001", "warm_springs", built_at=s.world.now(), integrity=integrity
    )
    s.world.deposit_to_home_vault(home_id, vault)
    raider = s.world.get_agent("wanderer_002")
    assert raider is not None
    s.world.modify_agent_materials(raider.id, 100.0)
    s.world.modify_agent_energy(raider.id, 100.0)


async def _build_c07() -> JsonObject:
    s = _new_scenario("C07")
    _prepare_contest(s, home_id="home_c07", integrity=50.0, vault=40.0)
    s.world.modify_agent_materials("wanderer_004", 100.0)
    s.seal_initial_snapshot()
    await s.invoke(
        "move",
        "wanderer_004",
        {"destination": "warm_springs"},
        expected="Agent Moved from nirvana to warm_springs Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    await s.reject_missing_params("break_in", actor="wanderer_002")
    await s.invoke(
        "break_in",
        "wanderer_002",
        {"target_home": "home_c07", "intent": "thieve"},
        expected=(
            "You batter the home home_c07; its soundness drops to 25.0 but it still stands. "
            "You spent 15 energy and 10 materials."
        ),
        outcome="success",
        mutation=True,
        event_delta=0,
    )
    s.clock.advance(1.0)
    await tick(s.world, s.bus)
    repaired = s.world.get_home("home_c07")
    assert repaired is not None and repaired.integrity == 35.0
    s.capture_checkpoint()
    await s.invoke(
        "break_in",
        "wanderer_004",
        {"target_home": "home_c07", "intent": "thieve"},
        expected=(
            "You batter the home home_c07; its soundness drops to 10.0 but it still stands. "
            "You spent 15 energy and 10 materials."
        ),
        outcome="success",
        mutation=True,
        event_delta=0,
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        "wanderer_002",
        {"target_home": "home_c07", "intent": "thieve"},
        expected=(
            "You break the home home_c07 open and strip its store — 40.0 materials, "
            "split among 2. The emptied wreck still stands, for now."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    home = s.world.get_home("home_c07")
    assert home is not None and home.integrity == 0.0 and home.vault_materials == 0.0
    return _manifest(
        s,
        negative=["no-ruin-on-breach", "no-double-counted-vault"],
        terminal={"recipientSplit": ["wanderer_002", "wanderer_004"], "repairIntegrity": 35.0},
    )


async def _build_c08() -> JsonObject:
    s = _new_scenario("C08")
    _prepare_contest(s, home_id="home_c08", integrity=50.0, vault=40.0)
    s.world.modify_agent_materials("wanderer_004", 100.0)
    s.seal_initial_snapshot()
    await s.invoke(
        "move",
        "wanderer_004",
        {"destination": "warm_springs"},
        expected="Agent Moved from nirvana to warm_springs Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        "wanderer_004",
        {"target_home": "home_c08", "intent": "colonize"},
        expected=(
            "You batter the home home_c08; its soundness drops to 25.0 but it still stands. "
            "You spent 15 energy and 10 materials."
        ),
        outcome="success",
        mutation=True,
        event_delta=0,
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        "wanderer_002",
        {"target_home": "home_c08", "intent": "colonize"},
        expected=(
            "You break the home home_c08 open and take it for your own. 2 of you hold "
            "it now; shore it up before it falls."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    home = s.world.get_home("home_c08")
    assert home is not None
    assert home.owner_id == "wanderer_002"
    assert home.stakeholders == ["wanderer_002", "wanderer_004"]
    return _manifest(
        s,
        negative=["no-theft-on-colonize", "no-former-owner-stake"],
        terminal={
            "ownership": {"previous": "wanderer_001", "new": "wanderer_002"},
            "stakeholders": ["wanderer_002", "wanderer_004"],
        },
    )


async def _build_c09() -> JsonObject:
    s = _new_scenario("C09")
    s.world.build_home(
        "home_repair", "wanderer_001", "warm_springs", built_at=s.world.now(), integrity=50.0
    )
    s.world.build_home("home_c09", "wanderer_003", "nirvana", built_at=s.world.now(), integrity=1.0)
    s.world.deposit_to_home_vault("home_c09", 40.0)
    s.world.build_home(
        "home_zero", "wanderer_004", "nirvana", built_at=s.world.now(), integrity=1.0
    )
    for agent_id in ("wanderer_003", "wanderer_004"):
        owner = s.world.get_agent(agent_id)
        assert owner is not None
        s.world.modify_agent_materials(owner.id, -owner.current_materials)
    s.seal_initial_snapshot()
    s.clock.advance(1.0)
    await tick(s.world, s.bus)
    ruin = s.world.get_home("home_c09")
    assert ruin is not None and ruin.status.value == "ruin"
    zero = s.world.get_home("home_zero")
    repair = s.world.get_home("home_repair")
    assert zero is not None and zero.status.value == "ruin" and zero.remnant_materials == 40.0
    assert repair is not None and repair.integrity == 60.0
    s.capture_checkpoint()
    await s.invoke(
        "move",
        "wanderer_002",
        {"destination": "nirvana"},
        expected="Agent Moved from warm_springs to nirvana Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    await s.reject_missing_params("scavenge_ruins", actor="wanderer_002")
    await s.invoke(
        "scavenge_ruins",
        "wanderer_002",
        {"target_home": "home_c09", "amount": 5.0},
        expected="You pick 5.0 materials from the ruins. They hold 55.0 more; you hold 50.0.",
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    await s.invoke(
        "scavenge_ruins",
        "wanderer_002",
        {"target_home": "home_zero", "amount": 100.0},
        expected="You pick 40.0 materials from the ruins. They hold 0.0 more; you hold 90.0.",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.world.modify_agent_materials("wanderer_001", 1_000.0)
    s.clock.advance(RUINS_PERSIST_SECONDS + 1.0)
    before_sweep = len(s.log.events)
    await tick(s.world, s.bus)
    assert s.world.get_home("home_c09") is None
    assert s.world.get_home("home_zero") is None
    assert len(s.log.events) == before_sweep
    return _manifest(
        s,
        negative=["no-repair-event", "no-upkeep-event", "no-ruin-sweep-event"],
        terminal={
            "tickSteps": 2,
            "repairIntegrity": 60.0,
            "zeroRemnantAfterScavenge": 0.0,
            "nonzeroVaultRemnantBeforeScavenge": 60.0,
            "silentSweep": True,
        },
    )


async def _build_c10() -> JsonObject:
    s = _new_scenario("C10")
    mae = s.world.get_agent("wanderer_002")
    assert mae is not None
    s.world.modify_agent_energy(mae.id, -80.0)
    await s.reject_missing_params("attack")
    await s.invoke(
        "attack",
        "wanderer_001",
        {"target": mae.id},
        expected="Successfully Attacked Mae|IDwanderer_002\n Energy remaining: 85.0",
        outcome="success",
        mutation=True,
        event_delta=2,
    )
    s.capture_checkpoint()
    await s.invoke(
        "transfer_resource",
        "wanderer_001",
        {"target": mae.id, "resource_type": "energy", "amount": 6.0},
        expected=(
            "Successfully transferred ResourceTypes.ENERGY to Agent ID:wanderer_002|"
            "Agent Name:Mae,\n Agent Energy:79.0| Agent Materials:45.0"
        ),
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    return _manifest(s, negative=["no-death-on-threshold-hit", "no-recovery-before-transfer"])


async def _build_c11() -> JsonObject:
    s = _new_scenario("C11")
    mae = s.world.get_agent("wanderer_002")
    assert mae is not None
    s.world.modify_agent_energy(mae.id, -81.0)

    def lethal_result(sc: _Scenario) -> str:
        joe = sc.world.get_agent("wanderer_001")
        assert joe is not None
        return (
            "You struck down Mae|IDwanderer_002 and took 19.0 energy and 45.0 materials "
            f"from them as loot.\n Energy: {joe.current_energy}|Materials: {joe.current_materials}"
        )

    await s.invoke(
        "attack",
        "wanderer_001",
        {"target": mae.id},
        expected=lethal_result,
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    corpse_checkpoint = s.capture_checkpoint()
    assert any(agent["id"] == mae.id for agent in corpse_checkpoint["agents"])
    s.clock.advance(CORPSE_DECAY_SECONDS + 1.0)
    await tick(s.world, s.bus)
    assert s.world.get_agent(mae.id) is None
    return _manifest(
        s, negative=["no-corpse-after-decay", "no-global-death-event"], terminal={"tickSteps": 1}
    )


async def _build_c12() -> JsonObject:
    s = _new_scenario("C12")
    dick = s.world.get_agent("wanderer_003")
    assert dick is not None
    s.world.modify_agent_materials(dick.id, 115.0)
    await s.invoke(
        "speak",
        "wanderer_003",
        {"message": "I am crossing toward the springs."},
        expected="Your message was sent to Region|nirvana",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.clock.advance(1.0)
    await s.invoke(
        "harvest_resources",
        "wanderer_003",
        {"resource_type": "energy", "amount": 1.0},
        expected=(
            "Successfully harvested ResourceTypes.ENERGY from Region nirvana\n"
            " Agent Energy: 100.5|Agent Materials: 160.0\n"
            " Region Energy: 59.0|Region Materials:60.0 "
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "build_home",
        dick.id,
        {},
        expected="You raise a home here. It cost you 80 materials; you have 80.0 left.",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "use_hearth",
        dick.id,
        {},
        expected=(
            "You rest at your hearth, burning 20.0 materials for 20.0 energy. "
            "Energy: 120.5, Materials: 60.0."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "initiate_mating",
        dick.id,
        {
            "target": "wanderer_004",
            "message": "Let this place shelter a new life.",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=(
            "Successfully sent the mating request to agent ID:wanderer_004|Agent Name:Allen, "
            "mating request is subject to proposal acceptance, in case of reject or timeout your "
            "committed resources will be returned back to you."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    def story_birth(sc: _Scenario) -> str:
        children = [
            agent
            for agent in sc.world.get_all_agents()
            if agent.id not in {"wanderer_001", "wanderer_002", "wanderer_003", "wanderer_004"}
        ]
        assert len(children) == 1
        child = children[0]
        return (
            f"Successfully accepted mating, Your offspring is now born with Agent ID:{child.id}|"
            f"Agent Name:{child.name},Your Child is now in this world, talk, coach, nurture it "
            "collectively if you wish so with your partner.\n Parent Details:\n "
            "Agent ID:wanderer_003|Agent Name:Dick and Agent ID:wanderer_004|Agent Name:Allen"
        )

    await s.invoke(
        "accept_mating",
        "wanderer_004",
        {"target": dick.id, "message": "Yes."},
        expected=story_birth,
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    allen = s.world.get_agent("wanderer_004")
    assert allen is not None
    s.world.modify_agent_energy(allen.id, -30.0)
    await s.invoke(
        "attack",
        dick.id,
        {"target": allen.id},
        expected="Successfully Attacked Allen|IDwanderer_004\n Energy remaining: 55.5",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    s.capture_checkpoint()
    await s.invoke(
        "transfer_resource",
        dick.id,
        {"target": allen.id, "resource_type": "energy", "amount": 6.0},
        expected=(
            "Successfully transferred ResourceTypes.ENERGY to Agent ID:wanderer_004|"
            "Agent Name:Allen,\n Agent Energy:49.5| Agent Materials:30.0"
        ),
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    await s.invoke(
        "move",
        dick.id,
        {"destination": "warm_springs"},
        expected="Agent Moved from nirvana to warm_springs Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    records = [
        _presentation_record("story", "cross-region-story-boundary", causalCursor=len(s.log.events))
    ]
    return _manifest(
        s,
        negative=["no-consequence-before-cause", "no-authored-relationship"],
        presentation_records=records,
    )


async def _build_pressure(chronicle_id: str, count: int) -> JsonObject:
    s = _new_scenario(chronicle_id)
    if chronicle_id == "C16":
        region_names = sorted(region.name for region in s.world.get_all_regions())
        for index in range(252):
            s.world.add_agent(
                AgentState(
                    id=f"pressure_{index:03d}",
                    name=f"Pressure {index:03d}",
                    persona="",
                    current_position=region_names[index % len(region_names)],
                    current_energy=100.0,
                    current_materials=100.0,
                    status=AgentStatus.ALIVE,
                )
            )
        owners = sorted(s.world.get_all_agents(), key=lambda agent: agent.id)[:128]
        for index, owner in enumerate(owners):
            assert s.world.build_home(
                f"pressure_home_{index:03d}",
                owner.id,
                owner.current_position,
                built_at=s.world.now(),
                integrity=100.0,
            )
        assert len(s.world.get_all_agents()) == 256
        assert len(s.world.get_all_homes()) == 128
    speaker = s.world.get_agent("wanderer_001")
    assert speaker is not None
    s.world.modify_agent_energy(speaker.id, float(count))
    s.initial_snapshot = s.snapshot(0)
    for index in range(count):
        s.clock.advance(0.001)
        result = await s.registry.invoke(
            "speak", "wanderer_001", {"message": f"pressure-{chronicle_id}-{index:04d}"}
        )
        assert result == "Your message was sent to Region|warm_springs"
        if chronicle_id == "C16" and index + 1 in {1_024, 2_048, 3_072}:
            s.capture_checkpoint()
    assert len(s.log.events) == count
    records = [
        _presentation_record(
            "pressure",
            f"{count}-real-speak-envelopes",
            envelopeCount=count,
            source="real-registered-speak-tool",
        )
    ]
    pressure_invariants: JsonObject = (
        {
            "envelopes": 4096,
            "agents": 256,
            "homes": 128,
            "stablePlacement": True,
            "heapPlateau": True,
            "poolClosure": True,
            "disposalClosure": True,
        }
        if chronicle_id == "C16"
        else {
            "envelopes": 120,
            "pauseFreezesPresentation": True,
            "queueBounded": True,
            "safeCancellation": True,
            "chronologyDigestPreserved": True,
        }
    )
    if chronicle_id == "C16":
        placement_rows = [
            *[["agent", agent["id"], agent["position"]] for agent in s.initial_snapshot["agents"]],
            *[
                ["home", home["home_id"], home["owner_id"], home["region"]]
                for home in s.initial_snapshot["homes"]
            ],
        ]
        pressure_proof: JsonObject = {
            "placementDigest": hashlib.sha256(
                json.dumps(placement_rows, separators=(",", ":")).encode()
            ).hexdigest(),
            "agentCount": 256,
            "homeCount": 128,
            "eventSources": ["wanderer_001"],
            "eventTypes": ["speak"],
            "speakerEnergyBefore": s.initial_snapshot["agents"][
                next(
                    index
                    for index, agent in enumerate(s.initial_snapshot["agents"])
                    if agent["id"] == "wanderer_001"
                )
            ]["energy"],
            "speakerEnergyAfter": speaker.current_energy,
            "speakEnergySpent": count * 0.5,
        }
    else:
        pressure_proof = {
            "firstCursor": 1,
            "lastCursor": count,
            "queueBound": 48,
            "digestCount": count,
            "firstTimestamp": serialize_event(s.log.events[0])["timestamp"],
            "lastTimestamp": serialize_event(s.log.events[-1])["timestamp"],
        }
    return _manifest(
        s,
        negative=["no-hand-authored-mechanic-envelope", "no-provider"],
        presentation_records=records,
        terminal={
            "pressureInvariants": pressure_invariants,
            "pressureProof": pressure_proof,
        },
    )


async def _build_c14() -> JsonObject:
    s = _new_scenario("C14")
    replacement_run_id = f"{s.run_id}-replacement"
    records = [
        _presentation_record(
            "transport-fault", "cursor-gap", firstMissingCursor=1, lastMissingCursor=2
        ),
        _presentation_record("transport-fault", "oversized-record-413", retryable=False),
        _presentation_record("transport-fault", "run-replacement", staleRunRejected=True),
    ]
    return _manifest(
        s,
        negative=["no-fabricated-gap-event", "no-guessed-413-line"],
        presentation_records=records,
        terminal={
            "presentationAuthority": {
                "kind": "transport-recovery",
                "terminal": {
                    "cursor": 0,
                    "runId": replacement_run_id,
                    "source": "live",
                    "sourceKey": f"live:{replacement_run_id}",
                },
            },
        },
    )


async def _build_c15() -> JsonObject:
    s = _new_scenario("C15")
    records = [
        _presentation_record(
            "session-edge", "archive-live-isolation", liveCursor=4, archiveCursor=2
        )
    ]
    return _manifest(
        s,
        negative=["no-cross-session-cursor-write", "no-archive-as-live-source"],
        presentation_records=records,
        terminal={
            "presentationAuthority": {
                "kind": "archive-live-isolation",
                "terminal": {
                    "cursor": 4,
                    "runId": s.run_id,
                    "source": "live",
                    "sourceKey": f"live:{s.run_id}",
                },
            },
        },
        checkpoint_reason="archive_live_isolation",
    )


async def _build_c17() -> JsonObject:
    s = _new_scenario("C17")
    s.world.add_agent(
        AgentState(
            id="wanderer_lost",
            name="Lost",
            persona="",
            current_position="missing_region",
            current_energy=1.0,
            current_materials=1.0,
            status=AgentStatus.ALIVE,
        )
    )
    await s.invoke(
        "look_around",
        "wanderer_lost",
        {},
        expected="Error: Cannot look around, region 'missing_region' does not exist.",
        outcome="rejected",
        mutation=False,
        event_delta=0,
    )
    lost = s.world.get_agent("wanderer_lost")
    assert lost is not None and s.world.remove_agent(lost)
    look_expected = (
        "YOUR CURRENT STATUS\nEnergy| 100.0\nMaterials| 45.0\nWorld INFORMATION\n"
        "Region| warm_springs - hot spring lakes — the least-poor refuge, but no longer plentiful\n"
        "Energy pool| 90.0\nMaterials pool| 80.0\n"
        "Connections| nirvana_west,nirvana_east,nirvana\n"
        "Agents present| Mae [id: wanderer_002] (energy 100.0, materials 45.0)\n"
    )
    await s.invoke(
        "look_around",
        "wanderer_001",
        {},
        expected=look_expected,
        outcome="success",
        mutation=False,
        event_delta=0,
    )
    await s.reject_missing_params("speak")
    await s.invoke(
        "speak",
        "wanderer_001",
        {"message": "Mae, the springs are quiet."},
        expected="Your message was sent to Region|warm_springs",
        outcome="success",
        mutation=True,
        event_delta=1,
    )
    s.clock.advance(1.0)
    await s.invoke(
        "speak",
        "wanderer_001",
        {"message": "Dick, can you hear me?", "target": "wanderer_003"},
        expected="Your message was sent to wanderer_003",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    runtime = Agent(
        "wanderer_001",
        s.world,
        s.bus,
        s.registry,
        _NeverDecider(),
        pace=0.0,
    )
    s.clock.advance(1.0)
    before_self_talk = s.snapshot()
    await runtime._emit_self_talk(Decision(text="I will keep this thought within."))
    assert s.snapshot(len(s.log.events) - 1) == before_self_talk
    self_talk = serialize_event(s.log.events[-1])
    assert self_talk == {
        "type": "self_talk",
        "source": "wanderer_001",
        "payload": {
            "message": "I will keep this thought within.",
            "agent_id": "wanderer_001",
            # serialize_event stamps the display-only classification onto every
            # serialized payload (observability/event_payloads.py); self_talk is an
            # utterance, so it is True. Asserted exactly, not matched loosely.
            "display_only": True,
        },
        "scope": "private",
        "region": None,
        "target": None,
        "timestamp": s.clock(),
    }
    return _manifest(
        s,
        negative=[
            "no-look-around-event",
            "no-invented-whisper-delivery",
            "no-private-self-talk-delivery",
        ],
        terminal={"lookAroundAsserted": True},
    )


_C18_FOUNDER_IDS = frozenset({"wanderer_001", "wanderer_002", "wanderer_003", "wanderer_004"})
"""C18's four starting beings -- Joe, Mae, Dick, Allen -- from ``config/world.yaml``."""


def _c18_mating_sent(target_id: str, target_name: str) -> str:
    """Mirror ``initiate_mating``'s exact success sentence for an arbitrary target."""
    return (
        f"Successfully sent the mating request to agent ID:{target_id}|"
        f"Agent Name:{target_name}, mating request is subject to proposal acceptance, "
        "in case of reject or timeout your committed resources will be returned back to you."
    )


def _c18_rejected(initiator_id: str, initiator_name: str) -> str:
    """Mirror ``reject_mating``'s exact success sentence for an arbitrary initiator."""
    return (
        f"Rejection successful, Agent ID:{initiator_id}|"
        f"Agent Name:{initiator_name} informed of rejection."
    )


def _c18_find_child(scenario: _Scenario) -> AgentState:
    """Return the single being born during C18 (the one id outside the four founders)."""
    children = [
        agent for agent in scenario.world.get_all_agents() if agent.id not in _C18_FOUNDER_IDS
    ]
    assert len(children) == 1
    return children[0]


def _c18_birth_expected(scenario: _Scenario) -> str:
    """Mirror ``accept_mating``'s exact success sentence for the Allen -> Mae birth."""
    child = _c18_find_child(scenario)
    return (
        f"Successfully accepted mating, Your offspring is now born with Agent ID:{child.id}|"
        f"Agent Name:{child.name},Your Child is now in this world, talk, coach, nurture it "
        "collectively if you wish so with your partner.\n Parent Details:\n "
        "Agent ID:wanderer_004|Agent Name:Allen and Agent ID:wanderer_002|Agent Name:Mae"
    )


def _c18_harvest_expected(
    actor_id: str, resource_type: str, region_name: str
) -> Callable[[_Scenario], str]:
    """Mirror ``harvest_resources``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        agent = scenario.world.get_agent(actor_id)
        region = scenario.world.get_region(region_name)
        assert agent is not None and region is not None
        enum_name = "ENERGY" if resource_type == "energy" else "MATERIALS"
        return (
            f"Successfully harvested ResourceTypes.{enum_name} from Region {region_name}\n"
            f" Agent Energy: {agent.current_energy}|Agent Materials: {agent.current_materials}\n"
            f" Region Energy: {region.current_energy}|Region Materials:{region.current_materials} "
        )

    return _expected


def _c18_build_home_expected(actor_id: str) -> Callable[[_Scenario], str]:
    """Mirror ``build_home``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        agent = scenario.world.get_agent(actor_id)
        assert agent is not None
        return (
            "You raise a home here. It cost you 80 materials; "
            f"you have {agent.current_materials} left."
        )

    return _expected


def _c18_hearth_expected(actor_id: str) -> Callable[[_Scenario], str]:
    """Mirror ``use_hearth``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        agent = scenario.world.get_agent(actor_id)
        assert agent is not None
        return (
            "You rest at your hearth, burning 20.0 materials for 20.0 energy. "
            f"Energy: {agent.current_energy}, Materials: {agent.current_materials}."
        )

    return _expected


def _c18_deposit_expected(actor_id: str, home_id: str, amount: float) -> Callable[[_Scenario], str]:
    """Mirror ``deposit_to_home``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        agent = scenario.world.get_agent(actor_id)
        home = scenario.world.get_home(home_id)
        assert agent is not None and home is not None
        return (
            f"You set {amount} materials into your home's store. It now holds "
            f"{home.vault_materials} materials; you hold {agent.current_materials}."
        )

    return _expected


def _c18_battered_expected(home_id: str) -> Callable[[_Scenario], str]:
    """Mirror ``break_in``'s exact non-breaching sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        home = scenario.world.get_home(home_id)
        assert home is not None
        return (
            f"You batter the home {home.home_id}; its soundness drops to {home.integrity:.1f} "
            f"but it still stands. You spent {BREAKIN_ENERGY_COST:.0f} energy and "
            f"{BREAKIN_MATERIALS_COST:.0f} materials."
        )

    return _expected


def _c18_attack_expected(attacker_id: str, victim_id: str) -> Callable[[_Scenario], str]:
    """Mirror ``attack``'s exact non-lethal success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        attacker = scenario.world.get_agent(attacker_id)
        victim = scenario.world.get_agent(victim_id)
        assert attacker is not None and victim is not None
        return (
            f"Successfully Attacked {victim.name}|ID{victim.id}\n"
            f" Energy remaining: {attacker.current_energy}"
        )

    return _expected


def _c18_rescue_expected(sender_id: str, receiver_id: str) -> Callable[[_Scenario], str]:
    """Mirror ``transfer_resource``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        sender = scenario.world.get_agent(sender_id)
        receiver = scenario.world.get_agent(receiver_id)
        assert sender is not None and receiver is not None
        return (
            "Successfully transferred ResourceTypes.ENERGY to "
            f"Agent ID:{receiver.id}|Agent Name:{receiver.name},\n"
            f" Agent Energy:{sender.current_energy}| Agent Materials:{sender.current_materials}"
        )

    return _expected


def _c18_lethal_expected(
    attacker_id: str, victim_id: str, looted_energy: float, looted_materials: float
) -> Callable[[_Scenario], str]:
    """Mirror ``attack``'s exact lethal success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        attacker = scenario.world.get_agent(attacker_id)
        victim = scenario.world.get_agent(victim_id)
        assert attacker is not None and victim is not None
        return (
            f"You struck down {victim.name}|ID{victim.id} and took "
            f"{looted_energy} energy and {looted_materials} materials from them as loot.\n"
            f" Energy: {attacker.current_energy}|Materials: {attacker.current_materials}"
        )

    return _expected


def _c18_scavenge_expected(actor_id: str, home_id: str, taken: float) -> Callable[[_Scenario], str]:
    """Mirror ``scavenge_ruins``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        agent = scenario.world.get_agent(actor_id)
        home = scenario.world.get_home(home_id)
        assert agent is not None and home is not None
        return (
            f"You pick {taken} materials from the ruins. They hold {home.remnant_materials} "
            f"more; you hold {agent.current_materials}."
        )

    return _expected


async def _build_c18() -> JsonObject:
    """Build the Grand Tour: a small cast's lives, cycling every canonical event type.

    Five beings (four founders -- Joe, Mae, Dick, Allen -- plus Dick and Allen's
    offspring) live a full arc: gather and hoard, court across three mating branches
    (a rejection, a timeout, and a stale-initiator invalidation) plus one successful
    birth, raise and share a home to its hearth and its own hoard, raid a neighbour's
    homes (a theft, then a seizure), trade a non-lethal blow for a rescue and a
    lethal blow for a death and its decay, watch a home collapse and get picked over,
    and close on the newborn's first solitary steps and a private thought. Every
    achievable canonical event type (see ``catalog.CANONICAL_EVENT_TYPES``) appears
    at least once; see ``tests/fixtures/chronicles/chronicle_producer_test.py::
    test_c18_grand_tour_covers_every_achievable_canonical_event_type`` for the
    contract this scenario exists to satisfy.

    **Home causality (2026-07-31).** A replaying frontend must be able to rebuild
    every home from the initial snapshot plus the event stream alone, so each of
    C18's homes takes the only causal route open to it:

    * Dick's two contested Nirvana homes are staged into cursor-zero truth by
      :meth:`_Scenario.seal_initial_snapshot` (the pattern C07/C08/C09 use). They
      cannot be raised by the real ``build_home`` tool: that tool allows a being
      exactly one home, and the only other beings in Nirvana are Allen and Mae,
      who must both be *homeless* non-stakeholders to break in and seize.
    * The newborn's home is raised by the real ``build_home`` tool, because it is
      the one home that CANNOT be cursor-zero truth -- its owner is born
      mid-scenario, at cursor 14.

    Before this, all three were created by a silent ``world.build_home`` scaffold
    mid-scenario, so a replaying frontend was handed ``home_breached`` at cursor 22
    for a home it had never heard of (the first checkpoint revealing them was 25).
    """
    s = _new_scenario("C18")
    joe, mae, dick, allen = "wanderer_001", "wanderer_002", "wanderer_003", "wanderer_004"

    # -- Cursor-zero truth: Dick's two Nirvana homes, standing before the tour opens.
    # Staged (not tool-built) for the reason in the docstring; sealing them here is what
    # makes Act 4's raid causally legible to a replaying frontend.
    s.world.build_home("home_c18_thieve", dick, "nirvana", built_at=s.world.now(), integrity=50.0)
    s.world.deposit_to_home_vault("home_c18_thieve", 40.0)
    s.world.build_home("home_c18_colonize", dick, "nirvana", built_at=s.world.now(), integrity=50.0)
    s.seal_initial_snapshot()

    # -- Act 0: the world wakes (a directly-published system announcement, exactly
    # mirroring scripts/run.py's real simulation_started publish -- not a tool call).
    await s.bus.publish(
        Event(
            "simulation_started",
            "world",
            {
                "run_id": s.run_id,
                "agent_count": len(s.world.get_all_agents()),
                "world_time": s.world.now(),
                "message": f"Simulation started: {len(s.world.get_all_agents())} beings breathing.",
            },
            scope=ScopeType.GLOBAL,
            timestamp=s.world.now(),
        )
    )

    # -- Act 1: gather, then hoard. --
    await s.invoke(
        "harvest_resources",
        joe,
        {"resource_type": "energy", "amount": 1.0},
        expected=_c18_harvest_expected(joe, "energy", "warm_springs"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.world.modify_agent_materials(joe, 254.0)  # scaffold Joe to just under the hoard threshold
    await s.invoke(
        "harvest_resources",
        joe,
        {"resource_type": "materials", "amount": 1.0},
        expected=_c18_harvest_expected(joe, "materials", "warm_springs"),
        outcome="success",
        mutation=True,
        event_delta=2,  # resource_changed + agent_started_hoarding (crosses 300)
        record_assertion=False,
    )

    # -- Act 2: court, across three branches plus one cheaply-reachable invalidation. --
    await s.invoke(
        "speak",
        dick,
        {"message": "Is anyone else drawn toward the springs this season?"},
        expected="Your message was sent to Region|nirvana",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "speak",
        dick,
        {"message": "Allen -- before I ask her, tell me true: is Mae spoken for?", "target": allen},
        expected=f"Your message was sent to {allen}",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    # Branch 1: Dick -> Allen, rejected.
    await s.invoke(
        "initiate_mating",
        dick,
        {"target": allen, "message": "Will you?", "resources": {"energy": 50.0, "materials": 30.0}},
        expected=_c18_mating_sent(allen, "Allen"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "reject_mating",
        allen,
        {"target": dick, "message": "Not this season."},
        expected=_c18_rejected(dick, "Dick"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    # Branch 2: Dick -> Mae (remote), timed out by the world-tick.
    await s.invoke(
        "initiate_mating",
        dick,
        {
            "target": mae,
            "message": "A distant offer.",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_c18_mating_sent(mae, "Mae"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS + 1.0)
    before_timeout = len(s.log.events)
    await tick(s.world, s.bus)
    assert len(s.log.events) == before_timeout + 1
    assert s.log.events[-1].type == "mating_proposal_timeout"
    # Branch 3: Dick -> Allen again, invalidated when Dick goes stale before acceptance
    # (the cheaply-reachable trick: directly record a mating to force cooldown/cap
    # ineligibility, mirroring C05's identical technique).
    await s.invoke(
        "initiate_mating",
        dick,
        {
            "target": allen,
            "message": "One more try?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_c18_mating_sent(allen, "Allen"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    assert s.world.record_mating(dick, s.world.now())
    await s.invoke(
        "accept_mating",
        allen,
        {"target": dick, "message": "Yes."},
        expected=(
            "Invalid: This mating proposal is no longer valid (the initiator is on "
            "cooldown or at their offspring cap); their committed resources have been refunded."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    # Branch 4 (the successful branch): Allen -> Mae, accepted -> a birth.
    await s.invoke(
        "initiate_mating",
        allen,
        {"target": mae, "message": "Shall we?", "resources": {"energy": 50.0, "materials": 30.0}},
        expected=_c18_mating_sent(mae, "Mae"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "accept_mating",
        mae,
        {"target": allen, "message": "Yes."},
        expected=_c18_birth_expected,
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    child = _c18_find_child(s)
    child_id = child.id
    s.capture_checkpoint()

    # -- Act 3: build and share a home, to its hearth and its own hoard. --
    await s.invoke(
        "build_home",
        joe,
        {},
        expected=_c18_build_home_expected(joe),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    home = s.world.stakeholder_home_of(joe)
    assert home is not None
    homestead_id = home.home_id
    await s.invoke(
        "pledge_home",
        mae,
        {"home_id": homestead_id},
        expected=(
            "You pledge yourself to this home; you now share its keep and may rest at its "
            "hearth. 2 beings tend it now."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    await s.invoke(
        "use_hearth",
        joe,
        {},
        expected=_c18_hearth_expected(joe),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.world.modify_agent_materials(joe, 100.0)  # scaffold Joe up to exactly a hoarding deposit
    await s.invoke(
        "deposit_to_home",
        joe,
        {"amount": 300.0},
        expected=_c18_deposit_expected(joe, homestead_id, 300.0),
        outcome="success",
        mutation=True,
        event_delta=1,  # home_started_hoarding (crosses 300)
        record_assertion=False,
    )
    await s.invoke(
        "leave_home",
        mae,
        {},
        expected="You give up your place in this home; its keep and hearth are no longer yours.",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # -- Act 4: contest a neighbour's homes -- theft, then seizure. --
    await s.invoke(
        "move",
        mae,
        {"destination": "nirvana"},
        expected="Agent Moved from warm_springs to nirvana Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )
    # Both Nirvana homes have stood since cursor zero, so the Act-2 world-tick already
    # drew Dick's upkeep and repaired them to their solo ceiling. Wind them back to the
    # 50.0 the raid is authored against -- a silent soundness scaffold of exactly the
    # kind C18 already uses for energy and materials, and one that introduces no home.
    for contested_home_id in ("home_c18_thieve", "home_c18_colonize"):
        contested = s.world.get_home(contested_home_id)
        assert contested is not None
        assert s.world.modify_home_integrity(contested_home_id, 50.0 - contested.integrity)
    s.world.modify_agent_energy(mae, 100.0)
    s.world.modify_agent_materials(mae, 100.0)
    s.world.modify_agent_energy(allen, 100.0)
    s.world.modify_agent_materials(allen, 100.0)
    await s.invoke(
        "break_in",
        allen,
        {"target_home": "home_c18_thieve", "intent": "thieve"},
        expected=_c18_battered_expected("home_c18_thieve"),
        outcome="success",
        mutation=True,
        event_delta=0,
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        mae,
        {"target_home": "home_c18_thieve", "intent": "thieve"},
        expected=(
            "You break the home home_c18_thieve open and strip its store — 40.0 materials, "
            "split among 2. The emptied wreck still stands, for now."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,  # home_breached + home_thieved
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        mae,
        {"target_home": "home_c18_colonize", "intent": "colonize"},
        expected=_c18_battered_expected("home_c18_colonize"),
        outcome="success",
        mutation=True,
        event_delta=0,
        record_assertion=False,
    )
    await s.invoke(
        "break_in",
        allen,
        {"target_home": "home_c18_colonize", "intent": "colonize"},
        expected=(
            "You break the home home_c18_colonize open and take it for your own. "
            "2 of you hold it now; shore it up before it falls."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,  # home_breached + home_colonized
        record_assertion=False,
    )
    colonized = s.world.get_home("home_c18_colonize")
    assert colonized is not None and colonized.owner_id == allen
    assert sorted(colonized.stakeholders) == sorted([allen, mae])
    s.capture_checkpoint()

    # -- Act 5: violence -- a non-lethal blow and a rescue, then a lethal one. --
    allen_agent = s.world.get_agent(allen)
    assert allen_agent is not None
    s.world.modify_agent_energy(allen, 20.0 - allen_agent.current_energy)
    await s.invoke(
        "attack",
        dick,
        {"target": allen},
        expected=_c18_attack_expected(dick, allen),
        outcome="success",
        mutation=True,
        event_delta=2,  # attack + agent_paralyzed
        record_assertion=False,
    )
    await s.invoke(
        "transfer_resource",
        mae,
        {"target": allen, "resource_type": "energy", "amount": 6.0},
        expected=_c18_rescue_expected(mae, allen),
        outcome="success",
        mutation=True,
        event_delta=2,  # resource_transferred + agent_recovered
        record_assertion=False,
    )
    s.world.modify_agent_energy(allen, 50.0)  # scaffold Allen back up to strike again
    dick_agent = s.world.get_agent(dick)
    assert dick_agent is not None
    s.world.modify_agent_energy(dick, 15.0 - dick_agent.current_energy)
    looted_energy = dick_agent.current_energy
    looted_materials = dick_agent.current_materials
    await s.invoke(
        "attack",
        allen,
        {"target": dick},
        expected=_c18_lethal_expected(allen, dick, looted_energy, looted_materials),
        outcome="success",
        mutation=True,
        event_delta=1,  # agent_died
        record_assertion=False,
    )
    assert s.world.get_agent(dick) is not None  # the corpse lingers, not yet decayed
    s.capture_checkpoint()

    # -- Act 6: the newborn raises a home she cannot keep; it collapses and is picked over. --
    # Raised through the REAL build_home tool, so it enters the stream as a public
    # ``home_built`` a replaying frontend can act on. This is the one home that cannot be
    # cursor-zero truth: its owner did not exist until cursor 14.
    s.world.modify_agent_materials(child_id, HOME_BUILD_MATERIALS_COST)  # the build cost
    await s.invoke(
        "build_home",
        child_id,
        {},
        expected=_c18_build_home_expected(child_id),
        outcome="success",
        mutation=True,
        event_delta=1,  # home_built
        record_assertion=False,
    )
    orphan_home = s.world.stakeholder_home_of(child_id)
    assert orphan_home is not None
    orphan_home_id = orphan_home.home_id
    child_agent = s.world.get_agent(child_id)
    assert child_agent is not None
    s.world.modify_agent_materials(child_id, -child_agent.current_materials)  # no upkeep payer
    s.world.modify_agent_materials(joe, 50.0)  # so the homestead itself survives this tick
    s.clock.advance(CORPSE_DECAY_SECONDS + 1.0)
    before_decay = len(s.log.events)
    await tick(s.world, s.bus)
    tick_types = [event.type for event in s.log.events[before_decay:]]
    assert tick_types == ["agent_decayed", "home_collapsed", "home_collapsed"]
    assert s.world.get_agent(dick) is None
    collapsed_home = s.world.get_home(orphan_home_id)
    assert collapsed_home is not None and collapsed_home.status.value == "ruin"
    homestead = s.world.get_home(homestead_id)
    assert homestead is not None and homestead.status.value == "standing"

    await s.invoke(
        "scavenge_ruins",
        joe,
        {"target_home": orphan_home_id, "amount": 5.0},
        expected=_c18_scavenge_expected(joe, orphan_home_id, 5.0),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # -- Act 7: the newborn's first solitary steps, and a private thought. --
    runtime = Agent(child_id, s.world, s.bus, s.registry, _NeverDecider(), pace=0.0)
    before_self_talk = s.snapshot()
    await runtime._emit_self_talk(Decision(text="I am my own, now -- I will see what is beyond."))
    assert s.snapshot(len(s.log.events) - 1) == before_self_talk
    self_talk = serialize_event(s.log.events[-1])
    assert self_talk["type"] == "self_talk" and self_talk["scope"] == "private"
    assert self_talk["target"] is None

    await s.invoke(
        "move",
        child_id,
        {"destination": "nirvana_east"},
        expected="Agent Moved from warm_springs to nirvana_east Successfully",
        outcome="success",
        mutation=True,
        event_delta=2,
        record_assertion=False,
    )

    return _manifest(
        s,
        negative=[
            "no-fabricated-mechanic-event",
            "no-skipped-canonical-event-type",
            "no-silent-family-boundary",
        ],
        terminal={
            "tickSteps": 2,
            "cast": sorted([joe, mae, dick, allen, child_id]),
        },
    )


_C19_FOUNDER_IDS = frozenset({"wanderer_003", "wanderer_004"})
"""C19's two starting beings -- Dick and Allen -- from ``config/world.yaml``."""


def _c19_find_child(scenario: _Scenario) -> AgentState:
    """Return the single being born during C19 (the one id outside the two founders)."""
    children = [
        agent for agent in scenario.world.get_all_agents() if agent.id not in _C19_FOUNDER_IDS
    ]
    assert len(children) == 1
    return children[0]


def _c19_birth_expected(scenario: _Scenario) -> str:
    """Mirror ``accept_mating``'s exact success sentence for the Allen -> Dick birth."""
    child = _c19_find_child(scenario)
    return (
        f"Successfully accepted mating, Your offspring is now born with Agent ID:{child.id}|"
        f"Agent Name:{child.name},Your Child is now in this world, talk, coach, nurture it "
        "collectively if you wish so with your partner.\n Parent Details:\n "
        "Agent ID:wanderer_004|Agent Name:Allen and Agent ID:wanderer_003|Agent Name:Dick"
    )


def _c19_transfer_expected(
    resource_label: str, sender_id: str, receiver_id: str
) -> Callable[[_Scenario], str]:
    """Mirror ``transfer_resource``'s exact success sentence, read live post-call."""

    def _expected(scenario: _Scenario) -> str:
        sender = scenario.world.get_agent(sender_id)
        receiver = scenario.world.get_agent(receiver_id)
        assert sender is not None and receiver is not None
        return (
            f"Successfully transferred {resource_label} to "
            f"Agent ID:{receiver.id}|Agent Name:{receiver.name},\n"
            f" Agent Energy:{sender.current_energy}| Agent Materials:{sender.current_materials}"
        )

    return _expected


async def _build_c19() -> JsonObject:
    """Build Two Beings: a minimal, human-steppable two-adult arc in one region.

    Unlike C18 (the exhaustive 28-canonical-type coverage proof, unwatchable for a
    human -- five beings, events scattered across three regions), C19 exists to be
    INSPECTED act by act: exactly two adult beings -- Dick and Allen, both already
    at ``nirvana`` in ``config/world.yaml`` -- live an entire arc without ever
    leaving the region (no ``move`` call is ever issued, so
    ``agent_left_region``/``agent_entered_region`` never fire -- nothing happens
    off-screen). Joe and Mae, the other two ``config/world.yaml`` founders, are
    removed before any public event so the cast never grows beyond Dick + Allen
    (+ their later child).

    The story: Dick speaks, Allen has a private thought, Dick gathers and crosses
    his own hoard threshold, raises a home, tends its hearth alone, and banks its
    vault into a hoard of its own; Allen joins that home, then leaves it. The two
    then whisper, trade a gift, and court -- a first proposal is rejected, a
    second succeeds and a child is born (present from birth, but never itself an
    actor -- the plan's third being, born and nothing more). Allen turns raider on
    the very home he once shared: one breach strips its vault, a second breach
    seizes it outright. Allen strikes Dick down to paralysis, then in mercy
    revives him with a gift of energy -- but the peace does not hold: Dick lands a
    lethal blow. Allen's corpse decays and the now-ownerless home he seized
    collapses in the same tick; Dick, the sole survivor, picks over its ruins.

    See ``tests/fixtures/chronicles/chronicle_producer_test.py::
    test_c19_two_beings_covers_the_exact_authored_act_sequence`` for the contract
    this scenario exists to satisfy: the ordered, authored act sequence, not full
    canonical event-type coverage (that remains C18's job).
    """
    s = _new_scenario("C19")
    dick, allen = "wanderer_003", "wanderer_004"

    # -- Silent setup: exactly two adult beings for the whole chronicle. --
    joe_agent = s.world.get_agent("wanderer_001")
    mae_agent = s.world.get_agent("wanderer_002")
    assert joe_agent is not None and mae_agent is not None
    assert s.world.remove_agent(joe_agent)
    assert s.world.remove_agent(mae_agent)
    s.seal_initial_snapshot()

    # ============================== INDIVIDUAL ===============================
    # Act: speak aloud.
    s.clock.advance(3.0)
    await s.invoke(
        "speak",
        dick,
        {"message": "The springs still hold some warmth; I mean to stay and build here."},
        expected="Your message was sent to Region|nirvana",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: self_talk (a private thought) -- not a tool call, the Agent runtime's own
    # breathing-loop action (mirrors C18's identical technique).
    s.clock.advance(3.0)
    runtime = Agent(allen, s.world, s.bus, s.registry, _NeverDecider(), pace=0.0)
    before_self_talk = s.snapshot()
    await runtime._emit_self_talk(
        Decision(
            text=(
                "Dick raises walls faster than I can dream them. I wonder what mine "
                "would look like, filled with what's his."
            )
        )
    )
    assert s.snapshot(len(s.log.events) - 1) == before_self_talk
    self_talk = serialize_event(s.log.events[-1])
    assert self_talk["type"] == "self_talk" and self_talk["scope"] == "private"
    assert self_talk["target"] is None

    # Act: gather (a plain harvest).
    s.clock.advance(3.0)
    await s.invoke(
        "harvest_resources",
        dick,
        {"resource_type": "energy", "amount": 1.0},
        expected=_c18_harvest_expected(dick, "energy", "nirvana"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: cross the personal hoarding threshold (a harvest that also crosses 300
    # materials in the same call).
    s.clock.advance(3.0)
    s.world.modify_agent_materials(dick, 254.0)  # scaffold Dick to just under the threshold
    await s.invoke(
        "harvest_resources",
        dick,
        {"resource_type": "materials", "amount": 1.0},
        expected=_c18_harvest_expected(dick, "materials", "nirvana"),
        outcome="success",
        mutation=True,
        event_delta=2,  # resource_changed + agent_started_hoarding (crosses 300)
        record_assertion=False,
    )

    # Act: build a home.
    s.clock.advance(3.0)
    await s.invoke(
        "build_home",
        dick,
        {},
        expected=_c18_build_home_expected(dick),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    home = s.world.stakeholder_home_of(dick)
    assert home is not None
    home_id = home.home_id

    # Act: tend the hearth (Dick alone -- Allen has not yet joined).
    s.clock.advance(3.0)
    await s.invoke(
        "use_hearth",
        dick,
        {},
        expected=_c18_hearth_expected(dick),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: store to the vault, crossing the home's own hoarding threshold.
    s.clock.advance(3.0)
    s.world.modify_agent_materials(dick, 100.0)  # scaffold Dick to exactly a hoarding deposit
    await s.invoke(
        "deposit_to_home",
        dick,
        {"amount": 300.0},
        expected=_c18_deposit_expected(dick, home_id, 300.0),
        outcome="success",
        mutation=True,
        event_delta=1,  # home_started_hoarding (crosses 300)
        record_assertion=False,
    )

    # Act: the other joins.
    s.clock.advance(3.0)
    await s.invoke(
        "pledge_home",
        allen,
        {"home_id": home_id},
        expected=(
            "You pledge yourself to this home; you now share its keep and may rest at its "
            "hearth. 2 beings tend it now."
        ),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: and leaves.
    s.clock.advance(3.0)
    await s.invoke(
        "leave_home",
        allen,
        {},
        expected="You give up your place in this home; its keep and hearth are no longer yours.",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.capture_checkpoint()

    # ================================ SHARED ==================================
    # Act: whisper (a targeted speak).
    s.clock.advance(3.0)
    await s.invoke(
        "speak",
        allen,
        {
            "message": "Between us only -- I've been watching how you tend this place.",
            "target": dick,
        },
        expected=f"Your message was sent to {dick}",
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: give a resource.
    s.clock.advance(3.0)
    await s.invoke(
        "transfer_resource",
        allen,
        {"target": dick, "resource_type": "materials", "amount": 5.0},
        expected=_c19_transfer_expected("ResourceTypes.MATERIALS", allen, dick),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: propose and be rejected.
    s.clock.advance(3.0)
    await s.invoke(
        "initiate_mating",
        allen,
        {
            "target": dick,
            "message": "Will you have me?",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_c18_mating_sent(dick, "Dick"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.clock.advance(3.0)
    await s.invoke(
        "reject_mating",
        dick,
        {"target": allen, "message": "Not yet -- I'm not ready."},
        expected=_c18_rejected(allen, "Allen"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    # Act: propose and succeed.
    s.clock.advance(3.0)
    await s.invoke(
        "initiate_mating",
        allen,
        {
            "target": dick,
            "message": "I ask again, in earnest this time.",
            "resources": {"energy": 50.0, "materials": 30.0},
        },
        expected=_c18_mating_sent(dick, "Dick"),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    s.clock.advance(3.0)
    s.world.modify_agent_materials(dick, 25.0)  # scaffold Dick to match the proposal's commitment
    await s.invoke(
        "accept_mating",
        dick,
        {"target": allen, "message": "Yes. Let's see what we make."},
        expected=_c19_birth_expected,
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )
    child = _c19_find_child(s)
    child_id = child.id
    s.capture_checkpoint()

    # =============================== CONTEST ==================================
    # Act: break in, then take.
    s.clock.advance(3.0)
    s.world.modify_home_integrity(home_id, -75.0)  # scaffold the home for a one-blow breach
    await s.invoke(
        "break_in",
        allen,
        {"target_home": home_id, "intent": "thieve"},
        expected=(
            f"You break the home {home_id} open and strip its store — 300.0 materials, "
            "split among 1. The emptied wreck still stands, for now."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,  # home_breached + home_thieved
        record_assertion=False,
    )

    # Act: break in, then claim.
    s.clock.advance(3.0)
    await s.invoke(
        "break_in",
        allen,
        {"target_home": home_id, "intent": "colonize"},
        expected=(
            f"You break the home {home_id} open and take it for your own. "
            "1 of you hold it now; shore it up before it falls."
        ),
        outcome="success",
        mutation=True,
        event_delta=2,  # home_breached + home_colonized
        record_assertion=False,
    )
    colonized = s.world.get_home(home_id)
    assert colonized is not None and colonized.owner_id == allen
    assert colonized.stakeholders == [allen]
    s.capture_checkpoint()

    # ============================ VIOLENCE + MERCY ============================
    # Act: strike, then fall.
    s.clock.advance(3.0)
    allen_agent = s.world.get_agent(allen)
    dick_agent = s.world.get_agent(dick)
    assert allen_agent is not None and dick_agent is not None
    s.world.modify_agent_energy(allen, 50.0 - allen_agent.current_energy)
    s.world.modify_agent_energy(dick, 20.0 - dick_agent.current_energy)
    await s.invoke(
        "attack",
        allen,
        {"target": dick},
        expected=_c18_attack_expected(allen, dick),
        outcome="success",
        mutation=True,
        event_delta=2,  # attack + agent_paralyzed
        record_assertion=False,
    )

    # Act: revive with a gift.
    s.clock.advance(3.0)
    await s.invoke(
        "transfer_resource",
        allen,
        {"target": dick, "resource_type": "energy", "amount": 6.0},
        expected=_c19_transfer_expected("ResourceTypes.ENERGY", allen, dick),
        outcome="success",
        mutation=True,
        event_delta=2,  # resource_transferred + agent_recovered
        record_assertion=False,
    )
    s.capture_checkpoint()

    # ================================ FINALE ===================================
    # Act: a lethal strike.
    s.clock.advance(3.0)
    dick_agent = s.world.get_agent(dick)
    allen_agent = s.world.get_agent(allen)
    assert dick_agent is not None and allen_agent is not None
    s.world.modify_agent_energy(dick, 50.0 - dick_agent.current_energy)
    s.world.modify_agent_energy(allen, 15.0 - allen_agent.current_energy)
    looted_energy = allen_agent.current_energy
    looted_materials = allen_agent.current_materials
    await s.invoke(
        "attack",
        dick,
        {"target": allen},
        expected=_c18_lethal_expected(dick, allen, looted_energy, looted_materials),
        outcome="success",
        mutation=True,
        event_delta=1,  # agent_died
        record_assertion=False,
    )
    assert s.world.get_agent(allen) is not None  # the corpse lingers, not yet decayed

    # Act: decay, and the home falls -- one world-tick sweeps both in the same beat.
    s.clock.advance(CORPSE_DECAY_SECONDS + 1.0)
    before_finale_tick = len(s.log.events)
    await tick(s.world, s.bus)
    tick_types = [event.type for event in s.log.events[before_finale_tick:]]
    assert tick_types == ["agent_decayed", "home_collapsed"]
    assert s.world.get_agent(allen) is None
    collapsed_home = s.world.get_home(home_id)
    assert collapsed_home is not None and collapsed_home.status.value == "ruin"

    # Act: the survivor picks the ruins.
    s.clock.advance(3.0)
    await s.invoke(
        "scavenge_ruins",
        dick,
        {"target_home": home_id, "amount": 5.0},
        expected=_c18_scavenge_expected(dick, home_id, 5.0),
        outcome="success",
        mutation=True,
        event_delta=1,
        record_assertion=False,
    )

    return _manifest(
        s,
        negative=[
            "no-fabricated-mechanic-event",
            "no-region-travel",
            "no-third-adult-actor",
        ],
        terminal={
            "tickSteps": 1,
            "cast": sorted([dick, allen, child_id]),
        },
    )


_BUILDERS: dict[str, Callable[[], Coroutine[Any, Any, JsonObject]]] = {
    "C00": _build_c00,
    "C01": _build_c01,
    "C02": _build_c02,
    "C03": _build_c03,
    "C04": _build_c04,
    "C05": _build_c05,
    "C06": _build_c06,
    "C07": _build_c07,
    "C08": _build_c08,
    "C09": _build_c09,
    "C10": _build_c10,
    "C11": _build_c11,
    "C12": _build_c12,
    "C13": lambda: _build_pressure("C13", 120),
    "C14": _build_c14,
    "C15": _build_c15,
    "C16": lambda: _build_pressure("C16", 4096),
    "C17": _build_c17,
    "C18": _build_c18,
    "C19": _build_c19,
}
"""One async builder per canonical Chronicle id, keyed to match ``CANONICAL_CHRONICLES``."""


async def _build_selected(chronicle_ids: Sequence[str]) -> list[JsonObject]:
    """Build exactly ``chronicle_ids``, in that order, through one bounded async run.

    Each id's builder runs in total isolation (its own fresh seeded
    :class:`~world.world.WorldState`, bus, and registry via :func:`_new_scenario`) --
    building a subset never touches, re-derives, or depends on any other chronicle's
    manifest. This is what lets ``--only C18`` (see ``scripts/build_mock_chronicles.py``)
    generate one fixture without any risk to the checked-in C00-C17 bytes.

    Args:
        chronicle_ids: Canonical ids to build, e.g. ``["C18"]`` or the full
            :data:`~tests.fixtures.chronicles.catalog.CANONICAL_CHRONICLES` key order.

    Returns:
        One manifest per id, in the given order.
    """
    manifests = [await _BUILDERS[chronicle_id]() for chronicle_id in chronicle_ids]
    assert [manifest["id"] for manifest in manifests] == list(chronicle_ids)
    return manifests


async def _build_all() -> list[JsonObject]:
    return await _build_selected(list(CANONICAL_CHRONICLES))


def build_manifests(only: Sequence[str] | None = None) -> list[JsonObject]:
    """Build Chronicle manifests through one bounded provider-free async run.

    Args:
        only: Optional subset of canonical Chronicle ids (e.g. ``["C18"]``) to build
            in isolation. ``None`` (the default) builds every id in
            :data:`~tests.fixtures.chronicles.catalog.CANONICAL_CHRONICLES`, in order
            -- the original, unchanged behaviour every existing caller still gets.

    Returns:
        One manifest per requested id (or per canonical id, when ``only`` is
        ``None``), in that order.

    Raises:
        RuntimeError: If called from within a running event loop.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        if only is not None:
            return asyncio.run(_build_selected(list(only)))
        return asyncio.run(_build_all())
    raise RuntimeError("build_manifests() requires no active event loop")


def render_catalog(manifests: list[JsonObject]) -> dict[str, bytes]:
    """Render canonical sorted-key, two-space, newline-terminated JSON bytes."""
    rendered: dict[str, bytes] = {}
    catalog_entries: list[JsonObject] = []
    for manifest in manifests:
        validate_manifest(manifest)
        filename = f"{manifest['id']}-{manifest['slug']}.json"
        rendered[filename] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
        catalog_entries.append(
            {
                "id": manifest["id"],
                "slug": manifest["slug"],
                "file": filename,
                "version": manifest["version"],
                "seed": manifest["seed"],
                "runId": manifest["runId"],
                "expectedFinalCursor": manifest["expectedFinalCursor"],
            }
        )
    catalog = {"schema": 1, "chronicles": catalog_entries}
    rendered["catalog.json"] = (json.dumps(catalog, indent=2, sort_keys=True) + "\n").encode()
    return dict(sorted(rendered.items()))


__all__ = ["build_manifests", "render_catalog"]

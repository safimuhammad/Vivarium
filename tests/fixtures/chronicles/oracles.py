"""Strict structural oracles for generated Chronicle manifests."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from .catalog import (
    CANONICAL_CHRONICLES,
    CANONICAL_EVENT_TYPES,
    FROZEN_GRAPH_LIFECYCLE_ORACLES,
    FROZEN_POSITIVE_ORACLES,
    OCCURRENCE_QUALIFIED_EVENT_MARKERS,
)

_REQUIRED_EVENT_TYPES: dict[str, set[str]] = {
    "C04": {"mating_initiated", "mating_rejected", "agent_born"},
    "C05": {"mating_rejected", "mating_proposal_timeout", "mating_proposal_invalidated"},
    "C06": {"home_built", "hearth_used", "home_joined", "home_left", "home_started_hoarding"},
    "C07": {"home_breached", "home_thieved"},
    "C08": {"home_breached", "home_colonized"},
    "C09": {"home_collapsed", "ruins_scavenged"},
    "C10": {"attack", "agent_paralyzed", "agent_recovered", "resource_transferred"},
    "C11": {"agent_died", "agent_decayed"},
    "C12": {
        "speak",
        "resource_changed",
        "home_built",
        "hearth_used",
        "mating_initiated",
        "agent_born",
        "attack",
        "agent_paralyzed",
        "agent_recovered",
        "resource_transferred",
        "agent_left_region",
        "agent_entered_region",
    },
    "C17": {"speak", "self_talk"},
}

_FORBIDDEN_EVENT_TYPES: dict[str, set[str]] = {
    "C00": {"look_around"},
    "C08": {"home_thieved"},
    "C17": {"look_around"},
    "C19": {"agent_left_region", "agent_entered_region"},
}

_TOOL_SUCCESS_EVENTS: dict[str, list[str]] = {
    "accept_mating": ["agent_born"],
    "attack": ["attack", "agent_paralyzed"],
    "break_in": [],
    "build_home": ["home_built"],
    "deposit_to_home": [],
    "harvest_resources": ["resource_changed"],
    "initiate_mating": ["mating_initiated"],
    "leave_home": ["home_left"],
    "look_around": [],
    "move": ["agent_left_region", "agent_entered_region"],
    "pledge_home": ["home_joined"],
    "reject_mating": ["mating_rejected"],
    "scavenge_ruins": ["ruins_scavenged"],
    "speak": ["speak"],
    "transfer_resource": ["resource_transferred"],
    "use_hearth": ["hearth_used"],
    "withdraw_from_home": [],
}

_TOOL_CHANGED_SECTIONS: dict[str, set[str]] = {
    "accept_mating": {"agents", "pending_proposals"},
    "attack": {"agents"},
    "break_in": {"agents", "homes"},
    "build_home": {"agents", "homes"},
    "deposit_to_home": {"agents", "homes"},
    "harvest_resources": {"agents", "regions"},
    "initiate_mating": {"agents", "pending_proposals"},
    "leave_home": {"agents", "homes"},
    "look_around": set(),
    "move": {"agents"},
    "pledge_home": {"agents", "homes"},
    "reject_mating": {"agents", "pending_proposals"},
    "scavenge_ruins": {"agents", "ruins"},
    "speak": {"agents"},
    "transfer_resource": {"agents"},
    "use_hearth": {"agents"},
    "withdraw_from_home": {"agents", "homes"},
}

_EXPECTED_TOOL_MUTATIONS: dict[str, list[dict[str, Any]]] = {
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


def validate_manifest(value: Mapping[str, Any]) -> None:
    """Raise ``AssertionError`` unless ``value`` is a version-1 Chronicle manifest."""
    required = {
        "id",
        "slug",
        "version",
        "seed",
        "runId",
        "initialSnapshot",
        "entries",
        "checkpoints",
        "expectedMarkers",
        "expectedFinalCursor",
        "expectedTerminal",
        "negativeAssertions",
    }
    assert set(value) == required
    chronicle_id = value["id"]
    assert isinstance(chronicle_id, str) and chronicle_id in CANONICAL_CHRONICLES
    assert value["slug"] == CANONICAL_CHRONICLES[chronicle_id]
    assert value["version"] == 1
    assert value["seed"] == 30_000 + int(chronicle_id[1:])
    assert value["runId"] == f"mock-{chronicle_id.lower()}-v1"
    _validate_snapshot(value["initialSnapshot"], value["runId"])
    assert value["initialSnapshot"]["event_cursor"] == 0

    entries = value["entries"]
    assert isinstance(entries, list)
    assert [entry["cursor"] for entry in entries] == list(range(1, len(entries) + 1))
    for entry in entries:
        _validate_entry(entry)
    assert [entry["event"]["timestamp"] for entry in entries] == sorted(
        entry["event"]["timestamp"] for entry in entries
    )
    if entries:
        assert entries[0]["event"]["timestamp"] >= value["initialSnapshot"]["world_time"]

    checkpoints = value["checkpoints"]
    assert isinstance(checkpoints, list) and checkpoints
    previous_line = 0
    previous_cursor = -1
    previous_world_time = float("-inf")
    for record in checkpoints:
        assert set(record) == {"line", "checkpoint", "safety"}
        assert isinstance(record["line"], int) and record["line"] >= 1
        assert record["line"] > previous_line
        assert record["safety"] in {"safe-world-tick", "archive-event", "archive-manual"}
        checkpoint = record["checkpoint"]
        assert set(checkpoint) == {
            "schema",
            "type",
            "reason",
            "run_id",
            "world_time",
            "event_cursor",
            "snapshot",
        }
        assert checkpoint["schema"] == 1
        assert checkpoint["type"] == "world_snapshot_checkpoint"
        assert record["safety"] == _checkpoint_safety_for_reason(checkpoint["reason"])
        assert checkpoint["run_id"] == value["runId"]
        _validate_snapshot(checkpoint["snapshot"], value["runId"])
        assert checkpoint["world_time"] == checkpoint["snapshot"]["world_time"]
        assert checkpoint["event_cursor"] == checkpoint["snapshot"]["event_cursor"]
        assert previous_cursor <= checkpoint["event_cursor"] <= len(entries)
        assert checkpoint["world_time"] >= previous_world_time
        if checkpoint["event_cursor"]:
            assert (
                checkpoint["world_time"]
                >= entries[checkpoint["event_cursor"] - 1]["event"]["timestamp"]
            )
        previous_line = record["line"]
        previous_cursor = checkpoint["event_cursor"]
        previous_world_time = checkpoint["world_time"]

    assert value["expectedFinalCursor"] == len(entries)
    assert isinstance(value["expectedMarkers"], list)
    assert all(isinstance(item, str) and item for item in value["expectedMarkers"])
    occurrence_types = OCCURRENCE_QUALIFIED_EVENT_MARKERS.get(chronicle_id, frozenset())
    expected_event_markers = {
        (
            f"event:{entry['event']['type']}@cursor:{entry['cursor']}"
            if entry["event"]["type"] in occurrence_types
            else f"event:{entry['event']['type']}"
        )
        for entry in entries
    }
    assert value["expectedMarkers"] == [*sorted(expected_event_markers), "checkpoint:final"]
    assert isinstance(value["expectedTerminal"], dict)
    assert isinstance(value["negativeAssertions"], list)
    assert all(isinstance(item, str) and item for item in value["negativeAssertions"])
    assert checkpoints[-1]["checkpoint"]["event_cursor"] == value["expectedFinalCursor"]
    assert "finalSnapshot" in value["expectedTerminal"]
    assert value["expectedTerminal"]["finalSnapshot"] == checkpoints[-1]["checkpoint"]["snapshot"]
    semantic = value["expectedTerminal"]["semanticOracle"]
    assert set(semantic) == {"positive", "negative", "terminal"}
    assert tuple(semantic["positive"]) == FROZEN_POSITIVE_ORACLES[chronicle_id]
    assert semantic["negative"] == value["negativeAssertions"]
    assert semantic["terminal"] == ["final-checkpoint-aligned", "run-identity-preserved"]
    graph_lifecycle_oracle = value["expectedTerminal"].get("graphLifecycleOracle")
    expected_graph_lifecycle_oracle = FROZEN_GRAPH_LIFECYCLE_ORACLES.get(chronicle_id)
    if expected_graph_lifecycle_oracle is None:
        assert graph_lifecycle_oracle is None
    else:
        assert graph_lifecycle_oracle == expected_graph_lifecycle_oracle
        lifecycle_snapshots = [
            value["initialSnapshot"],
            *[record["checkpoint"]["snapshot"] for record in checkpoints],
        ]
        if "actors" in expected_graph_lifecycle_oracle:
            actor_lifecycle = expected_graph_lifecycle_oracle["actors"]
            assert isinstance(actor_lifecycle, Mapping)
            actor_peak = actor_lifecycle.get("peak")
            assert isinstance(actor_peak, int)
            assert actor_peak == max(len(snapshot["agents"]) for snapshot in lifecycle_snapshots)
        if "homes" in expected_graph_lifecycle_oracle:
            home_lifecycle = expected_graph_lifecycle_oracle["homes"]
            assert isinstance(home_lifecycle, Mapping)
            home_peak = home_lifecycle.get("peak")
            assert isinstance(home_peak, int)
            assert home_peak == max(
                len(snapshot["homes"]) + len(snapshot["ruins"]) for snapshot in lifecycle_snapshots
            )
    event_types = {entry["event"]["type"] for entry in entries}
    assert _REQUIRED_EVENT_TYPES.get(chronicle_id, set()) <= event_types
    assert not (_FORBIDDEN_EVENT_TYPES.get(chronicle_id, set()) & event_types)
    if chronicle_id == "C04":
        proposal_sources = {
            entry["event"]["source"]
            for entry in entries
            if entry["event"]["type"] == "mating_initiated"
        }
        assert {"wanderer_001", "wanderer_003"} <= proposal_sources
    if chronicle_id == "C17":
        private = [entry["event"] for entry in entries if entry["event"]["type"] == "self_talk"]
        assert len(private) == 1 and private[0]["scope"] == "private"
        assert private[0]["target"] is None
    if chronicle_id == "C13":
        assert len(entries) == 120
        assert value["expectedTerminal"]["pressureInvariants"]["chronologyDigestPreserved"]
        proof = value["expectedTerminal"]["pressureProof"]
        assert proof == {
            "firstCursor": 1,
            "lastCursor": 120,
            "queueBound": 48,
            "digestCount": 120,
            "firstTimestamp": entries[0]["event"]["timestamp"],
            "lastTimestamp": entries[-1]["event"]["timestamp"],
        }
    if chronicle_id == "C16":
        initial = value["initialSnapshot"]
        assert len(initial["agents"]) == 256
        assert len(initial["homes"]) == 128
        assert len({agent["id"] for agent in initial["agents"]}) == 256
        assert len({home["home_id"] for home in initial["homes"]}) == 128
        assert value["expectedTerminal"]["pressureInvariants"]["disposalClosure"]
        placement_rows = [
            *[["agent", agent["id"], agent["position"]] for agent in initial["agents"]],
            *[
                ["home", home["home_id"], home["owner_id"], home["region"]]
                for home in initial["homes"]
            ],
        ]
        agents = {agent["id"]: agent for agent in initial["agents"]}
        final_agents = {
            agent["id"]: agent for agent in value["expectedTerminal"]["finalSnapshot"]["agents"]
        }
        assert value["expectedTerminal"]["pressureProof"] == {
            "placementDigest": hashlib.sha256(
                json.dumps(placement_rows, separators=(",", ":")).encode()
            ).hexdigest(),
            "agentCount": 256,
            "homeCount": 128,
            "eventSources": ["wanderer_001"],
            "eventTypes": ["speak"],
            "speakerEnergyBefore": agents["wanderer_001"]["energy"],
            "speakerEnergyAfter": final_agents["wanderer_001"]["energy"],
            "speakEnergySpent": 2048.0,
        }
        assert agents["wanderer_001"]["energy"] - final_agents["wanderer_001"]["energy"] == 2048.0

    for assertion in value["expectedTerminal"].get("toolAssertions", []):
        assert set(assertion) == {
            "tool",
            "outcome",
            "result",
            "invocationLayer",
            "before",
            "after",
            "events",
            "checkpointTruth",
            "mutationExpectations",
        }
        assert assertion["invocationLayer"] == "builtin"
        assert isinstance(assertion["before"], dict)
        assert isinstance(assertion["after"], dict)
        assert isinstance(assertion["events"], list)
        if assertion["outcome"] in {"rejected", "boundary-rejected"}:
            assert assertion["before"] == assertion["after"]
            assert assertion["events"] == []
            assert assertion["mutationExpectations"] == []
        if assertion["outcome"] == "success":
            tool = assertion["tool"]
            assert assertion["mutationExpectations"] == _EXPECTED_TOOL_MUTATIONS[tool]
            for expectation in assertion["mutationExpectations"]:
                assert (
                    _snapshot_path(assertion["before"], expectation["path"])
                    == expectation["before"]
                )
                assert (
                    _snapshot_path(assertion["after"], expectation["path"]) == expectation["after"]
                )
            assert [event["type"] for event in assertion["events"]] == _TOOL_SUCCESS_EVENTS[tool]
            changed = {
                key
                for key in ("agents", "regions", "homes", "ruins", "pending_proposals")
                if assertion["before"][key] != assertion["after"][key]
            }
            assert changed == _TOOL_CHANGED_SECTIONS[tool], (
                tool,
                changed,
                _TOOL_CHANGED_SECTIONS[tool],
            )
            for event in assertion["events"]:
                _validate_serialized_event(event)
                assert event["timestamp"] == assertion["before"]["world_time"]
            if not assertion["events"]:
                assert assertion["checkpointTruth"]["snapshot"] == assertion["after"]
                assert any(
                    record["checkpoint"]["reason"] == assertion["checkpointTruth"]["reason"]
                    and record["checkpoint"]["snapshot"] == assertion["after"]
                    for record in checkpoints
                )

    for record in value["expectedTerminal"].get("presentationRecords", []):
        assert set(record) == {"schema", "kind", "label", "payload"}
        assert record["schema"] == 1
        assert record["kind"] in {"story", "transport-fault", "session-edge", "pressure"}
        assert isinstance(record["label"], str) and record["label"]
        assert isinstance(record["payload"], dict)


def _checkpoint_safety_for_reason(reason: Any) -> str:
    """Mirror production's exhaustive checkpoint-reason safety partition."""
    assert isinstance(reason, str) and reason
    if reason == "world_tick":
        return "safe-world-tick"
    if reason.startswith("event:"):
        return "archive-event"
    return "archive-manual"


def _validate_entry(entry: Mapping[str, Any]) -> None:
    assert set(entry) == {"cursor", "event", "resolved", "snapshot_after"}
    assert isinstance(entry["cursor"], int) and entry["cursor"] >= 1
    assert isinstance(entry["resolved"], dict)
    assert entry["snapshot_after"] is None or isinstance(entry["snapshot_after"], str)
    event = entry["event"]
    assert set(event) == {"type", "source", "payload", "scope", "region", "target", "timestamp"}
    assert event["type"] in CANONICAL_EVENT_TYPES
    assert isinstance(event["source"], str) and event["source"]
    assert isinstance(event["payload"], dict)
    assert event["scope"] in {"local", "global", "targeted", "private"}
    assert event["region"] is None or isinstance(event["region"], str)
    assert event["target"] is None or isinstance(event["target"], str)
    assert isinstance(event["timestamp"], (int, float))


def _validate_serialized_event(event: Mapping[str, Any]) -> None:
    assert set(event) == {"type", "source", "payload", "scope", "region", "target", "timestamp"}
    assert isinstance(event["type"], str) and event["type"]
    assert isinstance(event["source"], str) and event["source"]
    assert isinstance(event["payload"], dict)
    assert event["scope"] in {"local", "global", "targeted", "private"}
    assert event["region"] is None or isinstance(event["region"], str)
    assert event["target"] is None or isinstance(event["target"], str)
    assert isinstance(event["timestamp"], (int, float))


def _validate_snapshot(snapshot: Mapping[str, Any], run_id: str) -> None:
    """Validate one serialized world snapshot's shape.

    Every key below is required **unconditionally**, because
    :func:`~observability.snapshot.serialize_world_snapshot` emits every one of them
    for every chronicle. Two of them arrived after the first Chronicles were authored:

    ``region_pressure`` -- detached capacity pressure high-water records. This was
    previously required only for ``C18``/``C19``, an allowance deliberately left
    narrow so as not to touch C00-C17 during the grand-tour work. The consequence
    was that the exact-key assertion below could **never** pass for C00-C17: the
    producer emits ``region_pressure`` for them too, so ``set(snapshot) == required``
    compared a 11-key snapshot against a 10-key expectation and every C00-C17 build
    raised inside ``validate_manifest``. That is the whole of the long-standing
    21-failure Python drift. Requiring the key everywhere is a *strengthening*: the
    per-entry shape/ordering assertions further down now run for all 20 chronicles
    instead of 2.

    ``seed_persona`` -- the run's default persona, stated once per snapshot instead
    of repeated on every being. It was already required unconditionally, and is the
    precedent this function now follows for ``region_pressure``.

    Args:
        snapshot: One serialized world snapshot from a Chronicle manifest.
        run_id: The manifest's run id, which the snapshot must carry.
    """
    required = {
        "schema",
        "run_id",
        "world_time",
        "event_cursor",
        "seed_persona",
        "agents",
        "regions",
        "homes",
        "ruins",
        "pending_proposals",
        "region_pressure",
    }
    list_keys = [
        "agents",
        "regions",
        "homes",
        "ruins",
        "pending_proposals",
        "region_pressure",
    ]
    assert set(snapshot) == required
    assert snapshot["schema"] == 1
    assert snapshot["run_id"] == run_id
    assert isinstance(snapshot["seed_persona"], str)
    assert isinstance(snapshot["world_time"], (int, float))
    assert isinstance(snapshot["event_cursor"], int) and snapshot["event_cursor"] >= 0
    for key in list_keys:
        assert isinstance(snapshot[key], list)
    pressure_regions = [entry["region"] for entry in snapshot["region_pressure"]]
    for entry in snapshot["region_pressure"]:
        assert set(entry) == {"region", "population_high_water", "built_footprint_high_water"}
        assert isinstance(entry["region"], str) and entry["region"]
        assert isinstance(entry["population_high_water"], int)
        assert entry["population_high_water"] >= 0
        assert isinstance(entry["built_footprint_high_water"], int)
        assert entry["built_footprint_high_water"] >= 0
    assert pressure_regions == sorted(pressure_regions)


def _snapshot_path(snapshot: Mapping[str, Any], path: str) -> Any:
    parts = path.strip("/").split("/")
    collection_name, entity_id = parts[:2]
    collection = snapshot[collection_name]
    assert isinstance(collection, list)
    if entity_id == "@count":
        assert len(parts) == 2
        return len(collection)
    assert len(parts) == 3
    identity_key = {
        "agents": "id",
        "regions": "name",
        "homes": "home_id",
        "ruins": "home_id",
    }.get(collection_name)
    assert identity_key is not None
    entity = next(item for item in collection if item[identity_key] == entity_id)
    return entity[parts[2]]


__all__ = ["validate_manifest"]

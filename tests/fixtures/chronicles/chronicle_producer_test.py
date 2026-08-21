"""Contract tests for the provider-free Mock Chronicle producer."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from tests.fixtures.chronicles.catalog import (
    CANONICAL_CHRONICLES,
    CANONICAL_TOOL_NAMES,
)
from tests.fixtures.chronicles.catalog import (
    CANONICAL_EVENT_TYPES as PRODUCER_EVENT_TYPES,
)
from tests.fixtures.chronicles.oracles import validate_manifest
from tests.fixtures.chronicles.producer import build_manifests, render_catalog
from tools.builtin import BUILTIN_TOOLS

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "tests/frontend-app/fixtures/chronicles/data"
BUILD_SCRIPT = ROOT / "scripts/build_mock_chronicles.py"

EXPECTED_CHRONICLES = {
    "C00": "world-four-regions-topology",
    "C01": "movement-local-path",
    "C02": "travel-all-regions",
    "C03": "resources-harvest-hoard-transfer",
    "C04": "mating-proposal-birth",
    "C05": "mating-failure-branches",
    "C06": "home-build-hearth-stake-vault",
    "C07": "home-contest-thieve",
    "C08": "home-contest-colonize",
    "C09": "home-silent-repair-collapse-ruin",
    "C10": "combat-hit-paralyze-recover",
    "C11": "combat-lethal-death-decay",
    "C12": "cross-region-causal-life-story",
    "C13": "presentation-backlog-pause-resume",
    "C14": "transport-reconnect-checkpoint-recovery",
    "C15": "archive-live-isolation",
    "C16": "pressure-4096-envelopes",
    "C17": "communication-perception-privacy",
    "C18": "grand-tour-all-events",
    "C19": "two-beings",
}

EXPECTED_TOOLS = {
    "accept_mating",
    "attack",
    "break_in",
    "build_home",
    "deposit_to_home",
    "harvest_resources",
    "initiate_mating",
    "leave_home",
    "look_around",
    "move",
    "pledge_home",
    "reject_mating",
    "scavenge_ruins",
    "speak",
    "transfer_resource",
    "use_hearth",
    "withdraw_from_home",
}

EXPECTED_TOPOLOGY = {
    "nirvana": ["nirvana_east", "nirvana_west", "warm_springs"],
    "nirvana_east": ["nirvana", "warm_springs"],
    "nirvana_west": ["nirvana", "warm_springs"],
    "warm_springs": ["nirvana", "nirvana_east", "nirvana_west"],
}

CANONICAL_EVENT_TYPES = {
    "agent_born",
    "agent_died",
    "agent_decayed",
    "agent_paralyzed",
    "agent_recovered",
    "agent_left_region",
    "agent_entered_region",
    "speak",
    "self_talk",
    "resource_changed",
    "resource_transferred",
    "agent_started_hoarding",
    "mating_initiated",
    "mating_rejected",
    "mating_proposal_invalidated",
    "mating_proposal_timeout",
    "attack",
    "home_built",
    "hearth_used",
    "home_joined",
    "home_left",
    "home_started_hoarding",
    "home_collapsed",
    "home_breached",
    "home_thieved",
    "home_colonized",
    "ruins_scavenged",
    "simulation_started",
}


def test_catalog_is_frozen_and_set_equal_to_real_builtins() -> None:
    """The producer must freeze all C00-C17 and exactly the registered 17 tools."""
    assert dict(CANONICAL_CHRONICLES) == EXPECTED_CHRONICLES
    assert set(CANONICAL_TOOL_NAMES) == EXPECTED_TOOLS
    assert set(CANONICAL_TOOL_NAMES) == set(BUILTIN_TOOLS)


def test_c18_grand_tour_covers_every_achievable_canonical_event_type() -> None:
    """C18 is the permanent, sequential proof every sim-emittable event type appears.

    Built in isolation (``only=["C18"]``) so this test is independent of the
    KNOWN, pre-existing C00-C17 ``region_pressure`` producer/oracle drift (see
    ``docs/superpowers/plans/2026-07-24-grand-tour-chronicle.md`` Global
    Constraints) -- it exercises only C18's own path under the CURRENT producer
    schema and CURRENT oracles.

    The target event-type set is imported from the canonical source
    (``catalog.CANONICAL_EVENT_TYPES``, aliased here as ``PRODUCER_EVENT_TYPES``)
    rather than hand-copied, so if the sim core ever grows a new canonical event
    type, this test fails until the grand tour is extended to cover it -- this
    test IS the coverage contract, not a snapshot of one.
    """
    # Every canonical event type is reachable in a scripted producer scenario: each
    # is either a real builtin tool's success event, a real world.tick() sweep
    # event, or a directly-published system/self-talk event (see producer.py's
    # _build_c18 for exactly which path reaches each type). Kept as an explicit,
    # empty set -- not omitted -- so a future regression here is a loud, reasoned
    # choice, never a silent hole in the tour.
    unreachable_in_scripted_scenario: frozenset[str] = frozenset()

    manifests = build_manifests(only=["C18"])
    assert [manifest["id"] for manifest in manifests] == ["C18"]
    manifest = manifests[0]
    validate_manifest(manifest)

    event_types = {entry["event"]["type"] for entry in manifest["entries"]}
    target = PRODUCER_EVENT_TYPES - unreachable_in_scripted_scenario
    missing = target - event_types
    assert not missing, f"C18 is missing canonical event types: {sorted(missing)}"
    assert target <= event_types


C19_ACT_EVENT_SEQUENCE: list[str] = [
    "speak",
    "self_talk",
    "resource_changed",
    "resource_changed",
    "agent_started_hoarding",
    "home_built",
    "hearth_used",
    "home_started_hoarding",
    "home_joined",
    "home_left",
    "speak",
    "resource_transferred",
    "mating_initiated",
    "mating_rejected",
    "mating_initiated",
    "agent_born",
    "home_breached",
    "home_thieved",
    "home_breached",
    "home_colonized",
    "attack",
    "agent_paralyzed",
    "agent_recovered",
    "resource_transferred",
    "agent_died",
    "agent_decayed",
    "home_collapsed",
    "ruins_scavenged",
]
"""The exact, ordered act sequence C19 authors -- not full canonical coverage."""


def test_c19_two_beings_covers_the_exact_authored_act_sequence() -> None:
    """C19 is a minimal, human-steppable two-adult arc -- exactly the authored acts.

    Unlike C18 (the exhaustive 28-canonical-type coverage proof -- unwatchable for
    a human, five beings, events scattered across three regions), C19 targets
    watchability: this test asserts C19's manifest reproduces the EXACT, ordered
    act sequence the plan authors (a fixed list, not
    ``catalog.CANONICAL_EVENT_TYPES``), so a human reviewer can step through it act
    by act, plus the plan's hard constraints (exactly two adult actors, one
    region, no off-screen travel). Built in isolation (``only=["C19"]``) for the
    same reason C18's coverage test is isolated -- independent of the pre-existing
    C00-C17 region_pressure producer/oracle drift.
    """
    manifests = build_manifests(only=["C19"])
    assert [manifest["id"] for manifest in manifests] == ["C19"]
    manifest = manifests[0]
    validate_manifest(manifest)

    event_types = [entry["event"]["type"] for entry in manifest["entries"]]
    assert event_types == C19_ACT_EVENT_SEQUENCE

    # Hard constraint: nothing may happen off-screen -- no region travel, ever.
    assert "agent_left_region" not in event_types
    assert "agent_entered_region" not in event_types

    # Every event that carries a region must be nirvana -- the whole chronicle
    # plays out in one region.
    for entry in manifest["entries"]:
        region = entry["event"]["region"]
        assert region is None or region == "nirvana", (entry["cursor"], region)

    # Exactly two adult beings act for the whole chronicle; a third appears only
    # as the child born from mating, and never itself as an actor.
    initial_agents = manifest["initialSnapshot"]["agents"]
    assert {agent["id"] for agent in initial_agents} == {"wanderer_003", "wanderer_004"}
    assert {agent["position"] for agent in initial_agents} == {"nirvana"}

    born_event = next(
        entry["event"] for entry in manifest["entries"] if entry["event"]["type"] == "agent_born"
    )
    child_id = born_event["payload"]["child_id"]
    allowed_sources = {"wanderer_003", "wanderer_004", child_id, "system"}
    assert all(entry["event"]["source"] in allowed_sources for entry in manifest["entries"])
    child_sourced = [entry for entry in manifest["entries"] if entry["event"]["source"] == child_id]
    assert len(child_sourced) == 1 and child_sourced[0]["event"]["type"] == "agent_born"


def test_manifests_are_deterministic_schema_valid_and_topology_exact() -> None:
    """Two in-memory builds are identical and every manifest validates."""
    first = build_manifests()
    second = build_manifests()
    assert first == second
    assert {manifest["id"] for manifest in first} == set(EXPECTED_CHRONICLES)

    for manifest in first:
        validate_manifest(manifest)
        assert manifest["version"] == 1
        assert manifest["runId"] == f"mock-{manifest['id'].lower()}-v1"
        assert manifest["seed"] == 30_000 + int(manifest["id"][1:])
        assert manifest["expectedFinalCursor"] == len(manifest["entries"])
        timestamps = [entry["event"]["timestamp"] for entry in manifest["entries"]]
        assert timestamps == sorted(timestamps)

    c00 = next(manifest for manifest in first if manifest["id"] == "C00")
    topology = {
        region["name"]: sorted(region["connections"])
        for region in c00["initialSnapshot"]["regions"]
    }
    assert topology == EXPECTED_TOPOLOGY
    assert c00["entries"] == []
    assert c00["expectedTerminal"]["ownership"] == "observer-snapshot"

    c17 = next(manifest for manifest in first if manifest["id"] == "C17")
    assert c17["expectedTerminal"]["lookAroundAsserted"] is True
    assert "look_around" in c17["expectedTerminal"]["producerResults"]
    assert all(entry["event"]["type"] != "look_around" for entry in c17["entries"])


def test_c09_repeated_markers_are_bound_to_each_manifest_cursor() -> None:
    """C09 evidence authority must identify both collapse and ruin occurrences."""
    c09 = next(manifest for manifest in build_manifests() if manifest["id"] == "C09")

    assert c09["expectedMarkers"] == [
        "event:agent_entered_region",
        "event:agent_left_region",
        "event:home_collapsed@cursor:1",
        "event:home_collapsed@cursor:2",
        "event:ruins_scavenged@cursor:5",
        "event:ruins_scavenged@cursor:6",
        "checkpoint:final",
    ]


def test_event_target_homes_are_causally_present_before_their_first_use() -> None:
    """Every home action must target cursor-visible truth, never hidden producer setup."""
    for manifest in build_manifests():
        known_homes = {
            home["home_id"]
            for home in [
                *manifest["initialSnapshot"]["homes"],
                *manifest["initialSnapshot"]["ruins"],
            ]
        }
        for entry in manifest["entries"]:
            event = entry["event"]
            payload = event["payload"]
            home_ids = {
                value
                for key in ("home_id", "target_home")
                if isinstance((value := payload.get(key)), str)
            }
            if event["type"] == "home_built":
                known_homes.update(home_ids)
                continue
            assert home_ids <= known_homes, (
                manifest["id"],
                entry["cursor"],
                event["type"],
                sorted(home_ids - known_homes),
            )


def test_home_lifecycle_and_agent_region_causality_are_enforced() -> None:
    """Collapse, travel, and ruin use must form one cursor-ordered causal story."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}
    for manifest in manifests.values():
        assert_causal_world_transitions(manifest)

    standing_target = deepcopy(manifests["C09"])
    standing_target["entries"][4]["event"]["payload"]["home_id"] = "home_repair"
    standing_target["entries"][4]["event"]["payload"]["target_home"] = "home_repair"
    with pytest.raises(AssertionError, match="collapsed ruin"):
        assert_causal_world_transitions(standing_target)

    impossible_departure = deepcopy(manifests["C09"])
    impossible_departure["entries"][2]["event"]["payload"]["from_region"] = "nirvana"
    with pytest.raises(AssertionError, match="departed from its current region"):
        assert_causal_world_transitions(impossible_departure)

    duplicate_collapse = deepcopy(manifests["C09"])
    duplicate_collapse["entries"][1]["event"]["payload"]["home_id"] = "home_c09"
    duplicate_collapse["entries"][1]["event"]["payload"]["target_home"] = "home_c09"
    with pytest.raises(AssertionError, match="standing home"):
        assert_causal_world_transitions(duplicate_collapse)


def assert_causal_world_transitions(manifest: dict[str, Any]) -> None:
    """Validate agent travel and home lifecycle state in public cursor order."""
    snapshot = manifest["initialSnapshot"]
    agent_regions = {agent["id"]: agent["position"] for agent in snapshot["agents"]}
    home_states: dict[str, tuple[str, str]] = {}
    for home in snapshot["homes"]:
        assert home["status"] == "standing", (
            manifest["id"],
            home["home_id"],
            "initial home must be standing",
        )
        home_states[home["home_id"]] = ("standing", home["region"])
    for ruin in snapshot["ruins"]:
        assert ruin["status"] == "ruin", (
            manifest["id"],
            ruin["home_id"],
            "initial ruin must be collapsed",
        )
        assert ruin["home_id"] not in home_states
        home_states[ruin["home_id"]] = ("ruin", ruin["region"])

    pending_travel: dict[str, tuple[str, str]] = {}
    prior_cursor = snapshot["event_cursor"]
    standing_actions = {
        "hearth_used",
        "home_joined",
        "home_left",
        "home_started_hoarding",
        "home_breached",
        "home_thieved",
        "home_colonized",
    }

    for entry in manifest["entries"]:
        cursor = entry["cursor"]
        assert cursor == prior_cursor + 1, (
            manifest["id"],
            prior_cursor,
            cursor,
            "public cursor order",
        )
        prior_cursor = cursor
        event = entry["event"]
        event_type = event["type"]
        payload = event["payload"]

        if event_type == "agent_born":
            child_id = payload["child_id"]
            assert child_id not in agent_regions
            agent_regions[child_id] = payload["region"]
        elif event_type == "agent_left_region":
            agent_id = payload["agent_id"]
            departure = (payload["from_region"], payload["to_region"])
            assert agent_regions.get(agent_id) == departure[0], (
                manifest["id"],
                cursor,
                agent_id,
                "agent departed from its current region",
                agent_regions.get(agent_id),
                departure[0],
            )
            assert agent_id not in pending_travel, (
                manifest["id"],
                cursor,
                agent_id,
                "agent cannot start overlapping travel",
            )
            assert event["region"] == departure[0]
            pending_travel[agent_id] = departure
        elif event_type == "agent_entered_region":
            agent_id = payload["agent_id"]
            arrival = (payload["from_region"], payload["to_region"])
            assert pending_travel.get(agent_id) == arrival, (
                manifest["id"],
                cursor,
                agent_id,
                "arrival must complete the preceding departure",
                pending_travel.get(agent_id),
                arrival,
            )
            assert agent_regions.get(agent_id) == arrival[0]
            assert event["region"] == arrival[1]
            agent_regions[agent_id] = arrival[1]
            del pending_travel[agent_id]
        elif event_type == "agent_decayed":
            agent_id = payload["agent_id"]
            agent_regions.pop(agent_id, None)
            pending_travel.pop(agent_id, None)

        if event_type == "home_built":
            home_id = payload["home_id"]
            assert home_id not in home_states, (
                manifest["id"],
                cursor,
                home_id,
                "home build must introduce a new ID",
            )
            home_states[home_id] = ("standing", payload["region"])
        elif event_type == "home_collapsed":
            home_id = payload["home_id"]
            region = payload["region"]
            assert event["region"] == region
            assert home_states.get(home_id) == ("standing", region), (
                manifest["id"],
                cursor,
                home_id,
                "collapse must target a standing home in-region",
                home_states.get(home_id),
            )
            home_states[home_id] = ("ruin", region)
        elif event_type in standing_actions:
            home_id = payload["home_id"]
            region = payload["region"]
            assert event["region"] == region
            assert home_states.get(home_id) == ("standing", region), (
                manifest["id"],
                cursor,
                event_type,
                home_id,
                "standing-home action must target a standing home in-region",
                home_states.get(home_id),
            )
        elif event_type == "ruins_scavenged":
            home_id = payload["home_id"]
            region = payload["region"]
            agent_id = payload["agent_id"]
            assert event["region"] == region
            assert home_states.get(home_id) == ("ruin", region), (
                manifest["id"],
                cursor,
                home_id,
                "ruins_scavenged must target an already-collapsed ruin in-region",
                home_states.get(home_id),
            )
            assert agent_regions.get(agent_id) == region, (
                manifest["id"],
                cursor,
                agent_id,
                "ruin scavenger must already be in the ruin region",
                agent_regions.get(agent_id),
                region,
            )

    assert pending_travel == {}, (
        manifest["id"],
        "every public departure must have a matching arrival",
        pending_travel,
    )


def test_every_tool_has_success_and_rejection_producer_assertions() -> None:
    """Every real builtin owns exact success and rejected/eventless boundary evidence."""
    manifests = build_manifests()
    coverage: dict[str, set[str]] = {name: set() for name in EXPECTED_TOOLS}
    for manifest in manifests:
        for assertion in manifest["expectedTerminal"].get("toolAssertions", []):
            if assertion["outcome"] not in {"success", "rejected"}:
                continue
            coverage[assertion["tool"]].add(assertion["outcome"])
            assert assertion["result"]
            if assertion["outcome"] == "rejected":
                assert assertion["events"] == []
                assert assertion["before"] == assertion["after"]
    assert coverage == {name: {"success", "rejected"} for name in EXPECTED_TOOLS}


def test_every_tool_assertion_carries_exact_builtin_semantics() -> None:
    """I1: producer evidence must prove exact state, event, and real-builtin truth."""
    assertions = [
        assertion
        for manifest in build_manifests()
        for assertion in manifest["expectedTerminal"].get("toolAssertions", [])
    ]
    for tool in EXPECTED_TOOLS:
        owned = [assertion for assertion in assertions if assertion["tool"] == tool]
        success = next(assertion for assertion in owned if assertion["outcome"] == "success")
        rejected = next(assertion for assertion in owned if assertion["outcome"] == "rejected")
        for assertion in (success, rejected):
            assert assertion["invocationLayer"] == "builtin"
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
            assert isinstance(assertion["before"], dict)
            assert isinstance(assertion["after"], dict)
            for event in assertion["events"]:
                assert set(event) == {
                    "type",
                    "source",
                    "payload",
                    "scope",
                    "region",
                    "target",
                    "timestamp",
                }
        assert rejected["before"] == rejected["after"]
        assert rejected["events"] == []
        assert success["before"] != success["after"] or success["checkpointTruth"]
        assert success["mutationExpectations"]


def test_exact_tool_mutation_oracles_reject_tampered_field_values() -> None:
    """Residual I1: exact values, not merely changed sections, certify every family."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}

    def tamper(chronicle_id: str, tool: str, collection: str, entity_id: str, field: str) -> None:
        manifest = deepcopy(manifests[chronicle_id])
        assertion = next(
            item
            for item in manifest["expectedTerminal"]["toolAssertions"]
            if item["tool"] == tool and item["outcome"] == "success"
        )
        entity = next(item for item in assertion["after"][collection] if item["id"] == entity_id)
        entity[field] = 999.0
        with pytest.raises(AssertionError):
            validate_manifest(manifest)

    tamper("C01", "move", "agents", "wanderer_001", "energy")
    tamper("C03", "harvest_resources", "agents", "wanderer_001", "energy")
    tamper("C04", "accept_mating", "agents", "wanderer_002", "energy")
    tamper("C06", "use_hearth", "agents", "wanderer_001", "energy")
    tamper("C10", "attack", "agents", "wanderer_002", "energy")


def test_manifest_rejects_unknown_events_nonzero_baseline_and_missing_terminal() -> None:
    """Residual I4: fabricated mechanics and incomplete baseline/terminal truth fail."""
    manifest = next(item for item in build_manifests() if item["id"] == "C12")
    assert len(CANONICAL_EVENT_TYPES) == 28
    assert set(PRODUCER_EVENT_TYPES) == CANONICAL_EVENT_TYPES

    fabricated = deepcopy(manifest)
    entry = deepcopy(fabricated["entries"][-1])
    entry["cursor"] += 1
    entry["event"]["type"] = "fabricated_mechanic"
    fabricated["entries"].append(entry)
    fabricated["expectedFinalCursor"] += 1
    final_record = fabricated["checkpoints"][-1]["checkpoint"]
    final_record["event_cursor"] += 1
    final_record["snapshot"]["event_cursor"] += 1
    fabricated["expectedTerminal"]["finalSnapshot"]["event_cursor"] += 1
    fabricated["expectedMarkers"] = [
        *sorted(
            [
                *(
                    marker
                    for marker in fabricated["expectedMarkers"]
                    if marker != "checkpoint:final"
                ),
                "event:fabricated_mechanic",
            ]
        ),
        "checkpoint:final",
    ]
    with pytest.raises(AssertionError):
        validate_manifest(fabricated)

    nonzero = deepcopy(manifest)
    nonzero["initialSnapshot"]["event_cursor"] = 5
    with pytest.raises(AssertionError):
        validate_manifest(nonzero)

    missing_terminal = deepcopy(manifest)
    del missing_terminal["expectedTerminal"]["finalSnapshot"]
    with pytest.raises(AssertionError):
        validate_manifest(missing_terminal)


def test_frozen_mechanic_contracts_have_independent_executable_oracles() -> None:
    """I2: C04-C12/C17 must freeze all required branches, not just labels."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}
    required = {
        "C04": {"local-proposal", "remote-proposal", "escrow", "birth-at-acceptor", "newborn"},
        "C05": {"reject", "invalidation", "timeout-refund", "cooldown", "population-cap"},
        "C06": {
            "component-build",
            "shelter-scale",
            "hearth",
            "pledge-leave",
            "vault",
            "owner-promotion",
            "hoard-transition",
        },
        "C07": {
            "partial-damage",
            "repair-pressure",
            "breach",
            "recipient-split",
            "standing-zero-integrity",
        },
        "C08": {
            "coordinated-damage",
            "breach",
            "ownership-transition",
            "stakeholder-replacement",
            "no-theft",
        },
        "C09": {
            "checkpoint-only-repair",
            "checkpoint-only-upkeep",
            "collapse",
            "zero-remnant",
            "nonzero-remnant",
            "scavenge",
            "silent-sweep",
        },
        "C10": {"nonlethal-hit", "paralysis", "rescue-order", "recovery", "exact-balances"},
        "C11": {"lethal-priority", "loot", "corpse", "terminal-death", "decay-removal"},
        "C12": {"travel", "social", "resources", "shelter", "birth", "rescue", "rare-drama"},
        "C17": {
            "look-around",
            "local-speech",
            "remote-whisper",
            "private-self-talk",
            "cost-validation",
            "attribution",
            "no-invented-delivery",
        },
    }
    for chronicle_id, labels in required.items():
        oracle = manifests[chronicle_id]["expectedTerminal"]["semanticOracle"]
        assert set(oracle["positive"]) == labels
        assert oracle["negative"]
        assert oracle["terminal"]

    c17_events = [entry["event"] for entry in manifests["C17"]["entries"]]
    assert any(event["type"] == "self_talk" and event["scope"] == "private" for event in c17_events)


def test_pressure_world_and_presentation_invariants_are_frozen() -> None:
    """I3: pressure manifests certify both volume and their operational invariants."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}
    c13 = manifests["C13"]
    assert c13["expectedTerminal"]["pressureInvariants"] == {
        "envelopes": 120,
        "pauseFreezesPresentation": True,
        "queueBounded": True,
        "safeCancellation": True,
        "chronologyDigestPreserved": True,
    }
    c16 = manifests["C16"]
    snapshot = c16["initialSnapshot"]
    assert len(snapshot["agents"]) == 256
    assert len(snapshot["homes"]) == 128
    assert c16["expectedTerminal"]["pressureInvariants"] == {
        "envelopes": 4096,
        "agents": 256,
        "homes": 128,
        "stablePlacement": True,
        "heapPlateau": True,
        "poolClosure": True,
        "disposalClosure": True,
    }


def test_producer_authors_exact_versioned_graph_lifecycle_oracles() -> None:
    """Graph ownership expectations come from producer truth, never raw capture."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}
    expected = {
        "C05": {"schema": 1, "actors": {"created": 4, "peak": 4}},
        "C09": {
            "schema": 1,
            "homes": {
                "created": 9,
                "peak": 3,
                "visibilitySegments": [
                    {"regionId": "nirvana", "homeIds": ["home_c09", "home_zero"]},
                    {"regionId": "warm_springs", "homeIds": ["home_repair"]},
                    {"regionId": "nirvana", "homeIds": ["home_c09", "home_zero"]},
                    {"regionId": "warm_springs", "homeIds": ["home_repair"]},
                    {"regionId": "nirvana", "homeIds": ["home_c09", "home_zero"]},
                    {"regionId": "warm_springs", "homeIds": ["home_repair"]},
                    {"regionId": "nirvana", "homeIds": []},
                ],
            },
        },
        "C11": {"schema": 1, "actors": {"created": 4, "peak": 4}},
        "C12": {"schema": 1, "homes": {"created": 1, "peak": 1}},
    }
    for chronicle_id, oracle in expected.items():
        assert manifests[chronicle_id]["expectedTerminal"]["graphLifecycleOracle"] == oracle
    for chronicle_id in set(EXPECTED_CHRONICLES) - set(expected):
        assert "graphLifecycleOracle" not in manifests[chronicle_id]["expectedTerminal"]

    wrong_schema = deepcopy(manifests["C05"])
    wrong_schema["expectedTerminal"]["graphLifecycleOracle"]["schema"] = 2
    with pytest.raises(AssertionError):
        validate_manifest(wrong_schema)

    capture_derived_count = deepcopy(manifests["C11"])
    capture_derived_count["expectedTerminal"]["graphLifecycleOracle"]["actors"]["created"] = 3
    with pytest.raises(AssertionError):
        validate_manifest(capture_derived_count)


def test_c16_retains_repeated_safe_pressure_checkpoints() -> None:
    """C16 exposes exact recovery anchors throughout the 4,096-envelope stream."""
    c16 = next(manifest for manifest in build_manifests() if manifest["id"] == "C16")
    checkpoints = c16["checkpoints"]

    assert [record["checkpoint"]["event_cursor"] for record in checkpoints] == [
        1_024,
        2_048,
        3_072,
        4_096,
    ]
    assert all(record["safety"] == "safe-world-tick" for record in checkpoints)
    assert all(len(record["checkpoint"]["snapshot"]["agents"]) == 256 for record in checkpoints)
    assert all(len(record["checkpoint"]["snapshot"]["homes"]) == 128 for record in checkpoints)


def test_manifest_oracle_rejects_identity_chronology_and_semantic_drift() -> None:
    """I4: validation must independently reject malformed identity and chronology."""
    manifest = next(item for item in build_manifests() if item["id"] == "C12")
    mutations = []

    wrong_slug = deepcopy(manifest)
    wrong_slug["slug"] = "wrong"
    mutations.append(wrong_slug)

    wrong_seed = deepcopy(manifest)
    wrong_seed["seed"] += 1
    mutations.append(wrong_seed)

    duplicate_line = deepcopy(manifest)
    duplicate_line["checkpoints"].append(deepcopy(duplicate_line["checkpoints"][0]))
    mutations.append(duplicate_line)

    future_cursor = deepcopy(manifest)
    future_cursor["checkpoints"][0]["checkpoint"]["event_cursor"] = (
        manifest["expectedFinalCursor"] + 1
    )
    future_cursor["checkpoints"][0]["checkpoint"]["snapshot"]["event_cursor"] = (
        manifest["expectedFinalCursor"] + 1
    )
    mutations.append(future_cursor)

    wrong_terminal = deepcopy(manifest)
    wrong_terminal["expectedTerminal"]["finalSnapshot"]["event_cursor"] -= 1
    mutations.append(wrong_terminal)

    missing_semantic = deepcopy(manifest)
    missing_semantic["expectedTerminal"]["semanticOracle"]["positive"].pop()
    mutations.append(missing_semantic)

    for drifted in mutations:
        with pytest.raises(AssertionError):
            validate_manifest(drifted)


@pytest.mark.parametrize(
    ("reason", "safety"),
    [
        ("world_tick", "archive-manual"),
        ("event:speak", "safe-world-tick"),
        ("manual_capture", "archive-event"),
    ],
)
def test_manifest_oracle_rejects_checkpoint_reason_safety_disagreement(
    reason: str,
    safety: str,
) -> None:
    """Checkpoint safety must be the exact production classification of its reason."""
    manifest = deepcopy(next(item for item in build_manifests() if item["id"] == "C12"))
    final_record = manifest["checkpoints"][-1]
    final_record["checkpoint"]["reason"] = reason
    final_record["safety"] = safety

    with pytest.raises(AssertionError):
        validate_manifest(manifest)


def test_producer_authors_checkpoint_reason_safety_agreement() -> None:
    """Every generated checkpoint must enter the same class production will derive."""

    def classify(reason: str) -> str:
        if reason == "world_tick":
            return "safe-world-tick"
        if reason.startswith("event:"):
            return "archive-event"
        return "archive-manual"

    manifests = build_manifests()
    records = [record for manifest in manifests for record in manifest["checkpoints"]]
    # Re-baselined 30 -> 39 (2026-07-31). These counts are a deliberate corpus guard:
    # they must break whenever a Chronicle is added, so that its checkpoints are
    # classified on purpose rather than by accident. The previous 30/29/1 was correct
    # for the C00-C17 era; C18 (grand tour) and C19 (two beings) were added afterwards,
    # while this test was already red for an unrelated reason (the region_pressure
    # oracle drift), so nobody could see the guard fire. Measured split now:
    #   C00-C17 -> 30 records (29 safe-world-tick + 1 archive-manual)  [unchanged]
    #   C18     ->  4 records (all safe-world-tick)
    #   C19     ->  5 records (all safe-world-tick)
    assert len(records) == 39
    assert sum(record["safety"] == "safe-world-tick" for record in records) == 38
    assert sum(record["safety"] == "archive-manual" for record in records) == 1
    for manifest in manifests:
        for record in manifest["checkpoints"]:
            assert record["safety"] == classify(record["checkpoint"]["reason"])
    c15 = next(manifest for manifest in manifests if manifest["id"] == "C15")
    assert c15["checkpoints"][-1]["checkpoint"]["reason"] != "world_tick"
    assert c15["checkpoints"][-1]["safety"] == "archive-manual"


def test_pressure_and_fault_records_are_explicitly_labeled_without_fake_mechanics() -> None:
    """Presentation-only records are labeled and never masquerade as mechanic events."""
    manifests = {manifest["id"]: manifest for manifest in build_manifests()}
    assert len(manifests["C13"]["entries"]) == 120
    assert len(manifests["C16"]["entries"]) == 4096
    for chronicle_id in ("C12", "C13", "C14", "C15", "C16"):
        terminal = manifests[chronicle_id]["expectedTerminal"]
        assert terminal["fixtureAuthorship"]["labeled"] is True
        assert terminal["fixtureAuthorship"]["mechanicEventsFabricated"] is False
    assert manifests["C14"]["entries"] == []
    assert manifests["C15"]["entries"] == []
    assert manifests["C00"]["expectedTerminal"]["presentationAuthority"] == {
        "kind": "silent-checkpoint",
        "terminal": {
            "cursor": 0,
            "runId": "mock-c00-v1",
            "source": "live",
            "sourceKey": "live:mock-c00-v1",
        },
    }
    assert manifests["C14"]["expectedTerminal"]["presentationAuthority"] == {
        "kind": "transport-recovery",
        "terminal": {
            "cursor": 0,
            "runId": "mock-c14-v1-replacement",
            "source": "live",
            "sourceKey": "live:mock-c14-v1-replacement",
        },
    }
    assert manifests["C15"]["expectedTerminal"]["presentationAuthority"] == {
        "kind": "archive-live-isolation",
        "terminal": {
            "cursor": 4,
            "runId": "mock-c15-v1",
            "source": "live",
            "sourceKey": "live:mock-c15-v1",
        },
    }


def test_canonical_json_and_non_writing_check(tmp_path: Path) -> None:
    """Rendered bytes are sorted/newline-stable and CLI --check never writes."""
    rendered = render_catalog(build_manifests())
    assert set(rendered) == {f"{cid}-{slug}.json" for cid, slug in EXPECTED_CHRONICLES.items()} | {
        "catalog.json"
    }
    for payload in rendered.values():
        assert payload.endswith(b"\n")
        parsed = json.loads(payload)
        assert payload == (json.dumps(parsed, indent=2, sort_keys=True) + "\n").encode()

    completed = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), "--check", "--output", str(tmp_path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert list(tmp_path.iterdir()) == []


def test_checked_in_data_matches_two_byte_identical_builds(tmp_path: Path) -> None:
    """Two isolated writes hash identically and checked-in data matches producer bytes."""
    one = tmp_path / "one"
    two = tmp_path / "two"
    for target in (one, two):
        subprocess.run(
            [sys.executable, str(BUILD_SCRIPT), "--output", str(target)],
            cwd=ROOT,
            check=True,
        )

    def hashes(root: Path) -> dict[str, str]:
        return {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.glob("*.json"))
        }

    assert hashes(one) == hashes(two)
    assert hashes(one) == hashes(DATA_DIR)

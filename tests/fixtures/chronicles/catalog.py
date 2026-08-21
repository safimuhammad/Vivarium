"""Frozen Chronicle and builtin-tool catalogs for Production 2D Task 3A."""

from __future__ import annotations

from types import MappingProxyType

CANONICAL_CHRONICLES = MappingProxyType(
    {
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
)

CANONICAL_TOOL_NAMES = frozenset(
    {
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
)

CANONICAL_EVENT_TYPES = frozenset(
    {
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
)

FROZEN_POSITIVE_ORACLES = MappingProxyType(
    {
        "C00": ("four-region-topology", "observer-checkpoint"),
        "C01": ("local-movement",),
        "C02": ("all-directed-edges", "forbidden-shortcut"),
        "C03": ("harvest", "transfer", "hoard-threshold"),
        "C04": ("local-proposal", "remote-proposal", "escrow", "birth-at-acceptor", "newborn"),
        "C05": ("reject", "invalidation", "timeout-refund", "cooldown", "population-cap"),
        "C06": (
            "component-build",
            "shelter-scale",
            "hearth",
            "pledge-leave",
            "vault",
            "owner-promotion",
            "hoard-transition",
        ),
        "C07": (
            "partial-damage",
            "repair-pressure",
            "breach",
            "recipient-split",
            "standing-zero-integrity",
        ),
        "C08": (
            "coordinated-damage",
            "breach",
            "ownership-transition",
            "stakeholder-replacement",
            "no-theft",
        ),
        "C09": (
            "checkpoint-only-repair",
            "checkpoint-only-upkeep",
            "collapse",
            "zero-remnant",
            "nonzero-remnant",
            "scavenge",
            "silent-sweep",
        ),
        "C10": ("nonlethal-hit", "paralysis", "rescue-order", "recovery", "exact-balances"),
        "C11": ("lethal-priority", "loot", "corpse", "terminal-death", "decay-removal"),
        "C12": ("travel", "social", "resources", "shelter", "birth", "rescue", "rare-drama"),
        "C13": ("120-envelopes", "pause", "bounded-queue", "safe-cancel", "chronology-digest"),
        "C14": ("gap", "reconnect", "snapshot-retry", "413", "replacement", "stale-reject"),
        "C15": ("observer-frame", "isolated-sessions", "bounded-live-ingestion"),
        "C16": ("4096-envelopes", "256-agents", "128-homes", "stable-placement", "closure"),
        "C17": (
            "look-around",
            "local-speech",
            "remote-whisper",
            "private-self-talk",
            "cost-validation",
            "attribution",
            "no-invented-delivery",
        ),
        "C18": (
            "gather-and-hoard",
            "court-three-branches-plus-invalidated",
            "home-lifecycle",
            "contest-thieve-then-colonize",
            "nonlethal-attack-then-rescue",
            "lethal-attack-then-decay",
            "collapse-then-scavenge",
            "closing-travel-and-privacy",
        ),
        "C19": (
            "solitary-gather-and-shared-hearth",
            "courtship-rejected-then-accepted",
            "theft-then-seizure",
            "violence-then-mercy",
            "death-decay-collapse-and-scavenge",
        ),
    }
)

FROZEN_GRAPH_LIFECYCLE_ORACLES = MappingProxyType(
    {
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
)

# Repeated event types normally collapse to one semantic evidence marker. Chronicles
# listed here require occurrence-level evidence, so every matching entry is bound to
# its immutable manifest cursor instead.
OCCURRENCE_QUALIFIED_EVENT_MARKERS = MappingProxyType(
    {
        "C09": frozenset({"home_collapsed", "ruins_scavenged"}),
        "C18": frozenset({"home_breached", "home_collapsed", "mating_initiated"}),
        "C19": frozenset({"mating_initiated", "home_breached", "resource_transferred"}),
    }
)

__all__ = [
    "CANONICAL_CHRONICLES",
    "CANONICAL_EVENT_TYPES",
    "CANONICAL_TOOL_NAMES",
    "FROZEN_GRAPH_LIFECYCLE_ORACLES",
    "FROZEN_POSITIVE_ORACLES",
    "OCCURRENCE_QUALIFIED_EVENT_MARKERS",
]

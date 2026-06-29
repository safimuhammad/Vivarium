"""Single source of truth for Vivarium world-rule constants.

These numbers are the "Game-of-Life rules" of the simulation (see ``CLAUDE.md``
Section 1 and ``autonomous-agent-world-design.md`` -> "World Rules"). They are
centralized here so they can be tuned, tested, and reasoned about in one place;
later phases import from this module instead of redefining magic numbers in tool
files.

Provenance is noted on every constant:

* ``[code]``  -- the value currently lives in tool source and is extracted here
  verbatim so behaviour is preserved when the tools start importing it.
* ``[doc]``   -- the value is specified in the design doc's "World Rules" table
  but is **not yet enforced in code**. It is recorded here for the phase that
  implements the rule; flagged inline where the current code diverges.

DIVERGENCES (history; items 1 and 2 were reconciled in Sprint 4 Phase 2):

1. Move energy cost: RECONCILED (S4 P2) -- ``tools/builtin/movement.py`` now
   deducts 5.0 energy on a successful ``move``.
2. Paralysis threshold: RECONCILED (S4 P2) -- ``WorldState.modify_agent_energy``
   now paralyses at ``energy <= 5.0`` (inclusive) and revives above it. Death
   (the kill-threshold) is still deferred to Sprint 6.
3. Mating minimums / cooldown / max-offspring: doc-specified but unenforced in
   the current mating tool.
4. Mating child share: the doc says "child receives 80% of combined
   contributions". The code computes the offspring's resources as the
   *initiator's* committed amount * 1.6. Because ``accept_mating`` forces the
   acceptor to commit the *same* resources as the proposal, combined = 2x and
   0.8 * 2 = 1.6, so the code is numerically equivalent to the doc rule *given
   equal contributions*. Both forms are exposed below
   (:data:`MATING_CHILD_SHARE` = the doc semantic, :data:`MATING_OFFSPRING_MULTIPLIER`
   = the derived per-contributor factor the code uses).
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from memory.models import Importance

# ---------------------------------------------------------------------------
# Action energy costs
# ---------------------------------------------------------------------------

GENERIC_ACTION_ENERGY_COST: Final[float] = 1.0
"""Energy cost of a generic action. [doc] (not yet charged in code)."""

MOVE_ENERGY_COST: Final[float] = 5.0
"""Energy cost to move between regions. [doc].

Enforced as of Sprint 4 Phase 2: ``movement.py`` deducts this on a successful
``move`` (after validating existence, adjacency and sufficient energy).
"""

SPEAK_ENERGY_COST: Final[float] = 0.5
"""Energy cost to speak. [code: communication.py ``modify_agent_energy(-0.5)``]
and [doc] (both agree)."""

ATTACK_ENERGY_COST: Final[float] = 10.0
"""Energy the attacker spends per attack. [code: combat.py ``ATTACK_ENERGY``]
and [doc] (both agree)."""

# ---------------------------------------------------------------------------
# Combat
# ---------------------------------------------------------------------------

ATTACK_DAMAGE: Final[float] = 30.0
"""Energy drained from the target per attack. [code: combat.py
``ATTACK_DAMAGE``] and [doc] (both agree)."""

KILL_ENERGY_THRESHOLD: Final[float] = 0.0
"""At or below this energy an agent dies. [doc].

DIVERGENCE: no death logic exists in the current code.
"""

PARALYSIS_ENERGY_THRESHOLD: Final[float] = 5.0
"""At or below this energy an agent is paralysed. [doc].

Enforced as of Sprint 4 Phase 2: ``WorldState.modify_agent_energy`` paralyses an
ALIVE agent at ``energy <= 5.0`` (inclusive, including 0.0) and revives a
PARALYZED agent only when ``energy > 5.0``; a DEAD agent is left untouched.
"""

# ---------------------------------------------------------------------------
# Mating
# ---------------------------------------------------------------------------

MATING_MIN_ENERGY_CONTRIBUTION: Final[float] = 50.0
"""Minimum energy a parent must commit to a mating proposal. [doc]
(not yet enforced in code)."""

MATING_MIN_MATERIALS_CONTRIBUTION: Final[float] = 30.0
"""Minimum materials a parent must commit to a mating proposal. [doc]
(not yet enforced in code)."""

MATING_COOLDOWN_SECONDS: Final[float] = 300.0
"""Cooldown between matings for an agent, in seconds (5 minutes). [doc]
(not yet enforced in code)."""

MATING_PROPOSAL_TIMEOUT_SECONDS: Final[float] = 60.0
"""How long a mating proposal's escrow may sit unanswered before the world-tick
refunds the initiator and removes it, in seconds. [design -- Sprint 4 Phase 2].

DISTINCT from :data:`MATING_COOLDOWN_SECONDS` (the gap *between* matings): this is
the lifetime of a single outstanding proposal. Not part of the design doc's
"World Rules" table; introduced for the proposal-timeout sweep on the Revisit List
(see the Sprint-4 design spec Section 4.7). Chosen shorter than the cooldown so
escrowed resources are returned promptly rather than locked indefinitely.
"""

MATING_MAX_OFFSPRING: Final[int] = 5
"""Maximum offspring a single agent may produce. [doc]
(not yet enforced in code)."""

MATING_CHILD_SHARE: Final[float] = 0.8
"""Fraction of the *combined* parental contribution the child receives. [doc].

See :data:`MATING_OFFSPRING_MULTIPLIER` for the equivalent per-contributor
factor the code currently applies.
"""

MATING_OFFSPRING_MULTIPLIER: Final[float] = 1.6
"""Per-contributor multiplier the code applies to mint offspring resources.
[code: mating.py ``* 1.6``].

Equals ``MATING_CHILD_SHARE * 2`` and is numerically equivalent to the doc rule
when both parents commit equal contributions (which ``accept_mating`` enforces).
"""

AGENT_ID_CATEGORIES: Final[tuple[str, ...]] = (
    "wanderer",
    "fighter",
    "hoarder",
    "womenizer",
    "wisdom",
    "explorer",
)
"""Category prefixes used to mint offspring agent IDs. [code: mating.py
``AGENT_ID_CAT``]. Stored as a tuple to keep this module-level constant
immutable; selection should go through the injected RNG (``world.rng``)."""

# ---------------------------------------------------------------------------
# Movement timing
# ---------------------------------------------------------------------------

MOVE_DURATION_SECONDS: Final[float] = 2.0
"""Wall-clock time a move takes. [doc] (not yet enforced in code)."""

# ---------------------------------------------------------------------------
# Runtime timing
# ---------------------------------------------------------------------------

DECIDE_BACKOFF_SECONDS: Final[float] = 1.0
"""Minimum pause after a failed ``decide`` so a downed model cannot busy-loop.

Applied (as the floor of the inter-breath sleep) only when a breath's decision
could not be produced; a healthy loop sleeps for its ``Agent.pace`` instead.
[code: agents/runtime.py]"""

# ---------------------------------------------------------------------------
# Hoarding thresholds
# ---------------------------------------------------------------------------

HOARDING_ENERGY_THRESHOLD: Final[float] = 500.0
"""Energy above which an agent is considered to be hoarding. [doc]
(not yet enforced in code)."""

HOARDING_MATERIALS_THRESHOLD: Final[float] = 300.0
"""Materials above which an agent is considered to be hoarding. [doc]
(not yet enforced in code)."""

# ---------------------------------------------------------------------------
# Memory subsystem (Sprint 5)
# [design: docs/superpowers/specs/2026-06-28-sprint5-memory-design.md §7]
#
# These are the memory "dials" -- Game-of-Life rules for an agent's cognition.
# They are first-guess values meant to be TUNED by the benchmark/optimization
# pass (plan Tasks 12-13), not gospel. Provenance: [design] (this spec).
# ---------------------------------------------------------------------------

REFLECT_EVERY_N_BREATHS: Final[int] = 12
"""Reflection cadence: a dedicated reflection step runs every N breaths. [design].

The write path (the qwen3:8b spike showed in-loop authoring fails; isolated
reflection works). Larger N = cheaper (one extra inference + one KV re-prefill
per reflection) but slower-forming memory.
"""

REFLECT_RECAP_TURNS: Final[int] = 6
"""How many recent lifecycle turns the reflection step is shown as a recap. [design]."""

RETRIEVAL_K: Final[int] = 5
"""Number of memories surfaced into the perception turn per breath. [design]."""

RETRIEVAL_RESERVED_SLOTS: Final[int] = 1
"""Slots (of RETRIEVAL_K) reserved for the most-important memories. [tuned: T13].

Guarantees a biographically salient memory (a grudge, a bond) surfaces even when
many recent + semantically-similar memories would otherwise crowd it out of the
top-k. Benchmark (2026-06-28) showed equal-weight scoring buried such a memory; a
reserved slot fixes it robustly, independent of how many distractors exist.
"""

MEMORY_RESIDENT_CAP: Final[int] = 400
"""Max memories kept in the always-resident memory block. [design: Sprint 5.1].

Under the cap the WHOLE memory is in context (nothing can be missed); over it, all
HIGH-importance memories are always kept and the remaining slots filled by salience,
with the overflow reachable on demand via the ``recall`` tool. ~1 memory per line.
"""

RECALL_K: Final[int] = 5
"""Memories returned by an agent-initiated ``recall`` search (overflow access). [design: 5.1]."""

RECALL_W_RELEVANCE: Final[float] = 1.0
"""Recall weights relevance dominantly: a ``recall`` is a search, so the query match
leads, unlike the resident block's equal-weight full-salience scoring. [design: 5.1]."""

RECALL_W_RECENCY: Final[float] = 0.15
"""Light recency tiebreak between similarly-relevant recalled memories. [design: 5.1]."""

RECALL_W_IMPORTANCE: Final[float] = 0.15
"""Light importance tiebreak between similarly-relevant recalled memories. [design: 5.1]."""

RECENCY_DECAY: Final[float] = 0.97
"""Per-breath exponential decay base for the recency term (subjective time). [design].

``recency = RECENCY_DECAY ** (current_breath - created_breath)``; over 12 breaths
~0.69, over 50 ~0.22. Higher = memories stay 'fresh' longer.
"""

W_RECENCY: Final[float] = 1.0
"""Scorer weight on the recency term (equal-weight start, per Generative Agents). [design]."""

W_IMPORTANCE: Final[float] = 1.0
"""Scorer weight on the importance term -- the salience RAG cannot supply. [design]."""

W_RELEVANCE: Final[float] = 1.0
"""Scorer weight on the relevance (vector-similarity) term. [design]."""

IMPORTANCE_WEIGHTS: Final[dict[Importance, float]] = {
    Importance.LOW: 0.3,
    Importance.MEDIUM: 0.6,
    Importance.HIGH: 1.0,
}
"""Numeric weight per agent-assigned importance level. [design]."""

EMBED_MODEL: Final[str] = "all-MiniLM-L6-v2"
"""Local sentence-transformer ChromaDB uses in production. [design].

Deliberately a CPU/onnx model, NOT an Ollama embed model, so embedding never
contends with the agent decider on Ollama's sequential backend.
"""

MEMORY_ROOT: Final[Path] = Path("./memory")
"""Default root directory under which per-agent memory dirs are created. [design]."""

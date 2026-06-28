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

from typing import Final

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
# Hoarding thresholds
# ---------------------------------------------------------------------------

HOARDING_ENERGY_THRESHOLD: Final[float] = 500.0
"""Energy above which an agent is considered to be hoarding. [doc]
(not yet enforced in code)."""

HOARDING_MATERIALS_THRESHOLD: Final[float] = 300.0
"""Materials above which an agent is considered to be hoarding. [doc]
(not yet enforced in code)."""

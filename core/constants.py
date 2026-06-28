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

DIVERGENCES flagged below (recorded, intentionally NOT fixed in Phase 1 -- this
module only centralizes values; Phase 2/3 reconcile code with these constants):

1. Move energy cost: the design doc charges 5.0 energy per move, but
   ``tools/builtin/movement.py`` currently deducts **no** energy on ``move``.
2. Paralysis threshold: the doc paralyses at <= 5.0 energy, but
   ``WorldState.modify_agent_energy`` only sets ``PARALYZED`` at exactly 0.0
   energy, and there is no death (kill-threshold) logic at all.
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

DIVERGENCE: ``movement.py`` currently deducts no energy on ``move``.
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

DIVERGENCE: ``WorldState.modify_agent_energy`` only paralyses at exactly 0.0.
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

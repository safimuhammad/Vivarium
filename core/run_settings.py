"""Per-run world rules: the values a run may vary, and the ones it must DERIVE.

:mod:`core.constants` is the single home for world rules -- the constants that decide
whether the piece is alive or a still life. A few of them, however, are not really
constants at all: they depend on *how this particular run is wired*, and pinning them
to one module-level number has already shipped a silent defect.

This module holds that small, explicit set as one frozen :class:`RunSettings` bundle
carried by the world. **Its defaults are exactly the module constants**, so a world
built without one behaves byte-identically to every run before this module existed.

The load-bearing member is ``mating_proposal_timeout_seconds``. It must outlast the
*target's* breath interval, or a proposal expires before its target ever perceives it
and **reproduction silently never completes** -- the exact bug that shipped and went
undetected across every live run (see
:data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS` for the 60s -> 600s -> 45s
history). The breath interval depends on the decider: the hosted path breathes every
agent concurrently, while the local path serves inference serially so a target breathes
only every ``N * latency`` seconds. A configuration screen therefore must **never**
accept this value -- it derives it from ``(provider, being count)`` via
:func:`derive_mating_proposal_timeout`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

from core.constants import (
    MATING_MAX_OFFSPRING,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
    REFLECT_EVERY_N_BREATHS,
)

__all__ = [
    "DEFAULT_RUN_SETTINGS",
    "GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS",
    "MATING_TIMEOUT_TARGET_BREATHS",
    "OLLAMA_BREATH_LATENCY_SECONDS",
    "OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS",
    "RunSettings",
    "derive_mating_proposal_timeout",
    "derive_run_settings",
]

GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS: Final[float] = 45.0
"""Proposal lifetime on the hosted (concurrent) path, in seconds.

Flat, deliberately independent of the being count: every agent breathes in parallel
every ~1-3s, so 45s spans ~15-45 target breaths whatever the roster size. Equal to
:data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS` by design -- the hosted path is
the tuned one, so deriving it must reproduce today's number exactly.
"""

OLLAMA_BREATH_LATENCY_SECONDS: Final[float] = 30.0
"""Measured per-decision latency of one local (Ollama) decide, in seconds.

Only meaningful on the serialized path, where one shared model serves every agent in
turn: with ``N`` beings a given target therefore breathes roughly every
``N * OLLAMA_BREATH_LATENCY_SECONDS`` seconds.
"""

MATING_TIMEOUT_TARGET_BREATHS: Final[float] = 5.0
"""How many of the *target's* breaths a proposal must survive before it is swept.

One breath is not enough: the target must both perceive the offer and choose to answer
it, and a paralyzed or reflecting breath spends no decision on it at all.
"""

OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS: Final[float] = 600.0
"""Lowest proposal lifetime ever observed to work on the serialized local path.

The F4 run measured per-agent breath gaps of ~150-600s at the four-being roster and
*needed* this value; the previous 60s window timed out 7/7 proposals before the target
ever breathed. Both the floor and the ``30 * 4 * 5`` scaling formula meet here, so the
historical roster derives exactly 600s.
"""


@dataclass(frozen=True, slots=True)
class RunSettings:
    """World rules that vary per run rather than per repository.

    Carried by :class:`~world.world.WorldState` so the tick sweep, the mating tools,
    and the agent runtime read one run-scoped value instead of a module constant.

    Attributes:
        mating_proposal_timeout_seconds: Lifetime of one outstanding mating proposal.
            **Derived**, never configured -- see :func:`derive_mating_proposal_timeout`.
        mating_max_offspring: Per-being offspring ceiling (the population cap).
        reflect_every_n_breaths: How often a being pauses to reflect and may rewrite
            its own identity.
    """

    mating_proposal_timeout_seconds: float = MATING_PROPOSAL_TIMEOUT_SECONDS
    mating_max_offspring: int = MATING_MAX_OFFSPRING
    reflect_every_n_breaths: int = REFLECT_EVERY_N_BREATHS


DEFAULT_RUN_SETTINGS: Final[RunSettings] = RunSettings()
"""The settings every world gets unless a run supplies its own (today's behaviour)."""


def derive_mating_proposal_timeout(provider: str, being_count: int) -> float:
    """Return the proposal lifetime this run needs, in seconds.

    Two regimes, because the breath cadence a proposal must outlast is a property of
    the decider, not of the world:

    * **Hosted / concurrent** (``"gemini"``): every agent breathes in parallel, so the
      tuned :data:`GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS` applies whatever the roster.
    * **Local / serialized** (``"ollama"``, and any unrecognised backend): one model
      serves every agent in turn, so a target breathes every
      ``being_count * OLLAMA_BREATH_LATENCY_SECONDS`` seconds. The proposal must span
      :data:`MATING_TIMEOUT_TARGET_BREATHS` of those, never dropping below the measured
      :data:`OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS`.

    An unknown provider is treated as serialized on purpose: a timeout that is too long
    merely delays an escrow refund, while one that is too short makes reproduction
    impossible without emitting a single symptom.

    Args:
        provider: Decider backend name (``"gemini"``, ``"ollama"``, ...).
        being_count: Number of beings that will breathe against that backend. Values
            below one are treated as one.

    Returns:
        The proposal lifetime in seconds.
    """
    if provider == "gemini":
        return GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS
    beings = max(1, being_count)
    scaled = OLLAMA_BREATH_LATENCY_SECONDS * beings * MATING_TIMEOUT_TARGET_BREATHS
    return float(max(OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS, math.ceil(scaled)))


def derive_run_settings(
    *,
    provider: str,
    being_count: int,
    max_offspring: int,
    reflect_every_n_breaths: int,
) -> RunSettings:
    """Bundle the configured knobs with the value the server must derive for them.

    Args:
        provider: Decider backend the run will use.
        being_count: Number of beings the run starts with.
        max_offspring: Configured per-being offspring ceiling.
        reflect_every_n_breaths: Configured reflection cadence.

    Returns:
        The :class:`RunSettings` the run's world should carry.
    """
    return RunSettings(
        mating_proposal_timeout_seconds=derive_mating_proposal_timeout(provider, being_count),
        mating_max_offspring=max_offspring,
        reflect_every_n_breaths=reflect_every_n_breaths,
    )

"""Determinism seam: a seedable RNG and an injectable clock.

Reproducibility serves perception (replay striking runs) and the optional
research path (see ``CLAUDE.md`` Section 4). To get there, *all* randomness must
flow through an injected :class:`random.Random` and *all* time-dependent logic
through an injected clock, instead of the global ``random`` module or
``time.time`` directly.

This module provides the small building blocks:

* :func:`make_rng` -- build a seeded (or unseeded) :class:`random.Random`.
* :func:`default_clock` -- the wall-clock default (``time.time``-equivalent).
* :class:`SimContext` -- an optional dataclass bundling ``rng`` + ``clock`` with
  a :meth:`SimContext.now` helper, plus :func:`make_context` to build one.

Phase 2 wires this into :class:`~world.world.WorldState` (which will hold ``rng``
and ``clock`` and expose ``now()``); the loader will accept an optional ``seed``.
Phase 2 may consume either the raw ``rng``/``clock`` or a ``SimContext`` -- both
are provided so the world refactor can pick whichever reads cleanly.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field

Clock = Callable[[], float]
"""Type alias for a clock: a zero-argument callable returning seconds as float."""


def make_rng(seed: int | None = None) -> random.Random:
    """Build a seeded pseudo-random generator.

    Args:
        seed: Seed for reproducibility. ``None`` yields a non-deterministic
            generator (seeded from OS entropy), matching the default behaviour
            of :class:`random.Random`.

    Returns:
        A fresh :class:`random.Random` instance. Pass this object explicitly to
        any code that needs randomness; never use the global ``random`` module.
    """
    return random.Random(seed)


def default_clock() -> float:
    """Return the current wall-clock time in seconds since the epoch.

    The injectable default clock. Tests substitute a fixed/fake clock so event
    timestamps and any time-dependent logic are deterministic.

    Returns:
        Seconds since the Unix epoch, as returned by :func:`time.time`.
    """
    return time.time()


@dataclass(slots=True)
class SimContext:
    """Bundle of the determinism dependencies: an RNG and a clock.

    A small convenience for passing the determinism seam around as one object.
    Holding both together keeps "everything that makes a run reproducible" in a
    single place that can be threaded through the world and tools.

    Attributes:
        rng: The seedable random generator all randomness must route through.
        clock: Zero-argument callable returning the current time in seconds.
            Defaults to :func:`default_clock` (wall clock).
    """

    rng: random.Random
    clock: Clock = field(default=default_clock)

    def now(self) -> float:
        """Return the current time from the bundled clock.

        Returns:
            The current time in seconds, per :attr:`clock`.
        """
        return self.clock()


def make_context(seed: int | None = None, clock: Clock | None = None) -> SimContext:
    """Build a :class:`SimContext` from a seed and optional clock.

    Args:
        seed: Seed forwarded to :func:`make_rng`. ``None`` is non-deterministic.
        clock: Clock to use. ``None`` falls back to :func:`default_clock`.

    Returns:
        A :class:`SimContext` carrying a freshly seeded RNG and the chosen clock.
    """
    return SimContext(rng=make_rng(seed), clock=clock if clock is not None else default_clock)

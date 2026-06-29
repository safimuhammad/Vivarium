"""Shared cross-cutting contracts for Vivarium.

This package holds the foundation pieces that every other package depends on:

* :mod:`core.exceptions` -- the typed exception hierarchy used for
  infrastructure-level failures (registry, bus, loader, runtime).
* :mod:`core.constants` -- the single home for all world-rule constants
  (action costs, combat/mating numbers, hoarding thresholds).
* :mod:`core.logging` -- stdlib-``logging`` configuration helpers.
* :mod:`core.rng` -- the determinism seam: a seedable RNG plus an injectable
  clock, optionally bundled in a :class:`~core.rng.SimContext`.

Nothing in this package may import from ``world``, ``bus``, ``tools`` or
``config`` -- ``core`` sits at the bottom of the dependency graph.
"""

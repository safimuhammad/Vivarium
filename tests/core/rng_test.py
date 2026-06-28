"""Smoke tests for the :mod:`core.rng` determinism seam."""

from __future__ import annotations

from core.rng import SimContext, default_clock, make_context, make_rng


def test_same_seed_same_sequence() -> None:
    """Two RNGs built from the same seed produce identical sequences."""
    a = make_rng(42)
    b = make_rng(42)
    assert [a.random() for _ in range(5)] == [b.random() for _ in range(5)]


def test_different_seeds_differ() -> None:
    """Different seeds (very likely) produce different sequences."""
    assert make_rng(1).random() != make_rng(2).random()


def test_none_seed_is_usable() -> None:
    """An unseeded RNG still yields a float in [0, 1)."""
    value = make_rng(None).random()
    assert 0.0 <= value < 1.0


def test_sim_context_now_uses_clock() -> None:
    """``SimContext.now`` returns whatever the injected clock returns."""
    ctx = SimContext(rng=make_rng(0), clock=lambda: 123.5)
    assert ctx.now() == 123.5


def test_sim_context_default_clock_is_wall_clock() -> None:
    """The default clock is the wall clock and returns a positive time."""
    ctx = SimContext(rng=make_rng(0))
    assert ctx.clock is default_clock
    assert ctx.now() > 0.0


def test_make_context_is_seeded() -> None:
    """``make_context`` seeds the RNG so contexts are reproducible."""
    one = make_context(seed=7)
    two = make_context(seed=7)
    assert one.rng.random() == two.rng.random()

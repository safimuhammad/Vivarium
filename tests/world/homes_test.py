"""Tests for the :class:`world.homes.Home` domain record."""

from __future__ import annotations

import pytest

from core.constants import HOARDING_MATERIALS_THRESHOLD, HOME_HEALTH_BASE, HOME_HEALTH_CEIL
from world.homes import Home, home_is_hoarding, max_integrity


def test_home_is_constructible_and_mutable() -> None:
    """A Home holds its fields and is mutable in place (a hot-path record, not frozen)."""
    home = Home(
        home_id="home_1",
        owner_id="wanderer_001",
        region="alpha",
        integrity=100.0,
        built_at=1000.0,
        last_upkeep_at=1000.0,
    )
    assert home.home_id == "home_1"
    assert home.owner_id == "wanderer_001"
    assert home.region == "alpha"
    assert home.integrity == 100.0
    assert home.built_at == 1000.0
    assert home.last_upkeep_at == 1000.0
    # Forward-compatible with L2 colonize: owner reassignment is one field write.
    home.owner_id = "wanderer_002"
    home.integrity = 55.0
    assert home.owner_id == "wanderer_002"
    assert home.integrity == 55.0


def test_home_uses_slots() -> None:
    """slots=True: no per-instance __dict__ (small memory/access win, like the peers)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")


def test_home_has_stakeholders_defaulting_empty() -> None:
    """A Home carries a mutable stakeholders list, defaulting empty (invariant is the world's)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.stakeholders == []
    home.stakeholders.append("wanderer_002")
    assert home.stakeholders == ["wanderer_002"]


def test_home_still_uses_slots_with_stakeholders() -> None:
    """slots=True holds after adding the list field (no per-instance __dict__)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")


def test_max_integrity_scales_with_stakeholders_and_is_capped() -> None:
    """M(s) matches the governing formula for s=1..cap and never reaches the ceiling."""
    assert max_integrity(1) == HOME_HEALTH_BASE  # a lone home == the L1 home (100)
    assert max_integrity(2) == 150.0
    assert max_integrity(3) == 175.0
    assert max_integrity(4) == pytest.approx(187.5)
    # Degenerate/empty guard: never a 0-cap, never below base.
    assert max_integrity(0) == HOME_HEALTH_BASE
    # Strictly increasing but always below the anti-blob ceiling — forever.
    assert HOME_HEALTH_BASE < max_integrity(2) < max_integrity(3) < HOME_HEALTH_CEIL
    assert max_integrity(50) < HOME_HEALTH_CEIL


def test_home_has_vault_defaulting_zero() -> None:
    """A Home carries a materials-only vault balance, defaulting to 0.0."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.vault_materials == 0.0
    home.vault_materials += 25.0
    assert home.vault_materials == 25.0


def test_home_still_uses_slots_with_vault() -> None:
    """slots=True holds after adding the vault field (no per-instance __dict__)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")


def test_home_is_hoarding_below_threshold_is_false() -> None:
    """A vault below the materials threshold is not a hoard."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD - 0.01
    assert home_is_hoarding(home) is False


def test_home_is_hoarding_at_threshold_is_true() -> None:
    """At exactly the threshold the home counts as hoarding (>=, inclusive)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD
    assert home_is_hoarding(home) is True


def test_home_is_hoarding_above_threshold_is_true() -> None:
    """A vault above the threshold is a hoard."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD + 50.0
    assert home_is_hoarding(home) is True


def test_home_has_last_integrity_at_defaulting_zero() -> None:
    """A Home carries last_integrity_at (the incremental repair/decay clock), defaulting 0.0."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.last_integrity_at == 0.0
    home.last_integrity_at = 42.0
    assert home.last_integrity_at == 42.0


def test_home_still_uses_slots_with_last_integrity_at() -> None:
    """slots=True holds after adding last_integrity_at (no per-instance __dict__)."""
    assert not hasattr(Home("h", "o", "r", 1.0, 2.0, 3.0), "__dict__")

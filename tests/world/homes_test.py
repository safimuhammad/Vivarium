"""Tests for the :class:`world.homes.Home` domain record."""

from __future__ import annotations

from world.homes import Home


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

"""Tests for :mod:`world.regions` -- the :class:`Region` dataclass and enum.

Characterizes the region domain model: ``ResourceTypes`` enum membership/values,
``slots=True`` (no per-instance ``__dict__``), and the intentional *mutability*
of the hot-path dataclass (deliberately NOT frozen -- see ``CLAUDE.md`` Section 3).
"""

from __future__ import annotations

import dataclasses

import pytest

from world.regions import Region, ResourceTypes


def make_region() -> Region:
    """Build a representative region for the tests in this module."""
    return Region(
        name="alpha",
        description="A modest meadow.",
        connections=["beta"],
        energy_rate=1.0,
        materials_rate=1.0,
        current_energy=100.0,
        current_materials=100.0,
        max_energy=500.0,
        max_materials=500.0,
    )


def test_resource_types_values() -> None:
    """``ResourceTypes`` members map to their lowercase string values."""
    assert ResourceTypes.ENERGY.value == "energy"
    assert ResourceTypes.MATERIALS.value == "materials"


def test_resource_types_lookup_by_value() -> None:
    """``ResourceTypes(value)`` resolves to the matching member."""
    assert ResourceTypes("energy") is ResourceTypes.ENERGY
    assert ResourceTypes("materials") is ResourceTypes.MATERIALS


def test_region_fields_assigned() -> None:
    """All constructor fields are stored on the instance."""
    region = make_region()
    assert region.name == "alpha"
    assert region.description == "A modest meadow."
    assert region.connections == ["beta"]
    assert region.energy_rate == 1.0
    assert region.materials_rate == 1.0
    assert region.current_energy == 100.0
    assert region.current_materials == 100.0
    assert region.max_energy == 500.0
    assert region.max_materials == 500.0


def test_region_is_a_dataclass() -> None:
    """``Region`` is a stdlib dataclass."""
    assert dataclasses.is_dataclass(Region)


def test_region_uses_slots() -> None:
    """``slots=True`` -> instances expose ``__slots__`` and have no ``__dict__``."""
    region = make_region()
    assert hasattr(Region, "__slots__")
    assert not hasattr(region, "__dict__")


def test_region_is_mutable_not_frozen() -> None:
    """Hot-path dataclass is intentionally mutable (NOT frozen)."""
    region = make_region()
    region.current_energy = 250.0
    region.current_materials = 12.5
    assert region.current_energy == 250.0
    assert region.current_materials == 12.5


def test_region_slots_rejects_unknown_attribute() -> None:
    """With slots, assigning an undeclared attribute raises ``AttributeError``."""
    region = make_region()
    with pytest.raises(AttributeError):
        region.undeclared = "nope"  # type: ignore[attr-defined]

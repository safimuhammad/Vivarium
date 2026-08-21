"""Durable observer-only capacity pressure for one exact world region."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RegionPressureHighWater:
    """Historical occupancy maxima used to size a region's presentation.

    Attributes:
        region: Exact region name; no case folding or normalization is applied.
        population_high_water: Greatest observed non-dead population.
        built_footprint_high_water: Greatest observed home-plus-ruin footprint.
    """

    region: str
    population_high_water: int
    built_footprint_high_water: int

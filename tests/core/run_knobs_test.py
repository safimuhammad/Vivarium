"""The knob catalog's cost contract: one rate per place the minds can run.

Spec Section 3.2 knob 1 requires the being-count control to show a *live* cost
estimate. That is only possible if the rate is published **per provider**: one
figure hung on the roster knob cannot be multiplied by a roster without pricing
whichever place happens to be selected, including the free one.
"""

from __future__ import annotations

from typing import Any, cast

from core.run_knobs import (
    COST_ESTIMATE_CAVEAT,
    DURATION_OPTIONS,
    ESTIMATED_COST_PER_BEING_HOUR_USD,
    PROVIDER_OPTIONS,
    REFLECT_OPTIONS,
    run_knob_catalog,
)


def _provider_choices() -> list[dict[str, Any]]:
    """Return the provider knob's choices as published on the wire."""
    catalog = run_knob_catalog()
    provider = cast(dict[str, Any], catalog["provider"])
    return cast(list[dict[str, Any]], provider["choices"])


def _choice_by_value(value: str) -> dict[str, Any]:
    """Return one published provider choice by its submitted value."""
    return next(choice for choice in _provider_choices() if choice["value"] == value)


class TestProviderRates:
    """Every place the minds can run states its own cost and its own cadence."""

    def test_every_provider_option_publishes_a_rate_and_a_cadence(self) -> None:
        for option in PROVIDER_OPTIONS:
            assert isinstance(option.cost_per_being_hour_usd, float)
            assert option.cadence.strip() != ""

    def test_the_cloud_is_costed_and_fast(self) -> None:
        cloud = _choice_by_value("gemini")

        assert cloud["cost_per_being_hour_usd"] == ESTIMATED_COST_PER_BEING_HOUR_USD
        assert cloud["cost_per_being_hour_usd"] > 0.0
        assert "second" in cloud["cadence"]

    def test_this_machine_is_free_and_slow(self) -> None:
        local = _choice_by_value("ollama")

        assert local["cost_per_being_hour_usd"] == 0.0
        assert "minute" in local["cadence"]

    def test_the_roster_knob_still_carries_the_measured_figure(self) -> None:
        beings = cast(dict[str, Any], run_knob_catalog()["beings"])

        assert beings["estimated_cost_per_being_hour_usd"] == ESTIMATED_COST_PER_BEING_HOUR_USD

    def test_the_cloud_rate_matches_the_roster_knob_figure(self) -> None:
        # One measurement, published twice: the roster knob keeps it for anything
        # reading the old key, the provider option is what a total is computed from.
        beings = cast(dict[str, Any], run_knob_catalog()["beings"])

        assert (
            _choice_by_value("gemini")["cost_per_being_hour_usd"]
            == (beings["estimated_cost_per_being_hour_usd"])
        )


class TestNonProviderChoices:
    """A rate belongs only where it was measured."""

    def test_run_length_choices_carry_no_rate(self) -> None:
        for choice in DURATION_OPTIONS:
            assert "cost_per_being_hour_usd" not in choice.to_dict()

    def test_reflection_choices_carry_no_rate(self) -> None:
        for choice in REFLECT_OPTIONS:
            assert "cost_per_being_hour_usd" not in choice.to_dict()


class TestCostEstimateHonesty:
    """The estimate is published with the two reasons it is not a quote."""

    def test_the_catalog_publishes_a_caveat_beside_the_rate(self) -> None:
        beings = cast(dict[str, Any], run_knob_catalog()["beings"])

        assert beings["cost_estimate_note"] == COST_ESTIMATE_CAVEAT

    def test_the_caveat_says_it_is_indicative_rather_than_a_quote(self) -> None:
        assert "indicative" in COST_ESTIMATE_CAVEAT.lower()

    def test_the_caveat_says_a_long_run_costs_more_per_hour_than_a_short_one(self) -> None:
        # Measured: ~4,476 prompt tokens at a being's first breath, ~43,076 by its
        # eightieth. A flat per-hour figure understates a long run, so the screen
        # must say so rather than show a number that quietly lies.
        lowered = COST_ESTIMATE_CAVEAT.lower()

        assert "grows" in lowered
        assert "4,500" in COST_ESTIMATE_CAVEAT
        assert "43,000" in COST_ESTIMATE_CAVEAT

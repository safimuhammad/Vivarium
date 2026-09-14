"""Tests for the per-run world rules and the coupled values the server derives."""

from __future__ import annotations

import pytest

from core.constants import (
    MATING_MAX_OFFSPRING,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
    REFLECT_EVERY_N_BREATHS,
)
from core.run_settings import (
    DEFAULT_RUN_SETTINGS,
    GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS,
    OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS,
    RunSettings,
    derive_mating_proposal_timeout,
    derive_run_settings,
)


def test_default_run_settings_are_exactly_the_module_constants() -> None:
    """The default must be byte-identical to today's behaviour.

    Every existing world builds ``RunSettings()``; if these drifted from the
    constants the whole simulation would change silently.
    """
    assert RunSettings() == DEFAULT_RUN_SETTINGS
    assert DEFAULT_RUN_SETTINGS.mating_proposal_timeout_seconds == MATING_PROPOSAL_TIMEOUT_SECONDS
    assert DEFAULT_RUN_SETTINGS.mating_max_offspring == MATING_MAX_OFFSPRING
    assert DEFAULT_RUN_SETTINGS.reflect_every_n_breaths == REFLECT_EVERY_N_BREATHS


def test_run_settings_are_frozen() -> None:
    settings = RunSettings()
    with pytest.raises(AttributeError):
        settings.mating_max_offspring = 3  # type: ignore[misc]


def test_gemini_timeout_is_flat_and_matches_the_tuned_constant() -> None:
    """Concurrent path: every being breathes every ~1-3s, so count does not matter."""
    for count in (1, 4, 12):
        assert derive_mating_proposal_timeout("gemini", count) == (
            GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS
        )
    assert GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS == MATING_PROPOSAL_TIMEOUT_SECONDS


def test_ollama_timeout_reproduces_the_measured_600s_at_the_historical_roster() -> None:
    """The F4 run needed ~600s at four beings; a 60s window timed out 7/7 proposals."""
    assert derive_mating_proposal_timeout("ollama", 4) == (
        OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )


def test_ollama_timeout_scales_with_being_count_on_the_serialized_path() -> None:
    """One shared model serves inference serially: a target breathes every N * latency."""
    four = derive_mating_proposal_timeout("ollama", 4)
    eight = derive_mating_proposal_timeout("ollama", 8)
    twelve = derive_mating_proposal_timeout("ollama", 12)
    assert eight == pytest.approx(2 * four)
    assert twelve == pytest.approx(3 * four)


def test_ollama_timeout_never_drops_below_the_measured_floor() -> None:
    """A one-being run still gets the floor: a lower value has never been observed to work."""
    assert derive_mating_proposal_timeout("ollama", 1) == (
        OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )


def test_mlx_timeout_uses_the_existing_serialized_local_regime() -> None:
    """MLX shares the local serialized wrapper, so proposals get the same safe window."""
    assert derive_mating_proposal_timeout("mlx", 4) == (derive_mating_proposal_timeout("ollama", 4))


def test_unknown_provider_falls_back_to_the_conservative_serialized_value() -> None:
    """An unrecognised backend is assumed serialized: too long merely delays a refund."""
    assert derive_mating_proposal_timeout("something-new", 4) == (
        OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )


def test_being_count_below_one_is_treated_as_one() -> None:
    assert derive_mating_proposal_timeout("ollama", 0) == (
        OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )


def test_derive_run_settings_bundles_the_derivation_with_the_chosen_knobs() -> None:
    settings = derive_run_settings(
        provider="gemini",
        being_count=6,
        max_offspring=3,
        reflect_every_n_breaths=24,
    )
    assert settings.mating_proposal_timeout_seconds == GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS
    assert settings.mating_max_offspring == 3
    assert settings.reflect_every_n_breaths == 24


def test_derive_run_settings_on_the_local_path_scales_the_timeout() -> None:
    settings = derive_run_settings(
        provider="ollama",
        being_count=8,
        max_offspring=5,
        reflect_every_n_breaths=12,
    )
    assert settings.mating_proposal_timeout_seconds == pytest.approx(
        2 * OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )

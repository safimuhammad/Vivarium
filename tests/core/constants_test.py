"""Smoke tests for :mod:`core.constants`.

These lock the values extracted from the existing tool source so a later phase
cannot silently change behaviour when tools start importing them, and assert the
documented relationship between the two mating-share constants.
"""

from __future__ import annotations

from core import constants


def test_values_extracted_from_code_are_preserved() -> None:
    """Constants pulled from tool source keep their current values."""
    # combat.py
    assert constants.ATTACK_ENERGY_COST == 10.0
    assert constants.ATTACK_DAMAGE == 30.0
    # communication.py
    assert constants.SPEAK_ENERGY_COST == 0.5
    # mating.py
    assert constants.MATING_OFFSPRING_MULTIPLIER == 1.6
    assert constants.AGENT_ID_CATEGORIES == (
        "wanderer",
        "fighter",
        "hoarder",
        "womenizer",
        "wisdom",
        "explorer",
    )


def test_values_from_design_doc() -> None:
    """Doc-sourced world-rule numbers are recorded with the documented values."""
    assert constants.GENERIC_ACTION_ENERGY_COST == 1.0
    assert constants.MOVE_ENERGY_COST == 5.0
    assert constants.KILL_ENERGY_THRESHOLD == 0.0
    assert constants.PARALYSIS_ENERGY_THRESHOLD == 5.0
    assert constants.MATING_MIN_ENERGY_CONTRIBUTION == 50.0
    assert constants.MATING_MIN_MATERIALS_CONTRIBUTION == 30.0
    assert constants.MATING_COOLDOWN_SECONDS == 300.0
    assert constants.MATING_MAX_OFFSPRING == 5
    assert constants.MATING_CHILD_SHARE == 0.8
    assert constants.MOVE_DURATION_SECONDS == 2.0
    assert constants.HOARDING_ENERGY_THRESHOLD == 500.0
    assert constants.HOARDING_MATERIALS_THRESHOLD == 300.0


def test_mating_proposal_timeout_is_present_and_distinct() -> None:
    """The proposal-timeout constant exists, is a float, and differs from cooldown."""
    assert isinstance(constants.MATING_PROPOSAL_TIMEOUT_SECONDS, float)
    assert constants.MATING_PROPOSAL_TIMEOUT_SECONDS > 0.0
    # Distinct concept from the between-matings cooldown (DD5 / spec Section 4.7).
    assert constants.MATING_PROPOSAL_TIMEOUT_SECONDS != constants.MATING_COOLDOWN_SECONDS


def test_child_share_and_multiplier_are_consistent() -> None:
    """The code multiplier equals the doc share applied to two equal parents."""
    assert constants.MATING_OFFSPRING_MULTIPLIER == constants.MATING_CHILD_SHARE * 2


def test_agent_id_categories_is_immutable() -> None:
    """The category list is a tuple so the module constant cannot be mutated."""
    assert isinstance(constants.AGENT_ID_CATEGORIES, tuple)


def test_memory_dials_present_and_sane() -> None:
    """The Sprint-5 memory dials exist and hold sane, internally-consistent values."""
    from memory.models import Importance

    assert constants.REFLECT_EVERY_N_BREATHS >= 1
    assert constants.REFLECT_RECAP_TURNS >= 1
    assert constants.RETRIEVAL_K >= 1
    assert 0.0 < constants.RECENCY_DECAY <= 1.0
    assert set(constants.IMPORTANCE_WEIGHTS) == set(Importance)
    assert (
        constants.IMPORTANCE_WEIGHTS[Importance.HIGH]
        > constants.IMPORTANCE_WEIGHTS[Importance.MEDIUM]
        > constants.IMPORTANCE_WEIGHTS[Importance.LOW]
    )
    assert constants.EMBED_MODEL

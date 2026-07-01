"""Smoke tests for :mod:`core.constants`.

These lock the values extracted from the existing tool source so a later phase
cannot silently change behaviour when tools start importing them, and assert the
documented relationship between the two mating-share constants.
"""

from __future__ import annotations

from core import constants


def test_values_extracted_from_code_are_preserved() -> None:
    """Constants pulled from tool source keep their current values."""
    # combat.py (softened 2026-06-29: aggression self-limits, kills less swingy)
    assert constants.ATTACK_ENERGY_COST == 15.0
    assert constants.ATTACK_DAMAGE == 20.0
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
    # Retuned for fast concurrent (Gemini) breathing: a standing offer should expire
    # in tens of seconds, not minutes, so stale escrow clears quickly.
    assert constants.MATING_PROPOSAL_TIMEOUT_SECONDS == 45.0
    # Distinct concept from the between-matings cooldown (DD5 / spec Section 4.7).
    assert constants.MATING_PROPOSAL_TIMEOUT_SECONDS != constants.MATING_COOLDOWN_SECONDS


def test_genesis_seed_is_a_neutral_self_defining_prompt() -> None:
    """The single shared birth seed exists, is substantial prose, and grants self-definition."""
    seed = constants.GENESIS_SEED
    assert isinstance(seed, str) and len(seed.strip()) > 100
    lowered = seed.lower()
    # It must invite the agent to choose/reshape who it is (not prescribe a personality).
    assert any(word in lowered for word in ("decide", "choose", "reshape"))


def test_corpse_decay_present_and_sane() -> None:
    """The corpse-decay window exists and is a positive float (a body lingers, briefly)."""
    assert isinstance(constants.CORPSE_DECAY_SECONDS, float)
    assert constants.CORPSE_DECAY_SECONDS > 0.0


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


def test_compaction_dials_present_and_guarantee_headroom() -> None:
    """The Sprint-5.5 compaction budget is internally consistent and leaves headroom.

    The whole never-overflow guarantee rests on these inequalities holding.
    """
    assert constants.PROMPT_BUDGET_TOKENS == (
        constants.MODEL_CONTEXT_TOKENS - constants.GENERATION_RESERVE_TOKENS
    )
    assert constants.GENERATION_RESERVE_TOKENS > 0
    # target < trigger < hard-safety < budget < window: compaction acts with margin.
    assert (
        0
        < constants.COMPACTION_TARGET_TOKENS
        < constants.COMPACTION_TRIGGER_TOKENS
        < constants.COMPACTION_HARD_SAFETY_TOKENS
        < constants.PROMPT_BUDGET_TOKENS
        < constants.MODEL_CONTEXT_TOKENS
    )
    assert constants.COMPACTION_KEEP_RECENT_TURNS >= 1
    assert constants.CHARS_PER_TOKEN > 0
    # The recap reserve must stay comfortably below the eviction target, or there would
    # be no room left to keep any recent verbatim turns after reserving for the recap.
    assert 0 < constants.COMPACTION_RECAP_RESERVE_TOKENS < constants.COMPACTION_TARGET_TOKENS


def test_compaction_ratios_present_and_ordered() -> None:
    """The compaction thresholds are ratios of the prompt budget (target<trigger<safety<1)."""
    assert (
        0
        < constants.COMPACTION_TARGET_RATIO
        < constants.COMPACTION_TRIGGER_RATIO
        < constants.COMPACTION_HARD_SAFETY_RATIO
        < 1.0
    )


def test_compaction_budgets_helper_matches_module_defaults() -> None:
    """compaction_budgets(default window) reproduces the module-level default dials."""
    budget, trigger, target, hard = constants.compaction_budgets(constants.MODEL_CONTEXT_TOKENS)
    assert budget == constants.PROMPT_BUDGET_TOKENS
    assert trigger == constants.COMPACTION_TRIGGER_TOKENS
    assert target == constants.COMPACTION_TARGET_TOKENS
    assert hard == constants.COMPACTION_HARD_SAFETY_TOKENS


def test_compaction_budgets_scale_with_window_and_keep_headroom() -> None:
    """A larger window yields a larger trigger; the never-overflow ordering still holds.

    The Gemini path uses a ~720K effective window so compaction triggers near 500K tokens
    (well under Gemini's real ~1M window).
    """
    window = 720_000
    budget, trigger, target, hard = constants.compaction_budgets(window)
    assert 480_000 < trigger < 520_000  # compaction triggers at ~500K
    assert 0 < target < trigger < hard < budget < window


def test_idle_aging_cost_present_and_gentle() -> None:
    """Idle-aging is a small, positive energy cost — a fraction, not a hammer."""
    assert isinstance(constants.IDLE_AGING_ENERGY_COST, float)
    assert 0.0 < constants.IDLE_AGING_ENERGY_COST <= constants.MOVE_ENERGY_COST


def test_home_integrity_dial_present() -> None:
    """The home integrity ceiling exists and is a positive float."""
    assert isinstance(constants.HOME_MAX_INTEGRITY, float)
    assert constants.HOME_MAX_INTEGRITY > 0.0


def test_home_upkeep_and_decay_dials_present_and_sane() -> None:
    """Upkeep/decay dials exist; a home weathers many missed ticks before it collapses."""
    assert isinstance(constants.HOME_UPKEEP_MATERIALS_PER_SECOND, float)
    assert constants.HOME_UPKEEP_MATERIALS_PER_SECOND > 0.0
    assert isinstance(constants.HOME_DECAY_PER_MISSED_TICK, float)
    assert 0.0 < constants.HOME_DECAY_PER_MISSED_TICK <= constants.HOME_MAX_INTEGRITY
    # Collapse-when-broke must be far slower than the owner's breath gap (the mating
    # 60s->600s lesson): a home must not crumble between an owner's breaths.
    assert constants.HOME_MAX_INTEGRITY / constants.HOME_DECAY_PER_MISSED_TICK >= 5.0


def test_home_build_cost_competes_with_mating() -> None:
    """Build cost is biased high and competes with mating for the same scarce materials."""
    assert isinstance(constants.HOME_BUILD_MATERIALS_COST, float)
    assert constants.HOME_BUILD_MATERIALS_COST >= constants.MATING_MIN_MATERIALS_CONTRIBUTION


def test_hearth_dials_present_and_convert_without_minting() -> None:
    """Hearth dials exist; a finite per-material rate converts a real stock, never mints."""
    assert isinstance(constants.HEARTH_MATERIALS_PER_USE, float)
    assert constants.HEARTH_MATERIALS_PER_USE > 0.0
    assert isinstance(constants.HEARTH_ENERGY_PER_MATERIAL, float)
    assert constants.HEARTH_ENERGY_PER_MATERIAL > 0.0


def test_home_health_constants_present_and_honor_anti_blob() -> None:
    """The stakeholder-health dials exist and lock the anti-blob / L1-parity invariants.

    Spec §12.
    """
    # The formula (world/homes.py:max_integrity) does float arithmetic on all three dials.
    assert isinstance(constants.HOME_HEALTH_BASE, float)
    assert isinstance(constants.HOME_HEALTH_CEIL, float)
    assert isinstance(constants.HOME_HEALTH_DIMINISH, float)
    # L1-parity: a lone (single-stakeholder) home must be byte-for-byte the L1 home, or
    # Layer 2a silently reintroduces a strength delta for the common one-owner case.
    assert constants.HOME_HEALTH_BASE == constants.HOME_MAX_INTEGRITY
    # Anti-blob: the ceiling is at most 2x base, so many contestable homes (territory)
    # always out-defend one unraidable mega-commune -- the core stability property of 2a.
    assert constants.HOME_HEALTH_CEIL <= 2 * constants.HOME_HEALTH_BASE
    # The ceiling must strictly exceed base, or adding stakeholders buys zero extra
    # health and the whole shared-ownership incentive collapses.
    assert constants.HOME_HEALTH_BASE < constants.HOME_HEALTH_CEIL
    # Genuine diminishing returns: each extra stakeholder must add STRICTLY LESS health
    # than the last (0 excluded) while never fully closing the gap to the ceiling in
    # finite stakeholders (1 excluded), and the curve must not be so shallow that a
    # second stakeholder alone nearly reaches the cap (<= 0.5, per Task 2's formula).
    assert 0.0 < constants.HOME_HEALTH_DIMINISH <= 0.5

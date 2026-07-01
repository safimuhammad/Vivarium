"""Tests for system-prompt construction (:mod:`agents.prompt`).

Verifies the prompt carries the persona and every available tool affordance and,
critically (design DD9), that it leaks NO goals, strategy, survival framing, or
language revealing the world is a simulation.
"""

from __future__ import annotations

from agents.prompt import build_system_prompt

TOOL_NAMES: list[str] = [
    "look_around",
    "move",
    "speak",
    "harvest_resources",
    "transfer_resource",
    "attack",
    "initiate_mating",
    "reject_mating",
    "accept_mating",
]

FORBIDDEN_TERMS: tuple[str, ...] = (
    "goal",
    "objective",
    "mission",
    "task",
    "strategy",
    "win",
    "lose",
    "survive",
    "survival",
    "simulation",
    "simulated",
    "score",
    "reward",
    "optimize",
    "optimise",
    "death",
    "die",
)


def test_prompt_contains_persona() -> None:
    persona = "A curious wanderer who loves quiet meadows."
    prompt = build_system_prompt(persona, TOOL_NAMES)
    assert persona in prompt


def test_prompt_lists_every_tool() -> None:
    prompt = build_system_prompt("A curious wanderer.", TOOL_NAMES)
    for name in TOOL_NAMES:
        assert name in prompt


def test_prompt_has_no_goal_or_simulation_language() -> None:
    prompt = build_system_prompt("A curious wanderer.", TOOL_NAMES).lower()
    for term in FORBIDDEN_TERMS:
        assert term not in prompt


def test_prompt_explains_world_mechanics() -> None:
    """The shared shell must teach the world's physics, not just list tool names."""
    prompt = build_system_prompt("A curious wanderer.", TOOL_NAMES).lower()
    for concept in ("energy", "materials", "place", "child"):
        assert concept in prompt


def test_world_mechanics_is_shared_and_persona_independent() -> None:
    """Every agent gets the identical mechanics block; individuality is the persona."""
    from agents.prompt import WORLD_MECHANICS

    assert WORLD_MECHANICS in build_system_prompt("A curious wanderer.", TOOL_NAMES)
    assert WORLD_MECHANICS in build_system_prompt("A fierce loner.", TOOL_NAMES)


def test_world_mechanics_grants_the_freedom_not_to_act() -> None:
    """The being is told, in-world, that it may rest or think to itself — not only act."""
    from agents.prompt import WORLD_MECHANICS

    text = WORLD_MECHANICS
    assert "never compelled to act" in text
    assert "no one but yourself" in text
    # DD9: still no goals / strategy / simulation language.
    lowered = text.lower()
    for banned in ("simulation", "goal", "objective", "mission", "optim", "you should"):
        assert banned not in lowered


def test_world_mechanics_describes_aging_and_the_home() -> None:
    """The shell teaches L1 physics in-world (DD9): idling wears you down; a home + hearth."""
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    # Aging: stillness has a cost now (the still-life fix), stated as physics not strategy.
    assert "ebbs away" in lowered
    # The home affordances: build, hearth (materials -> energy), feed-or-it-crumbles.
    assert "home" in lowered
    assert "hearth" in lowered
    assert "crumbles" in lowered
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered


def test_world_mechanics_describes_sharing_a_home() -> None:
    """L2a physics (DD9): a home can be shared, with a diminishing, bounded benefit.

    A being may pledge to join it, or give it up; sharing hardens it, but each
    additional stakeholder helps less than the last — there is no unbounded gain
    from piling everyone into one home.
    """
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "pledge" in lowered  # you may join another's home
    assert "share" in lowered  # sharing its keep + hearth
    assert "give up" in lowered  # you may also leave a home you share
    assert "sounder" in lowered or "wear down" in lowered  # health scales with stakeholders
    assert "less than the last" in lowered  # diminishing returns: a bounded, not unbounded, gain
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered


def test_world_mechanics_describes_the_home_vault() -> None:
    """L2b physics (DD9): a shared home can hold a store you bank into and draw back out.

    A home heavy with a great store is noticeable (the no-laundering / raid-target signal),
    stated as physics, not goals or strategy.
    """
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "store" in lowered  # a home can hold a common store
    assert "draw" in lowered  # you may draw materials back out
    assert "notice" in lowered  # a heavy store draws notice (perceivable, no laundering)
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered


def test_world_mechanics_describes_break_in_and_ruins() -> None:
    """L2c physics (DD9): enough beings together can break into another's home to take or seize it;
    a home worn to nothing becomes ruins any passer-by may pick over. No goals/strategy/sim
    language."""
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "broken into" in lowered  # a home not yours can be broken into
    assert "seize" in lowered  # ... to take its store or seize it
    assert "ruin" in lowered  # a fallen home leaves ruins
    assert "pick over" in lowered  # ... any passer-by may pick over
    # The DD9 forbidden-words guard MUST stay green.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered

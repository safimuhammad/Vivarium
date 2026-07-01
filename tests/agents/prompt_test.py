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
    for banned in ("simulation", "goal", "objective", "mission", "optimi", "you should"):
        assert banned not in lowered

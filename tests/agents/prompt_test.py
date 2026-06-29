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
    "wait",
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

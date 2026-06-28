"""Sprint 4 §9.7 — live integration smoke (run by hand, needs Ollama).

A single REAL agent breathes against the real ``WorldState``/``EventBus``/
``ToolRegistry`` for ``BREATHS`` breaths, driven by a local Ollama model. This is
the milestone check: the agent should sustain homeostasis (harvest vs. drain) and
NOT paralyze itself over the run.

Excluded from the default/CI run (``integration`` marker). Run with Ollama up::

    pytest tests/integration/sprint4_smoke_test.py -m integration -s

Override the model with ``VIVARIUM_MODEL`` (default: ``qwen3:8b``).
"""

from __future__ import annotations

import os

import pytest

from agents.decider import make_default_decider
from agents.runtime import Agent
from bus.event_bus import EventBus
from observability.event_log import InMemoryEventLog
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

pytestmark = pytest.mark.integration

MODEL = os.environ.get("VIVARIUM_MODEL", "qwen3:8b")
BREATHS = 20


def _build_world() -> WorldState:
    regions = [
        Region(
            name="meadow",
            description="A lush meadow, rich with energy and materials.",
            connections=["grove"],
            energy_rate=2.0,
            materials_rate=1.0,
            current_energy=300.0,
            current_materials=150.0,
            max_energy=500.0,
            max_materials=500.0,
        ),
        Region(
            name="grove",
            description="A quiet grove of old trees.",
            connections=["meadow"],
            energy_rate=1.0,
            materials_rate=1.0,
            current_energy=100.0,
            current_materials=100.0,
            max_energy=500.0,
            max_materials=500.0,
        ),
    ]
    agents = [
        AgentState(
            id="wanderer_001",
            name="Ada",
            persona="A curious, careful wanderer who explores and tends to their own wellbeing.",
            current_position="meadow",
            current_energy=100.0,
            current_materials=20.0,
            status=AgentStatus.ALIVE,
        )
    ]
    return WorldState(regions, agents)


async def test_single_agent_sustains_homeostasis() -> None:
    world = _build_world()
    event_log = InMemoryEventLog()
    bus = EventBus(world, event_log=event_log)
    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    agent = Agent("wanderer_001", world, bus, registry, make_default_decider(MODEL), pace=0.0)

    start = world.get_agent("wanderer_001")
    assert start is not None
    start_pos = start.current_position
    start_energy = start.current_energy
    start_materials = start.current_materials

    await agent.run(max_breaths=BREATHS)

    final = world.get_agent("wanderer_001")
    assert final is not None

    # The loop ran and the agent acted at least once.
    assert agent.breath_count >= 1
    assert any(msg.get("role") == "tool" for msg in agent.lifecycle_history)

    # The world was mutated by the agent's actions.
    assert (
        final.current_position != start_pos
        or final.current_energy != start_energy
        or final.current_materials != start_materials
    )

    # Events were captured to the (replayable) log.
    assert len(event_log.events) >= 1

    # Milestone: homeostasis held — the agent ran the full budget without paralyzing.
    assert agent.breath_count == BREATHS
    assert final.status == AgentStatus.ALIVE

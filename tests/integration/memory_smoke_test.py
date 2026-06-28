"""Sprint 5 -- live memory smoke (run by hand, needs Ollama + the embed model).

A single REAL agent breathes against the real world with a REAL FileMemoryStore
(ChromaDB + all-MiniLM-L6-v2) and a local Ollama decider. With the reflection
cadence shortened, the agent should reflect several times over the run and the
dedicated reflection step should author at least one memory and/or revise its
identity -- proving the end-to-end write path on the real model (the spike's
Probe-C behaviour, now wired into the loop).

Excluded from the default/CI run (``integration`` marker). Run with Ollama up::

    pytest tests/integration/memory_smoke_test.py -m integration -s

Override the model with ``VIVARIUM_MODEL`` (default: ``qwen3:8b``).
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

import agents.runtime as runtime_module
from agents.decider import make_default_decider
from agents.runtime import Agent
from bus.event_bus import EventBus
from memory.embedding import default_embedding_function
from memory.store import FileMemoryStore
from memory.vector_store import ChromaVectorStore
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

pytestmark = pytest.mark.integration

MODEL = os.environ.get("VIVARIUM_MODEL", "qwen3:8b")
BREATHS = 6
REFLECT_EVERY = 2

PERSONA = (
    "You are Ada, a careful wanderer who values trust and remembers how others "
    "treat you. You live in a world of meadows and groves."
)


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
            persona=PERSONA,
            current_position="meadow",
            current_energy=100.0,
            current_materials=20.0,
            status=AgentStatus.ALIVE,
        )
    ]
    return WorldState(regions, agents)


async def test_live_agent_reflects_and_persists_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime_module, "REFLECT_EVERY_N_BREATHS", REFLECT_EVERY)
    root = Path(tempfile.mkdtemp(prefix="vivmem_smoke_"))
    try:
        world = _build_world()
        bus = EventBus(world)
        bus.subscribe("wanderer_001")
        registry = ToolRegistry(world, bus)
        register_builtins(registry)
        vector_store = ChromaVectorStore(
            "memories", default_embedding_function(), path=root / "chroma"
        )
        memory = FileMemoryStore(
            "wanderer_001",
            root,
            persona=PERSONA,
            vector_store=vector_store,
            clock=world.now,
        )
        agent = Agent(
            "wanderer_001", world, bus, registry, make_default_decider(MODEL), pace=0.0, memory=memory
        )

        await agent.run(max_breaths=BREATHS)

        # The loop ran and the agent survived.
        assert agent.breath_count == BREATHS
        final = world.get_agent("wanderer_001")
        assert final is not None and final.status is AgentStatus.ALIVE

        # The durable identity anchor exists.
        seed_path = root / "wanderer_001" / "seed.md"
        assert seed_path.exists()

        # The dedicated reflection step authored memory and/or revised identity.
        jsonl = root / "wanderer_001" / "memory.jsonl"
        memory_lines = jsonl.read_text(encoding="utf-8").splitlines() if jsonl.exists() else []
        identity = memory.load_identity().strip()
        print(f"\n[smoke] memories authored: {len(memory_lines)}")
        for line in memory_lines:
            print(f"  - {line}")
        print(f"[smoke] identity now: {identity!r}")
        assert memory_lines or identity != PERSONA.strip(), (
            "expected reflection to author a memory or revise identity over the run"
        )

        # Retrieval surfaces an authored memory back into perception.
        if memory_lines:
            assert memory.retrieve("what has happened to me", agent.breath_count, k=5)
    finally:
        shutil.rmtree(root, ignore_errors=True)

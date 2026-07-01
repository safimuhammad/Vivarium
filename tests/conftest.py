"""Shared pytest fixtures for the Vivarium test suite.

These fixtures give every later phase a deterministic starting point: a small
in-test world built with a *seeded* RNG and a *fake* clock, plus an
:class:`~bus.event_bus.EventBus`, a :class:`~tools.registry.ToolRegistry`, and a
mock decider so unit tests never touch a live Ollama or the global ``random`` /
wall clock.

Determinism rules for the suite (see ``CLAUDE.md`` Section 5):

* All randomness goes through the seeded :func:`rng` fixture (or
  :func:`sim_context`), never the global ``random`` module.
* All time-dependent logic uses the :func:`fake_clock` fixture, never
  ``time.time``.
* No unit test calls a live LLM/Ollama -- use :func:`mock_decider`.

.. note::
   The :func:`world` fixture builds a :class:`~world.world.WorldState` with the
   shared :func:`fake_clock` fixture, so ``world.clock`` is the same controllable
   handle a test can advance (e.g. for proposal-timeout tests).
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

import pytest

from agents.decider import Decision, ToolCall
from bus.event_bus import EventBus
from core.rng import SimContext, make_rng
from memory.embedding import FakeEmbeddingFunction
from memory.store import FileMemoryStore
from memory.vector_store import FakeVectorStore
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

SEED: int = 1234
"""Default RNG seed for the suite. Same seed -> same sequence."""

FAKE_CLOCK_START: float = 1_000_000.0
"""Fixed starting time (seconds) for the fake clock."""


class FakeClock:
    """A controllable, deterministic clock callable.

    Satisfies the ``Callable[[], float]`` clock contract used by
    :class:`~core.rng.SimContext` and (in Phase 2) ``WorldState``. Time only
    advances when a test explicitly advances it.
    """

    def __init__(self, start: float = FAKE_CLOCK_START) -> None:
        """Initialise the clock.

        Args:
            start: Initial time in seconds.
        """
        self._now = start

    def __call__(self) -> float:
        """Return the current (frozen) time.

        Returns:
            The current time in seconds.
        """
        return self._now

    def advance(self, seconds: float) -> float:
        """Advance the clock and return the new time.

        Args:
            seconds: Amount to advance, in seconds.

        Returns:
            The new current time in seconds.
        """
        self._now += seconds
        return self._now

    def set(self, when: float) -> None:
        """Set the clock to an absolute time.

        Args:
            when: Absolute time in seconds.
        """
        self._now = when


class MockDecider:
    """A deterministic stand-in for the LLM decider, returning scripted decisions.

    Satisfies the :class:`agents.decider.Decider` protocol's
    ``async def decide(messages, tools) -> Decision``. Returns canned
    :class:`~agents.decider.Decision` objects in order, cycling once the script is
    exhausted, and records every decision it produced. No network / Ollama
    access. Used by the breathing-loop tests (Phase 3) to drive
    ``perceive -> decide -> execute`` against a real world.
    """

    def __init__(self, scripted: list[Decision] | None = None) -> None:
        """Initialise the decider.

        Args:
            scripted: Ordered decisions to return. Defaults to a single empty
                (plain-text, no tool call) :class:`~agents.decider.Decision`.
        """
        self._scripted: list[Decision] = list(scripted) if scripted else [Decision()]
        self._index: int = 0
        self.history: list[Decision] = []

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Return the next scripted decision (cycling) and record it.

        Args:
            messages: Chat history; ignored (accepted for protocol conformance).
            tools: Tool schemas; ignored (accepted for protocol conformance).

        Returns:
            The next :class:`~agents.decider.Decision` in the script.
        """
        decision = self._scripted[self._index % len(self._scripted)]
        self._index += 1
        self.history.append(decision)
        return decision


@pytest.fixture
def seed() -> int:
    """Return the deterministic seed used across the suite."""
    return SEED


@pytest.fixture
def rng() -> random.Random:
    """Return a freshly seeded :class:`random.Random` for deterministic tests."""
    return make_rng(SEED)


@pytest.fixture
def fake_clock() -> FakeClock:
    """Return a fresh, frozen :class:`FakeClock` starting at a fixed time."""
    return FakeClock()


@pytest.fixture
def sim_context(fake_clock: FakeClock) -> SimContext:
    """Return a :class:`~core.rng.SimContext` with the seeded RNG + fake clock."""
    return SimContext(rng=make_rng(SEED), clock=fake_clock)


@pytest.fixture
def regions() -> list[Region]:
    """Return a small two-region world: ``alpha`` <-> ``beta`` (connected)."""
    return [
        Region(
            name="alpha",
            description="A modest meadow.",
            connections=["beta"],
            energy_rate=1.0,
            materials_rate=1.0,
            current_energy=100.0,
            current_materials=100.0,
            max_energy=500.0,
            max_materials=500.0,
        ),
        Region(
            name="beta",
            description="A quiet hollow.",
            connections=["alpha"],
            energy_rate=2.0,
            materials_rate=0.5,
            current_energy=200.0,
            current_materials=50.0,
            max_energy=500.0,
            max_materials=500.0,
        ),
    ]


@pytest.fixture
def agents() -> list[AgentState]:
    """Return two living agents, both starting in region ``alpha``."""
    return [
        AgentState(
            id="wanderer_001",
            name="Ada",
            persona="Curious and careful.",
            current_position="alpha",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        ),
        AgentState(
            id="wanderer_002",
            name="Boris",
            persona="Bold and brash.",
            current_position="alpha",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        ),
    ]


@pytest.fixture
def world(regions: list[Region], agents: list[AgentState], fake_clock: FakeClock) -> WorldState:
    """Return a fresh, deterministic :class:`~world.world.WorldState`.

    Built with a *seeded* RNG and the shared *frozen* :func:`fake_clock` fixture
    so every world-using test is reproducible by construction: all randomness
    routes through ``world.rng`` and all time reads through ``world.now()`` --
    and a test can advance ``fake_clock`` to move the same clock the world reads.
    """
    return WorldState(regions, agents, rng=make_rng(SEED), clock=fake_clock)


@pytest.fixture
def event_bus(world: WorldState) -> EventBus:
    """Return an :class:`~bus.event_bus.EventBus` with all agents subscribed."""
    bus = EventBus(world)
    for agent in world.get_all_agents():
        bus.subscribe(agent.id)
    return bus


@pytest.fixture
def registry(world: WorldState, event_bus: EventBus) -> ToolRegistry:
    """Return an empty :class:`~tools.registry.ToolRegistry` wired to the world."""
    return ToolRegistry(world, event_bus)


@pytest.fixture
def populated_registry(registry: ToolRegistry) -> ToolRegistry:
    """Return a :class:`~tools.registry.ToolRegistry` with all built-ins registered.

    The same wired :func:`registry`, after :func:`tools.builtin.register_builtins`
    so the breathing-loop tests can actually invoke every canonical tool.
    """
    register_builtins(registry)
    return registry


@pytest.fixture
def mock_decider() -> MockDecider:
    """Return a :class:`MockDecider` scripting two single-tool decisions."""
    return MockDecider(
        [
            Decision(tool_calls=[ToolCall("look_around")]),
            Decision(tool_calls=[ToolCall("look_around")]),
        ]
    )


@pytest.fixture
def fake_embedder() -> FakeEmbeddingFunction:
    """Return a deterministic, model-free embedding function for memory tests."""
    return FakeEmbeddingFunction()


@pytest.fixture
def fake_vector_store(fake_embedder: FakeEmbeddingFunction) -> FakeVectorStore:
    """Return an in-memory cosine vector store over the fake embedder (no chromadb)."""
    return FakeVectorStore(fake_embedder)


@pytest.fixture
def memory_store(
    tmp_path: Path, fake_vector_store: FakeVectorStore, fake_clock: FakeClock
) -> FileMemoryStore:
    """Return a FileMemoryStore for ``wanderer_001`` rooted in a temp dir.

    Uses the fake vector store and the frozen clock so memory tests are
    deterministic and never load a model. The seed persona differs from the
    ``agents`` fixture's persona so tests can tell which source the system prompt
    drew from (memory identity takes precedence over ``AgentState.persona``).
    """
    return FileMemoryStore(
        "wanderer_001",
        tmp_path,
        persona="I am Ada, a careful wanderer.",
        vector_store=fake_vector_store,
        clock=fake_clock,
    )

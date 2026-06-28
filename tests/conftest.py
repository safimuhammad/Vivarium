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
   Phase 2 will extend :func:`world` once :class:`~world.world.WorldState` gains
   ``rng`` / ``clock`` constructor parameters; see the ``TODO`` there.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

import pytest

from bus.event_bus import EventBus
from core.rng import SimContext, make_rng
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


@dataclass
class ToolCall:
    """A single canned decision: which tool to call with which params."""

    name: str
    params: dict[str, Any] = field(default_factory=dict)


class MockDecider:
    """A stand-in for the LLM "decider" returning scripted tool calls.

    Returns canned :class:`ToolCall` objects in order, cycling once the script is
    exhausted, and records every call it produced. No network / Ollama access.
    Placeholder for Phase 4's breathing-loop integration test, which will drive
    ``perceive -> decide -> execute`` against a real world with this mock.
    """

    def __init__(self, scripted: list[ToolCall] | None = None) -> None:
        """Initialise the decider.

        Args:
            scripted: Ordered tool calls to return. Defaults to a single
                no-op ``wait`` call when omitted.
        """
        self._scripted: list[ToolCall] = list(scripted) if scripted else [ToolCall("wait")]
        self._index: int = 0
        self.history: list[ToolCall] = []

    def decide(self, *_args: Any, **_kwargs: Any) -> ToolCall:
        """Return the next scripted tool call (cycling) and record it.

        Args:
            *_args: Ignored; accepts any positional context a caller passes.
            **_kwargs: Ignored; accepts any keyword context a caller passes.

        Returns:
            The next :class:`ToolCall` in the script.
        """
        call = self._scripted[self._index % len(self._scripted)]
        self._index += 1
        self.history.append(call)
        return call

    def __call__(self, *args: Any, **kwargs: Any) -> ToolCall:
        """Alias for :meth:`decide` so the mock is usable as a plain callable."""
        return self.decide(*args, **kwargs)


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
def world(regions: list[Region], agents: list[AgentState]) -> WorldState:
    """Return a fresh :class:`~world.world.WorldState` for the in-test setup.

    TODO(Phase 2): once ``WorldState`` accepts ``rng`` and ``clock`` parameters,
    build it here with the seeded RNG and the fake clock (e.g.
    ``WorldState(regions, agents, rng=make_rng(SEED), clock=FakeClock())``) so
    every world-using test is deterministic by construction.
    """
    return WorldState(regions, agents)


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
def mock_decider() -> MockDecider:
    """Return a :class:`MockDecider` with a small canned script."""
    return MockDecider(
        [
            ToolCall("look_around"),
            ToolCall("wait"),
        ]
    )

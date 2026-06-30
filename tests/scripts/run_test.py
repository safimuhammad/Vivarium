"""Tests for the multi-agent runner (``scripts/run.py``).

Deterministic, no live model: a scripted :class:`~tests.conftest.MockDecider`
drives the agents, a :class:`~memory.vector_store.FakeVectorStore` keeps memory
fast, and the run is bounded by a tiny ``duration`` so the whole assembly --
``build_simulation`` then ``run_simulation`` (agents + world-tick + activity feed
+ collapse watch + one shutdown path) -- is exercised in milliseconds.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from agents.decider import Decision, SerializingDecider, ToolCall
from agents.runtime import Agent
from core.constants import COMPACTION_TRIGGER_TOKENS, compaction_budgets
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import Simulation, _spawn_new_agents, build_simulation, run_simulation
from tests.conftest import MockDecider
from world.agents import AgentState, AgentStatus


def _fake_factory(_agent_id: str) -> VectorStore:
    """Return a fresh in-memory vector store (no chromadb, deterministic)."""
    return FakeVectorStore(FakeEmbeddingFunction())


async def test_runner_smoke_runs_and_shuts_down(tmp_path: Path) -> None:
    """A bounded run breathes, records events, then frees every inbox at shutdown."""
    sim = build_simulation(
        "config/world.yaml",
        seed=7,
        model="mock",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 200),
        vector_store_factory=_fake_factory,
    )
    await run_simulation(
        sim, pace=0.0, duration=0.3, world_tick_interval=0.05, refresh_interval=0.05
    )
    assert any(a.breath_count > 0 for a in sim.agents)  # agents breathed
    assert sim.feed_log.new_events(0)[1] > 0  # events recorded
    for a in sim.agents:  # inboxes freed at shutdown
        assert a.agent_id not in sim.bus.agent_queues


async def test_runner_stops_when_all_dead(tmp_path: Path) -> None:
    """With everyone pre-killed the run ends immediately, not at ``duration``."""
    sim = build_simulation(
        "config/world.yaml",
        seed=7,
        model="mock",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=MockDecider([Decision()] * 50),
        vector_store_factory=_fake_factory,
    )
    for a in sim.agents:  # pre-kill everyone
        sim.world.kill_agent(a.agent_id)
    started = time.perf_counter()
    await run_simulation(
        sim, pace=0.0, duration=5.0, world_tick_interval=0.05, refresh_interval=0.05
    )
    assert time.perf_counter() - started < 4.0  # returned fast, not at duration


def test_build_simulation_serializes_the_ollama_provider_by_default(tmp_path: Path) -> None:
    """The default (Ollama) path wraps the decider in a SerializingDecider (one at a time)."""
    sim = _build(tmp_path, MockDecider([Decision()]))
    assert isinstance(sim.decider, SerializingDecider)


def test_build_simulation_gemini_provider_runs_unserialized(tmp_path: Path) -> None:
    """The Gemini path is concurrent: the decider is NOT wrapped in a SerializingDecider.

    A hosted API serves requests in parallel, so serializing would throw away the whole
    point of moving off local Ollama. The injected decider is used as-is.
    """
    mock = MockDecider([Decision()])
    sim = build_simulation(
        "config/world.yaml",
        seed=7,
        model="gemini-3.1-flash-lite",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=mock,
        vector_store_factory=_fake_factory,
        provider="gemini",
    )
    assert sim.decider is mock
    assert not isinstance(sim.decider, SerializingDecider)


def test_build_simulation_wires_usage_log_and_model(tmp_path: Path) -> None:
    """Each agent gets the usage sink + model name so token cost is recorded + attributed."""
    sim = _build(tmp_path, MockDecider([Decision()]))
    assert sim.agents, "expected at least one agent"
    for agent in sim.agents:
        assert agent.usage_log is not None
        assert agent.model == "mock"


def test_build_simulation_gemini_gives_agents_a_large_context_window(tmp_path: Path) -> None:
    """The Gemini path sizes the window so compaction triggers near 500K tokens."""
    sim = build_simulation(
        "config/world.yaml",
        seed=7,
        model="gemini-3.1-flash-lite",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=MockDecider([Decision()]),
        vector_store_factory=_fake_factory,
        provider="gemini",
    )
    assert sim.agents
    for agent in sim.agents:
        assert 480_000 < agent._compaction_trigger < 520_000


def test_build_simulation_ollama_keeps_the_default_window(tmp_path: Path) -> None:
    """The local/Ollama path leaves the module default window (no large override)."""
    sim = _build(tmp_path, MockDecider([Decision()]))  # _build defaults to the ollama provider
    for agent in sim.agents:
        assert agent._compaction_trigger == COMPACTION_TRIGGER_TOKENS


def test_build_simulation_context_tokens_override_wins(tmp_path: Path) -> None:
    """An explicit context_window override is applied regardless of provider."""
    sim = build_simulation(
        "config/world.yaml",
        seed=7,
        model="gemini-3.1-flash-lite",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=MockDecider([Decision()]),
        vector_store_factory=_fake_factory,
        provider="gemini",
        context_window=100_000,
    )
    expected_trigger = compaction_budgets(100_000)[1]
    for agent in sim.agents:
        assert agent._compaction_trigger == expected_trigger


def _build(tmp_path: Path, decider: MockDecider) -> Simulation:
    """Build a deterministic sim from the shipped world config + a fake vector store."""
    return build_simulation(
        "config/world.yaml",
        seed=7,
        model="mock",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        decider=decider,
        vector_store_factory=_fake_factory,
    )


def _inject_offspring(sim: Simulation, agent_id: str = "seed_offspring") -> None:
    """Add an ALIVE newborn into the world (co-located with the first agent)."""
    first = sim.world.get_agent(sim.agents[0].agent_id)
    assert first is not None
    sim.world.add_agent(
        AgentState(
            id=agent_id,
            name="Tot",
            persona="newborn",
            current_position=first.current_position,
            current_energy=100.0,
            current_materials=0.0,
            status=AgentStatus.ALIVE,
        )
    )


async def test_spawn_new_agents_launches_offspring(tmp_path: Path) -> None:
    """One detection pass builds, subscribes, tracks, and launches a newborn."""
    sim = _build(tmp_path, MockDecider([Decision()] * 10))
    known = {a.agent_id for a in sim.agents}
    n0 = len(sim.agents)
    _inject_offspring(sim)

    tasks: list[asyncio.Task[None]] = []
    launched: list[str] = []

    async def fake_run(agent: Agent) -> None:
        launched.append(agent.agent_id)

    _spawn_new_agents(sim.world, sim, fake_run, tasks, known)

    assert "seed_offspring" in known  # recorded so it is not re-spawned
    assert len(sim.agents) == n0 + 1
    assert any(a.agent_id == "seed_offspring" for a in sim.agents)
    assert "seed_offspring" in sim.bus.agent_queues  # subscribed via the factory
    assert len(tasks) == 1
    await asyncio.gather(*tasks, return_exceptions=True)  # let fake_run finish
    assert launched == ["seed_offspring"]

    # A second pass is idempotent (the id is now known).
    _spawn_new_agents(sim.world, sim, fake_run, tasks, known)
    assert len(tasks) == 1


async def test_offspring_breathes_and_is_cleaned_up(tmp_path: Path) -> None:
    """An offspring born mid-run is detected, breathes, and is unsubscribed at shutdown."""
    sim = _build(tmp_path, MockDecider([Decision(tool_calls=[ToolCall("wait")])] * 500))
    _inject_offspring(sim)

    await run_simulation(
        sim, pace=0.0, duration=0.4, world_tick_interval=0.02, refresh_interval=0.05
    )

    offspring = next((a for a in sim.agents if a.agent_id == "seed_offspring"), None)
    assert offspring is not None  # spawn-watch folded it into the breathing set
    assert offspring.breath_count > 0  # it actually breathed
    assert "seed_offspring" not in sim.bus.agent_queues  # inbox freed at shutdown


async def test_living_offspring_keeps_run_alive_past_founder_collapse(tmp_path: Path) -> None:
    """A breathing offspring keeps the run going when every founder is paralyzed.

    Without the spawn-watcher the offspring is inert, every breathing agent is
    PARALYZED, and the run collapses fast. With it, the offspring breathes ALIVE, so
    ``_liveness_watch`` never sees zero ALIVE and the run lasts the full duration.
    """
    sim = _build(tmp_path, MockDecider([Decision(tool_calls=[ToolCall("wait")])] * 500))
    for a in sim.agents:  # paralyze every founder
        state = sim.world.get_agent(a.agent_id)
        assert state is not None
        sim.world.modify_agent_energy(a.agent_id, -(state.current_energy - 1.0))
    _inject_offspring(sim)  # ALIVE, born with full energy

    started = time.perf_counter()
    await run_simulation(
        sim, pace=0.0, duration=1.0, world_tick_interval=0.02, refresh_interval=0.05
    )
    elapsed = time.perf_counter() - started

    assert elapsed > 0.6  # did NOT collapse early -- the offspring kept it alive
    offspring = next((a for a in sim.agents if a.agent_id == "seed_offspring"), None)
    assert offspring is not None and offspring.breath_count > 0


async def test_offspring_survives_birth_when_both_parents_die(tmp_path: Path) -> None:
    """A newborn whose parents both died in the mating trade still breathes (M1).

    If the 'world ended' check were scoped to the breathing set, the first liveness poll
    would see zero present (parents DEAD, offspring not yet adopted) and stop the run,
    losing the newborn. Scanning the whole world keeps the run alive until the
    spawn-watcher adopts the offspring.
    """
    sim = _build(tmp_path, MockDecider([Decision(tool_calls=[ToolCall("wait")])] * 500))
    for a in sim.agents:  # every founder dies in the (hypothetical) mating trade
        assert sim.world.kill_agent(a.agent_id) is True
    _inject_offspring(sim)  # ALIVE newborn, not yet in the breathing set

    await run_simulation(
        sim, pace=0.0, duration=0.3, world_tick_interval=0.02, refresh_interval=0.05
    )

    offspring = next((a for a in sim.agents if a.agent_id == "seed_offspring"), None)
    assert offspring is not None  # adopted, not lost to a premature stop
    assert offspring.breath_count > 0  # and it actually breathed


async def test_spawn_watch_survives_a_failing_pass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A detection pass that raises must not kill the watcher or crash the run."""
    sim = _build(tmp_path, MockDecider([Decision(tool_calls=[ToolCall("wait")])] * 500))

    def boom(_state: AgentState) -> Agent:
        raise RuntimeError("memory store unavailable")

    monkeypatch.setattr(sim, "spawn_agent", boom)
    _inject_offspring(sim)  # the watcher will try (and fail) to build it each pass

    # Must complete cleanly despite repeated spawn failures; founders keep breathing.
    await run_simulation(
        sim, pace=0.0, duration=0.2, world_tick_interval=0.02, refresh_interval=0.05
    )
    assert any(a.breath_count > 0 for a in sim.agents)


async def test_all_paralyzed_world_collapses(tmp_path: Path) -> None:
    """With no living offspring, an all-paralyzed breathing set still collapses fast."""
    sim = _build(tmp_path, MockDecider([Decision()] * 50))
    for a in sim.agents:  # paralyze everyone; no offspring injected
        state = sim.world.get_agent(a.agent_id)
        assert state is not None
        sim.world.modify_agent_energy(a.agent_id, -(state.current_energy - 1.0))

    started = time.perf_counter()
    await run_simulation(
        sim, pace=0.0, duration=5.0, world_tick_interval=0.05, refresh_interval=0.05
    )
    assert time.perf_counter() - started < 4.0  # collapsed, did not run to duration

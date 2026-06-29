"""Tests for the multi-agent runner (``scripts/run.py``).

Deterministic, no live model: a scripted :class:`~tests.conftest.MockDecider`
drives the agents, a :class:`~memory.vector_store.FakeVectorStore` keeps memory
fast, and the run is bounded by a tiny ``duration`` so the whole assembly --
``build_simulation`` then ``run_simulation`` (agents + world-tick + activity feed
+ collapse watch + one shutdown path) -- is exercised in milliseconds.
"""

from __future__ import annotations

import time
from pathlib import Path

from agents.decider import Decision, ToolCall
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import build_simulation, run_simulation
from tests.conftest import MockDecider


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

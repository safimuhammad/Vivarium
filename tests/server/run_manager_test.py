"""Tests for the run manager's edges: no run, a crashed run, a run that will not stop."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from agents.decider import Decision, ToolCall
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import DEFAULT_MLX_CONTEXT_TOKENS, DEFAULT_MLX_MODEL
from server.run_manager import RunManager, RunManagerSettings, RunNotStartedError
from tests.conftest import MockDecider


def _fake_factory(_agent_id: str) -> VectorStore:
    return FakeVectorStore(FakeEmbeddingFunction())


def _manager(tmp_path: Path, *, shutdown_timeout: float = 5.0) -> RunManager:
    return RunManager(
        RunManagerSettings(
            config_path="config/world.yaml",
            memory_root=tmp_path / "mem",
            run_dir=tmp_path / "runs",
            pace=0.0,
            world_tick_interval=60.0,
            refresh_interval=0.05,
            feed_maxlen=16,
            shutdown_timeout=shutdown_timeout,
        ),
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
        vector_store_factory=_fake_factory,
    )


async def test_a_manager_with_no_run_refuses_to_invent_one(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    assert manager.current is None
    assert manager.simulation is None
    with pytest.raises(RunNotStartedError):
        manager.require_run()
    with pytest.raises(RunNotStartedError):
        await manager.stop()


async def test_defaults_are_available_before_anything_has_run(tmp_path: Path) -> None:
    """The configuration screen is the first thing a viewer sees; it cannot wait."""
    manager = _manager(tmp_path)
    defaults = manager.defaults()
    assert isinstance(defaults["knobs"], dict)
    assert manager.default_config().beings


async def test_the_model_and_window_follow_the_chosen_provider(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    config = manager.default_config()

    hosted = config.model_copy(update={"provider": "gemini"})
    assert await _started_provider_wiring(manager, hosted) == ("gemini-3.1-flash-lite", 720_000)

    local = config.model_copy(update={"provider": "ollama"})
    assert await _started_provider_wiring(manager, local) == ("qwen3:8b", None)

    mlx = config.model_copy(update={"provider": "mlx"})
    assert await _started_provider_wiring(manager, mlx) == (
        DEFAULT_MLX_MODEL,
        DEFAULT_MLX_CONTEXT_TOKENS,
    )

    await manager.shutdown()


async def _started_provider_wiring(manager: RunManager, config: object) -> tuple[str, int | None]:
    """Start a run and return the model and context window it was wired with."""
    await manager.start(config)  # type: ignore[arg-type]
    context = manager.require_run().simulation.run_context
    return context.model, context.context_window


async def test_a_crashed_run_reports_failed_not_stopped(tmp_path: Path) -> None:
    """A viewer must be able to tell a run that broke from a run that ended."""
    manager = _manager(tmp_path)
    await manager.start(manager.default_config())
    handle = manager.require_run()

    # Replace the breathing task with one that raises, exactly as a crashed run would.
    async def _explode() -> None:
        raise RuntimeError("the world came apart")

    handle.task.cancel()
    await asyncio.gather(handle.task, return_exceptions=True)
    handle.task = asyncio.create_task(_explode())
    assert handle.watcher is not None
    handle.watcher.cancel()
    await asyncio.gather(handle.watcher, return_exceptions=True)
    handle.watcher = asyncio.create_task(manager._watch(handle))

    await manager.shutdown()
    assert handle.status == "failed"


async def test_a_run_that_will_not_stop_is_cancelled(tmp_path: Path) -> None:
    """The stop budget is a budget: a wedged run must never hold the server hostage."""
    manager = _manager(tmp_path, shutdown_timeout=0.05)
    await manager.start(manager.default_config())
    handle = manager.require_run()

    async def _never_stops() -> None:
        await asyncio.Event().wait()

    handle.task.cancel()
    await asyncio.gather(handle.task, return_exceptions=True)
    assert handle.watcher is not None
    handle.watcher.cancel()
    await asyncio.gather(handle.watcher, return_exceptions=True)
    handle.task = asyncio.create_task(_never_stops())
    handle.watcher = asyncio.create_task(manager._watch(handle))

    await manager.shutdown()
    assert handle.task.cancelled()
    assert handle.status == "stopped"


async def test_a_failing_final_checkpoint_does_not_break_shutdown(tmp_path: Path) -> None:
    """Durability is best-effort at the very end; it must not turn a stop into a crash."""
    manager = _manager(tmp_path)
    await manager.start(manager.default_config())
    handle = manager.require_run()
    handle.simulation.run_context.snapshot_log_path = Path("/does/not/exist/snapshots.jsonl")
    handle.simulation.snapshot_log.path = Path("/does/not/exist/snapshots.jsonl")

    await manager.shutdown()
    assert handle.status == "stopped"


async def test_shutdown_after_a_finished_run_keeps_terminal_recording_immutable(
    tmp_path: Path,
) -> None:
    """A later server exit must not extend an already saved run's duration."""
    manager = _manager(tmp_path)
    await manager.start(manager.default_config())
    handle = manager.require_run()
    checkpoint_path = handle.simulation.run_context.snapshot_log_path
    sidecar_path = handle.simulation.run_context.run_dir / "run.json"

    await manager.stop()
    assert handle.watcher is not None
    await asyncio.wait_for(handle.watcher, timeout=1.0)
    before_sidecar = sidecar_path.read_bytes()
    before_checkpoints = checkpoint_path.read_bytes()
    assert json.loads(before_sidecar)["status"] == "stopped"

    await manager.shutdown()

    assert sidecar_path.read_bytes() == before_sidecar
    assert checkpoint_path.read_bytes() == before_checkpoints

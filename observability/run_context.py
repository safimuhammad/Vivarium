"""Run metadata for live observers and future browser APIs.

The runner already owns the live world and event feed. This module gives that run
an explicit metadata object so later API layers can expose ``/api/run`` without
reverse-engineering paths, constants, or cursor state from the CLI.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from core.constants import (
    GENESIS_SEED,
    HOARDING_ENERGY_THRESHOLD,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_COOLDOWN_SECONDS,
    PARALYSIS_ENERGY_THRESHOLD,
    RUINS_PERSIST_SECONDS,
)

type RunStatus = Literal["ready", "starting", "running", "stopping", "stopped", "failed"]
"""The lifecycle a viewer is entitled to see.

``ready`` is the pre-start value of a freshly assembled bundle; the run-lifecycle API
never leaves it visible. The rest are reported honestly through
``GET /api/run``: a finished run must not look like beings deep in thought.
"""


def frontend_constants() -> dict[str, float]:
    """Return world-rule constants needed by the live frontend contract."""
    return {
        "paralysis_energy_threshold": PARALYSIS_ENERGY_THRESHOLD,
        "home_build_materials_cost": HOME_BUILD_MATERIALS_COST,
        "home_upkeep_materials_per_second": HOME_UPKEEP_MATERIALS_PER_SECOND,
        "hoarding_energy_threshold": HOARDING_ENERGY_THRESHOLD,
        "hoarding_materials_threshold": HOARDING_MATERIALS_THRESHOLD,
        "mating_cooldown_seconds": MATING_COOLDOWN_SECONDS,
        "ruins_persist_seconds": RUINS_PERSIST_SECONDS,
    }


@dataclass(slots=True)
class RunContext:
    """Metadata for one assembled simulation run.

    Attributes:
        run_id: Stable id for this process run.
        seed: World RNG seed.
        started_at: Wall-clock seconds when the run bundle was assembled.
        config_path: Source world config path.
        config_hash: SHA-256 hash of the config file contents.
        memory_root: Root directory containing per-being memory artifacts.
        run_dir: Run-specific directory containing this run's artifacts.
        event_log_path: Durable event JSONL path.
        usage_log_path: Token usage JSONL path.
        snapshot_log_path: Durable world-snapshot checkpoint JSONL path.
        provider: Decider provider name.
        model: Decider model name.
        context_window: Effective context window override, or ``None`` for the
            agent runtime default.
        constants: World-rule constants exposed to frontend clients.
        timing: Actual runtime timing values once :func:`scripts.run.run_simulation`
            starts the run. ``duration`` is ``None`` for an unbounded run.
        status: Current lifecycle status of the run.
        seed_persona: The words this run's beings are born from unless a viewer
            wrote their own. A **run constant**, published once here rather than
            repeated on every being in every checkpoint.
    """

    run_id: str
    seed: int
    started_at: float
    config_path: Path
    config_hash: str
    memory_root: Path
    run_dir: Path
    event_log_path: Path
    usage_log_path: Path
    snapshot_log_path: Path
    provider: str
    model: str
    context_window: int | None
    constants: dict[str, float]
    timing: dict[str, float | None] = field(default_factory=dict)
    status: RunStatus = "ready"
    seed_persona: str = GENESIS_SEED

    def mark_starting(self) -> None:
        """Mark the run as assembled and about to breathe."""
        self.status = "starting"

    def mark_running(self) -> None:
        """Mark the run as actively executing."""
        self.status = "running"

    def mark_stopping(self) -> None:
        """Mark the run as winding down (a stop was requested, teardown is under way)."""
        self.status = "stopping"

    def mark_stopped(self) -> None:
        """Mark the run as no longer executing."""
        self.status = "stopped"

    def mark_failed(self) -> None:
        """Mark the run as ended by an error rather than by a stop or its duration."""
        self.status = "failed"

    def set_timing(
        self,
        *,
        pace: float,
        duration: float | None,
        world_tick_interval: float,
        refresh_interval: float,
    ) -> None:
        """Record the actual timing values used for this run.

        Args:
            pace: Inter-breath sleep, in seconds.
            duration: Wall-clock bound in seconds, or ``None`` for an unbounded run.
            world_tick_interval: Seconds between world-ticks.
            refresh_interval: Seconds between activity-feed re-renders.

        Returns:
            None.
        """
        self.timing = {
            "pace": pace,
            "duration": duration,
            "world_tick_interval": world_tick_interval,
            "refresh_interval": refresh_interval,
        }

    def to_metadata(self, *, world_time: float, event_cursor: int) -> dict[str, object]:
        """Return a JSON-ready metadata envelope for the future ``/api/run`` route."""
        return {
            "schema": 1,
            "run_id": self.run_id,
            "seed": self.seed,
            "started_at": self.started_at,
            "status": self.status,
            "event_cursor": event_cursor,
            "world_time": world_time,
            "config_hash": self.config_hash,
            "constants": dict(self.constants),
            "seed_persona": self.seed_persona,
            "provider": self.provider,
            "model": self.model,
            "context_window": self.context_window,
            "timing": dict(self.timing),
            "artifacts": {
                "events": str(self.event_log_path),
                "usage": str(self.usage_log_path),
                "snapshots": str(self.snapshot_log_path),
                "memory_root": str(self.memory_root),
            },
        }


def build_run_context(
    *,
    config_path: str | Path,
    seed: int,
    model: str,
    provider: str,
    memory_root: str | Path,
    run_dir: str | Path,
    context_window: int | None,
    clock: Callable[[], float] = time.time,
) -> RunContext:
    """Build a :class:`RunContext` for one assembled simulation."""
    config = Path(config_path)
    memory = Path(memory_root)
    run_root = Path(run_dir)
    started_at = float(clock())
    config_hash = _hash_file(config)
    run_id = _run_id(seed=seed, started_at=started_at, config_hash=config_hash)
    run_directory = run_root / run_id
    return RunContext(
        run_id=run_id,
        seed=seed,
        started_at=started_at,
        config_path=config,
        config_hash=config_hash,
        memory_root=memory,
        run_dir=run_directory,
        event_log_path=run_directory / "events.jsonl",
        usage_log_path=run_directory / "usage.jsonl",
        snapshot_log_path=run_directory / "snapshots.jsonl",
        provider=provider,
        model=model,
        context_window=context_window,
        constants=frontend_constants(),
    )


def _hash_file(path: Path) -> str:
    """Return a SHA-256 hash for ``path``."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_id(*, seed: int, started_at: float, config_hash: str) -> str:
    """Return a compact run id suitable for URLs and logs."""
    started_ms = int(started_at * 1000)
    nonce = uuid.uuid4().hex[:12]
    return f"seed-{seed}-{started_ms}-{config_hash[:8]}-{nonce}"

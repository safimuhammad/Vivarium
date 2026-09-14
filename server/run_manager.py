"""Owns the hosted run: start it, replace it, stop it gracefully, report it honestly.

Before this module the simulation was built inside the FastAPI ``lifespan``, so a run
began when the *process* began and was configured only by CLI flags. There was no way
to press "Let's go live". :class:`RunManager` makes the hosted run **replaceable**
rather than process-bound, while keeping the server's one-run-at-a-time shape.

Three properties it exists to guarantee:

* **A start replaces the previous run.** The previous run is stopped and *awaited*
  before the next is assembled, under one :class:`asyncio.Lock`, so two concurrent
  starts cannot interleave, leak breathing tasks, or leave two worlds writing into one
  archive. The replacement gets a new ``run_id``, which is what the frontend's existing
  ``"replacement"`` path resets state on.
* **Status is honest.** ``starting -> running -> stopping -> stopped`` (or ``failed``)
  is reported through ``GET /api/run`` for the whole lifecycle. A finished run must not
  look like beings deep in thought.
* **Stopping is graceful.** The breathing loops are signalled rather than cancelled,
  the run task is awaited, and a final checkpoint is written so the last world state is
  durable and replayable.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from agents.decider import Decider
from config.loader import load_world_config
from config.schema import WorldConfig
from core.logging import get_logger
from core.run_settings import derive_mating_proposal_timeout
from memory.vector_store import VectorStore
from observability.run_context import RunStatus
from scripts.run import (
    Simulation,
    build_simulation,
    resolve_context_window,
    resolve_default_model,
    run_simulation,
)
from server.recordings import update_recording_sidecar
from server.run_config import (
    RunConfig,
    build_run_world,
    default_run_config,
    derive_memory_root,
    run_defaults_payload,
    warnings_for,
)

logger = get_logger(__name__)

__all__ = ["RunHandle", "RunManager", "RunManagerSettings", "RunNotStartedError"]

FINAL_CHECKPOINT_REASON: str = "run_stopped"
"""Reason stamped on the checkpoint written as a run winds down."""


class RunNotStartedError(RuntimeError):
    """Raised when a lifecycle operation is asked for and no run has ever started."""


@dataclass(frozen=True, slots=True)
class RunManagerSettings:
    """Everything the manager needs that a ``RunConfig`` deliberately does not carry.

    Attributes:
        config_path: The ``world.yaml`` whose regions are locked into every run.
        memory_root: Parent directory a fresh per-run memory root is minted beneath.
        run_dir: Parent directory each run's artifact directory is created beneath.
        pace: Inter-breath sleep, in seconds.
        world_tick_interval: Seconds between world-ticks. Locked, not configurable:
            regeneration is per tick while home upkeep is per second, so changing it
            would silently rescale the world's food supply alone.
        refresh_interval: Seconds between activity-feed re-renders.
        feed_maxlen: Events retained by the live feed ring buffer.
        model: Explicit model override, or ``None`` to pick the provider's default.
        context_window: Explicit context-window override, or ``None`` for the
            provider's default.
        startup_timeout: Seconds the process-launched run may take to become
            observable before the app starts serving anyway.
        shutdown_timeout: Seconds a graceful stop is given before the run task is
            cancelled outright.
    """

    config_path: str | Path
    memory_root: str | Path
    run_dir: str | Path
    pace: float
    world_tick_interval: float
    refresh_interval: float
    feed_maxlen: int
    model: str | None = None
    context_window: int | None = None
    startup_timeout: float = 1.0
    shutdown_timeout: float = 5.0


@dataclass(slots=True)
class RunHandle:
    """One live (or just-finished) run and the machinery that stops it.

    Attributes:
        simulation: The assembled simulation bundle.
        config: The configuration this run started with.
        stop_event: The event that funnels into the runner's single shutdown path.
        task: The breathing run task.
        warnings: Non-blocking cautions raised when the configuration was accepted.
        watcher: The task that awaits :attr:`task` and settles the run's ending --
            so a run that ends *on its own* (its duration elapsed, the world died,
            the ecology collapsed) still records a terminal status and a final
            checkpoint without anyone asking it to.
    """

    simulation: Simulation
    config: RunConfig
    stop_event: asyncio.Event
    task: asyncio.Task[None]
    warnings: list[str]
    watcher: asyncio.Task[None] | None = None

    @property
    def run_id(self) -> str:
        """Return this run's id."""
        return self.simulation.run_context.run_id

    @property
    def status(self) -> RunStatus:
        """Return this run's current lifecycle status."""
        return self.simulation.run_context.status


class RunManager:
    """Starts, replaces and stops the single hosted run.

    Args:
        settings: Process-level wiring a ``RunConfig`` does not carry.
        decider: Optional pre-built decider shared by every run (tests inject a mock).
        vector_store_factory: Optional ``agent_id -> VectorStore`` factory.
        on_run_changed: Optional callback invoked with each newly assembled
            simulation, so the app can keep ``app.state`` pointing at the live run.
    """

    def __init__(
        self,
        settings: RunManagerSettings,
        *,
        decider: Decider | None = None,
        vector_store_factory: Callable[[str], VectorStore] | None = None,
        on_run_changed: Callable[[RunHandle], None] | None = None,
    ) -> None:
        self._settings = settings
        self._decider = decider
        self._vector_store_factory = vector_store_factory
        self._on_run_changed = on_run_changed
        self._lock = asyncio.Lock()
        self._current: RunHandle | None = None
        self._world_config: WorldConfig | None = None
        self._settled: set[str] = set()

    # -- Read side ----------------------------------------------------------

    @property
    def current(self) -> RunHandle | None:
        """Return the live (or last) run, or ``None`` if none has started."""
        return self._current

    @property
    def simulation(self) -> Simulation | None:
        """Return the live (or last) simulation, or ``None`` if none has started."""
        return self._current.simulation if self._current is not None else None

    def require_run(self) -> RunHandle:
        """Return the current run or fail loudly.

        Returns:
            The current :class:`RunHandle`.

        Raises:
            RunNotStartedError: If no run has ever been started.
        """
        if self._current is None:
            raise RunNotStartedError("No run has been started.")
        return self._current

    def world_config(self) -> WorldConfig:
        """Return the locked world config, reading and validating it once.

        Returns:
            The validated :class:`~config.schema.WorldConfig`.

        Raises:
            ConfigError: If ``world.yaml`` is missing or invalid.
        """
        if self._world_config is None:
            self._world_config = load_world_config(self._settings.config_path)
        return self._world_config

    def defaults(self) -> dict[str, object]:
        """Return the ``GET /api/run/defaults`` body.

        Returns:
            Defaults, per-knob bounds and labels, and the locked region rail.
        """
        return run_defaults_payload(self.world_config())

    def default_config(self) -> RunConfig:
        """Return the configuration the screen (and the process run) opens with."""
        return default_run_config(self.world_config())

    # -- Write side ---------------------------------------------------------

    async def start_process_run(
        self,
        *,
        seed: int,
        provider: str,
        memory_root: str | Path,
        duration: float | None,
    ) -> RunHandle:
        """Start the run this *process* was launched with, unchanged from before.

        Deliberately **not** routed through :meth:`start`. The process-launched run
        keeps the pre-API wiring exactly: the world comes from ``world.yaml`` via
        :func:`~config.loader.load_config`, the world rules are the repository
        constants, and memory goes to the configured root rather than a fresh per-run
        one. Namespacing it here would change what a being wakes up remembering on the
        second process start, which is simulation behaviour, not plumbing.

        A ``RunConfig`` *describing* that run is recorded so ``GET /api/run/config``
        answers honestly even for a run nobody configured. It is built by copy rather
        than by validation, because it reports what a run *is*, not what a viewer may
        ask for -- a CLI ``--duration 10`` is legitimate and must not be rejected here.

        Args:
            seed: The process's world seed.
            provider: The process's decider backend.
            memory_root: The process's memory root, used as-is.
            duration: The process's run length, or ``None`` for unbounded.

        Returns:
            The launched :class:`RunHandle`.
        """
        async with self._lock:
            config = self.default_config().model_copy(
                update={
                    "seed": seed,
                    "provider": provider,
                    "duration_seconds": duration,
                }
            )
            simulation = build_simulation(
                self._settings.config_path,
                seed=seed,
                model=self._resolve_model(provider),
                provider=provider,
                context_window=self._resolve_context_window(provider),
                memory_root=memory_root,
                run_dir=self._settings.run_dir,
                feed_maxlen=self._settings.feed_maxlen,
                decider=self._decider,
                vector_store_factory=self._vector_store_factory,
            )
            simulation.run_context.mark_starting()
            return self._launch(simulation, config, [])

    async def start(self, config: RunConfig) -> dict[str, object]:
        """Start a run, replacing whatever was running.

        Serialised on the manager's lock, so two starts arriving together are applied
        one after the other rather than racing: the previous run is signalled, awaited
        and finalised *before* the next world is assembled. Nothing is torn down until
        the new configuration has produced a world, so a build failure leaves the
        previous run untouched.

        Args:
            config: The validated configuration to start.

        Returns:
            The 202 body: ``run_id``, ``status`` (``"starting"``) and any non-blocking
            ``warnings`` raised while accepting the configuration.

        Side effects:
            Stops and awaits the previous run; creates a fresh per-run memory root;
            writes this run's artifacts beneath a new run directory.
        """
        async with self._lock:
            world_config = self.world_config()
            world = build_run_world(config, world_config)
            warnings = warnings_for(config, regions=list(world.get_all_regions()))

            await self._stop_current()

            memory_root = derive_memory_root(self._settings.memory_root)
            model = self._resolve_model(config.provider)
            simulation = build_simulation(
                self._settings.config_path,
                seed=config.seed,
                model=model,
                provider=config.provider,
                context_window=self._resolve_context_window(config.provider),
                memory_root=memory_root,
                run_dir=self._settings.run_dir,
                feed_maxlen=self._settings.feed_maxlen,
                decider=self._decider,
                vector_store_factory=self._vector_store_factory,
                world=world,
            )
            simulation.run_context.mark_starting()
            handle = self._launch(simulation, config, warnings)
            logger.info(
                "Run %s starting: %d beings, provider=%s, abundance=%.2fx, "
                "mating proposal lifetime %.0fs, memory root %s.",
                handle.run_id,
                len(config.beings),
                config.provider,
                config.abundance,
                world.run_settings.mating_proposal_timeout_seconds,
                memory_root,
            )
            return {
                "run_id": handle.run_id,
                "status": handle.status,
                "warnings": warnings,
            }

    async def stop(self) -> dict[str, object]:
        """Ask the current run to wind down, returning as soon as it is signalled.

        The run is *signalled*, not cancelled: the runner's single shutdown path
        cancels the breathing tasks, unsubscribes every agent and closes the decider,
        and a background finaliser then writes the last checkpoint. A run that has
        already finished is reported as-is rather than treated as an error.

        Returns:
            The 202 body: ``run_id`` and ``status``.

        Raises:
            RunNotStartedError: If no run has ever been started.
        """
        handle = self.require_run()
        if not handle.task.done() and handle.status != "stopping":
            handle.simulation.run_context.mark_stopping()
            handle.stop_event.set()
            logger.info("Run %s stopping.", handle.run_id)
        return {"run_id": handle.run_id, "status": handle.status}

    async def shutdown(self) -> None:
        """Stop the current run and wait for it, for process exit."""
        async with self._lock:
            await self._stop_current()

    # -- Internals ----------------------------------------------------------

    def _launch(
        self,
        simulation: Simulation,
        config: RunConfig,
        warnings: list[str],
    ) -> RunHandle:
        """Start the breathing task for an assembled simulation.

        Args:
            simulation: The assembled bundle.
            config: The configuration it was built from.
            warnings: Non-blocking cautions to echo back to the caller.

        Returns:
            The new :class:`RunHandle`, already recorded as current.
        """
        stop_event = asyncio.Event()
        task = asyncio.create_task(
            run_simulation(
                simulation,
                pace=self._settings.pace,
                duration=config.duration_seconds,
                world_tick_interval=self._settings.world_tick_interval,
                refresh_interval=self._settings.refresh_interval,
                terminal_ui=False,
                install_signal_handlers=False,
                stop_event=stop_event,
            ),
            name="vivarium-live-run",
        )
        handle = RunHandle(
            simulation=simulation,
            config=config,
            stop_event=stop_event,
            task=task,
            warnings=warnings,
        )
        try:
            update_recording_sidecar(
                simulation.run_context,
                region_name=_recording_region_name(simulation.world),
                status=simulation.run_context.status,
            )
        except OSError:
            logger.exception("Could not persist starting metadata for run %s.", handle.run_id)
        handle.watcher = asyncio.create_task(
            self._watch(handle), name=f"vivarium-run-watch:{handle.run_id}"
        )
        self._current = handle
        if self._on_run_changed is not None:
            self._on_run_changed(handle)
        return handle

    async def _watch(self, handle: RunHandle) -> None:
        """Await one run to its end and record how it ended.

        Never raises: :func:`asyncio.gather` with ``return_exceptions=True`` turns a
        crashed run into a value, which both retrieves the task's exception (so the
        loop does not log an unretrieved one) and lets the terminal status be recorded
        either way. This is also what makes a run that ends *by itself* -- its duration
        elapsed, every being died, the ecology collapsed -- report ``stopped`` and
        leave a final checkpoint without a viewer pressing anything.

        Args:
            handle: The run to watch.

        Returns:
            None.
        """
        outcome = (await asyncio.gather(handle.task, return_exceptions=True))[0]
        if isinstance(outcome, BaseException) and not isinstance(outcome, asyncio.CancelledError):
            logger.error("Run %s ended with an error.", handle.run_id, exc_info=outcome)
            handle.simulation.run_context.mark_failed()
        self._settle(handle)

    async def _stop_current(self) -> None:
        """Signal the current run, wait for it, and settle it. Idempotent.

        Callers hold :attr:`_lock`, so this is the one place a run is torn down: a
        replacing start and a process shutdown cannot race each other, and neither can
        leave a breathing task behind.

        Returns:
            None.
        """
        handle = self._current
        if handle is None:
            return
        if not handle.task.done() and handle.status != "stopping":
            handle.simulation.run_context.mark_stopping()
        handle.stop_event.set()
        await self._await_watcher(handle)
        self._settle(handle)

    async def _await_watcher(self, handle: RunHandle) -> None:
        """Wait for a run to finish, cancelling it if it overruns the stop budget.

        The watcher is shielded so the timeout cancels the *run*, not the bookkeeping
        that records how it ended.

        Args:
            handle: The run being waited on.

        Returns:
            None.
        """
        watcher = handle.watcher
        if watcher is None:  # pragma: no cover - a handle always launches with one
            return
        try:
            await asyncio.wait_for(
                asyncio.shield(watcher),
                timeout=self._settings.shutdown_timeout,
            )
        except TimeoutError:
            logger.warning(
                "Run %s did not stop within %.1fs; cancelling it.",
                handle.run_id,
                self._settings.shutdown_timeout,
            )
            handle.task.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

    def _settle(self, handle: RunHandle) -> None:
        """Record a run's terminal status and write its last checkpoint, once.

        Args:
            handle: The finished run.

        Returns:
            None.
        """
        if handle.status not in {"stopped", "failed"}:
            handle.simulation.run_context.mark_stopped()
        try:
            update_recording_sidecar(
                handle.simulation.run_context,
                region_name=_recording_region_name(handle.simulation.world),
                status=handle.status,
                ended_at=time.time(),
            )
        except OSError:
            logger.exception("Could not persist terminal metadata for run %s.", handle.run_id)
        self._write_final_checkpoint(handle)

    def _write_final_checkpoint(self, handle: RunHandle) -> None:
        """Append the run's last world snapshot to the durable archive.

        Idempotent: a stop followed by a replacement and then process shutdown must
        not append three copies of the same closing snapshot.

        Args:
            handle: The finished run.

        Returns:
            None.
        """
        simulation = handle.simulation
        if simulation.run_context.run_id in self._settled:
            return
        self._settled.add(simulation.run_context.run_id)
        try:
            simulation.snapshot_log.write_snapshot(
                simulation.world,
                simulation.run_context,
                event_cursor=simulation.feed_log.current_cursor,
                reason=FINAL_CHECKPOINT_REASON,
            )
        except Exception:
            logger.exception(
                "Could not write the final checkpoint for run %s.",
                simulation.run_context.run_id,
            )

    def _resolve_model(self, provider: str) -> str:
        """Return the model name for a provider.

        Args:
            provider: The run's decider backend.

        Returns:
            The configured override, else the provider's default model.
        """
        if self._settings.model is not None:
            return self._settings.model
        return resolve_default_model(provider)

    def _resolve_context_window(self, provider: str) -> int | None:
        """Return the effective context window for a provider.

        Args:
            provider: The run's decider backend.

        Returns:
            The configured override, else the provider default (262,144 for MLX,
            720,000 for Gemini, or ``None`` for Ollama's agent default).
        """
        return resolve_context_window(provider, self._settings.context_window)

    def derived_summary(self, config: RunConfig) -> dict[str, object]:
        """Return the values this run derived rather than accepted.

        Reported beside ``GET /api/run/config`` so a viewer can see *what* the server
        decided on their behalf, without those values ever becoming submittable.

        Args:
            config: The configuration the run started with.

        Returns:
            A JSON-ready mapping.
        """
        handle = self._current
        memory_root = str(handle.simulation.run_context.memory_root) if handle is not None else None
        return {
            "mating_proposal_timeout_seconds": derive_mating_proposal_timeout(
                config.provider, len(config.beings)
            ),
            "memory_root": memory_root,
        }


def _recording_region_name(simulation_world: object) -> str | None:
    """Return the first deterministic region label without coupling metadata to config."""
    get_all_regions = getattr(simulation_world, "get_all_regions", None)
    if not callable(get_all_regions):
        return None
    regions = sorted(get_all_regions(), key=lambda region: region.name)
    return regions[0].name if regions else None

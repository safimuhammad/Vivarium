"""The multi-agent runner: assemble the world and *press play* (Sprint 6 F1).

This is the entry point the design has been building toward (``CLAUDE.md`` Section 1):
"set initial conditions, press play, perceive". It assembles one shared
:class:`~world.world.WorldState`, :class:`~bus.event_bus.EventBus`,
:class:`~tools.registry.ToolRegistry`, and serialized
:class:`~agents.decider.Decider`, builds 4-5 breathing :class:`~agents.runtime.Agent`\\ s,
and runs them concurrently over one shared local MLX or Ollama model alongside the
world-tick heartbeat and a live ``rich`` activity feed.

Two public functions split assembly from lifecycle so the whole thing is testable
with a mocked decider and a tiny ``duration``:

* :func:`build_simulation` -- pure-ish assembly into a typed :class:`Simulation`
  bundle (no tasks started).
* :func:`run_simulation` -- start every task, then funnel ``--duration`` expiry,
  SIGINT, an all-dead world, and the all-paralyzed collapse watch through **one**
  ``finally`` cleanup (cancel tasks, unsubscribe every agent, render a final
  summary). :func:`main` is the thin CLI wrapper.

Shutdown is a single path on purpose: however the run ends, teardown is identical.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import signal
import subprocess
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Final

from dotenv import load_dotenv
from rich.console import Console

from agents.decider import AsyncCloseable, Decider, SerializingDecider, make_default_decider
from agents.runtime import Agent
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from config.loader import load_config
from core.constants import MOVE_ENERGY_COST
from core.logging import configure_rich_logging, get_logger
from core.run_knobs import PROVIDER_CHOICES
from memory.embedding import default_embedding_function
from memory.store import FileMemoryStore
from memory.vector_store import ChromaVectorStore, VectorStore
from observability.activity_feed import render_world_table, run_activity_feed
from observability.checkpoints import JsonlSnapshotCheckpointLog, SnapshotCheckpointEventLog
from observability.event_log import CompositeEventLog, FeedEventLog
from observability.replay_archive import ReplayArchive
from observability.run_context import RunContext, build_run_context
from observability.snapshot import serialize_region
from observability.usage import JsonlUsageLog
from server.recordings import update_recording_sidecar, write_recording_sidecar
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.spatial import (
    SpatialNavigationError,
    SpatialNavigationEvent,
    SpatialWorld,
    SpatialWorldBundle,
    spatial_travel_event_payload,
)
from world.tick import run_world_tick
from world.world import WorldState

logger = get_logger(__name__)

#: Consecutive zero-ALIVE world-ticks the collapse watch tolerates before it
#: declares the ecology collapsed and shuts the run down cleanly. A combat wave can
#: leave every agent PARALYZED with no one left to feed anyone; the breathing loops
#: would then spin forever (drain-only) with nothing able to progress. Treating that
#: as an observable *outcome* (not a hang) is the design's mitigation (spec Section 8).
COLLAPSE_ZERO_ALIVE_TICKS: int = 3

#: argparse defaults for a real (live-model) run. The fast tests bypass argparse and
#: call :func:`run_simulation` directly with their own tiny values.
DEFAULT_CONFIG: str = "config/world.yaml"
DEFAULT_SEED: int = 7
DEFAULT_PROVIDER: str = "mlx"
#: Default model per provider; ``--model`` overrides, else the provider picks its own.
DEFAULT_MODEL: str = "qwen3:8b"
DEFAULT_MLX_MODEL: str = "mlx-community/Qwen3.5-0.8B-bf16"
DEFAULT_GEMINI_MODEL: str = "gemini-3.1-flash-lite"
DEFAULT_MLX_CONTEXT_TOKENS: int = 262_144
#: Effective context window (tokens) for the hosted Gemini path. Sized so compaction
#: triggers near 500K tokens (0.70 * (window - generation reserve)), staying safely under
#: the model's real ~1M window so agents keep far more lived history before compacting.
#: The local/Ollama path uses the smaller module default (``MODEL_CONTEXT_TOKENS``).
DEFAULT_GEMINI_CONTEXT_TOKENS: int = 720_000
DEFAULT_PACE: float = 1.0
DEFAULT_DURATION: float = 1800.0
DEFAULT_WORLD_TICK_INTERVAL: float = 5.0
DEFAULT_REFRESH_INTERVAL: float = 2.0
DEFAULT_MEMORY_ROOT: str = "runs/memory"
DEFAULT_RUN_DIR: str = "runs"
SPATIAL_NAVIGATOR_INTERVAL: float = 0.25
"""Seconds between navigation transition checks; independent from ecology ticks."""
SPATIAL_EXPORT_TIMEOUT_SECONDS: float = 30.0
"""Maximum wall time for the local production-map export during assembly."""
_SPATIAL_EXPORTER_PATH: Final[Path] = (
    Path(__file__).resolve().parents[1] / "frontend" / "scripts" / "export-navigation.mjs"
)

_PROVIDER_DEFAULT_MODELS: Final[dict[str, str]] = {
    "mlx": DEFAULT_MLX_MODEL,
    "ollama": DEFAULT_MODEL,
    "gemini": DEFAULT_GEMINI_MODEL,
}
_PROVIDER_CONTEXT_WINDOWS: Final[dict[str, int | None]] = {
    "mlx": DEFAULT_MLX_CONTEXT_TOKENS,
    "ollama": None,
    "gemini": DEFAULT_GEMINI_CONTEXT_TOKENS,
}


def resolve_default_model(provider: str) -> str:
    """Return the model selected when a provider has no explicit override.

    Args:
        provider: Decider backend name.

    Returns:
        The provider's model default. Unknown providers retain the historical
        Ollama model value so an unsupported provider still fails at the factory
        boundary rather than silently becoming MLX or Gemini.
    """
    return _PROVIDER_DEFAULT_MODELS.get(provider, DEFAULT_MODEL)


def resolve_context_window(provider: str, override: int | None = None) -> int | None:
    """Return the context window for a provider, honoring an explicit override.

    Args:
        provider: Decider backend name.
        override: Caller-selected context window, or None for the provider default.

    Returns:
        The effective context window, or None when the provider uses the agent's
        module default.
    """
    if override is not None:
        return override
    return _PROVIDER_CONTEXT_WINDOWS.get(provider)


def _spatial_export_input(world: WorldState, *, seed: int) -> dict[str, object] | None:
    """Return the exact production-map exporter input for every configured region.

    Region order follows the authoritative snapshot serializer so the backend and
    browser hand the recipe factory the same normalized topology.  Pressure is
    captured at assembly time, before the first ecology tick, and is retained in
    the generated artifact as the recipe's concrete input.

    Args:
        world: Fully assembled world before any run tasks begin.
        seed: Run seed used by the production map identity.

    Returns:
        Exporter input, or ``None`` for a world without regions.
    """
    regions = [
        serialize_region(region)
        for region in sorted(world.get_all_regions(), key=lambda item: item.name)
    ]
    if not regions:
        return None
    pressures = {item.region: item for item in world.get_region_pressure()}
    return {
        "seed": seed,
        "regions": regions,
        "initial_pressures": {
            region["name"]: {
                "populationHighWater": pressures[str(region["name"])].population_high_water,
                "builtFootprintHighWater": pressures[
                    str(region["name"])
                ].built_footprint_high_water,
            }
            for region in regions
        },
    }


def _attach_exported_spatial_navigation(
    world: WorldState,
    run_context: RunContext,
    *,
    seed: int,
) -> Path | None:
    """Export and attach all concrete regional maps for this run.

    The exporter runs locally through Vite SSR and is the sole bridge to the
    production map recipe.  Python never recreates frontend map generation or
    substitutes a static seed artifact.  The frozen input and output remain in
    the run directory for replay inspection and reconnecting observers receive
    the same identity through snapshots.

    Args:
        world: Live world to attach after a successful export.
        run_context: Run artifact directory and metadata.
        seed: Concrete run seed.

    Returns:
        Generated navigation artifact path, or ``None`` for empty worlds or
        test/reconnect worlds with explicitly attached maps.

    Raises:
        RuntimeError: If the local exporter is absent, fails, or emits invalid map
            data. Failing loudly prevents backend/render map divergence.
    """
    if world.spatial_by_region:
        return None
    export_input = _spatial_export_input(world, seed=seed)
    if export_input is None:
        return None
    if not _SPATIAL_EXPORTER_PATH.is_file():
        raise RuntimeError(f"Spatial navigation exporter is missing: {_SPATIAL_EXPORTER_PATH}")
    input_path = run_context.run_dir / "spatial-navigation-input.json"
    output_path = run_context.run_dir / "spatial-navigation-v2.json"
    input_path.write_text(
        json.dumps(export_input, allow_nan=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    command = [
        "node",
        str(_SPATIAL_EXPORTER_PATH),
        "--input",
        str(input_path),
        "--output",
        str(output_path),
    ]
    try:
        result = subprocess.run(
            command,
            cwd=_SPATIAL_EXPORTER_PATH.parents[2],
            capture_output=True,
            check=False,
            text=True,
            timeout=SPATIAL_EXPORT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Spatial navigation export requires local Node.js on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"Spatial navigation export timed out after {SPATIAL_EXPORT_TIMEOUT_SECONDS:g} seconds."
        ) from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "no exporter output"
        raise RuntimeError(f"Spatial navigation export failed: {detail}")
    try:
        bundle = SpatialWorldBundle.from_path(output_path)
    except Exception as exc:
        raise RuntimeError(f"Spatial navigation export was invalid: {exc}") from exc
    expected_regions = set(world.regions)
    actual_regions = {spatial.region_id for spatial in bundle.regions}
    if actual_regions != expected_regions:
        raise RuntimeError(
            f"Spatial navigation regions {sorted(actual_regions)!r} do not match "
            f"the world regions {sorted(expected_regions)!r}."
        )
    world.attach_spatials(bundle.regions)
    return output_path


@dataclass(slots=True)
class Simulation:
    """The assembled, not-yet-running simulation bundle.

    A typed container so the runner's wiring is explicit (and ``mypy --strict``
    clean): :func:`build_simulation` returns one of these and :func:`run_simulation`
    consumes it. All agents share the single ``world``, ``bus``, and ``decider``.

    Attributes:
        world: The single source of truth all agents mutate through tools.
        bus: The shared event bus routing events into per-agent inboxes.
        agents: The breathing agents (already subscribed to ``bus`` at construction).
        decider: The shared, serialized decider (one agent thinks at a time).
        feed_log: The bounded ring-buffer sink the live activity feed polls.
        run_context: Metadata and artifact paths for this run.
        snapshot_log: Durable world-snapshot checkpoint writer for exact replay.
        replay_archive: Lossless segmented durable storage shared by events and checkpoints.
        spawn_agent: Factory that builds a breathing :class:`~agents.runtime.Agent` for an
            :class:`~world.agents.AgentState` (same registry / decider / per-agent memory
            wiring as the initial agents). Used by the spawn-watcher to start offspring
            breathing mid-run; the built agent is already bus-subscribed (via its
            constructor) but not yet running.
    """

    world: WorldState
    bus: EventBus
    agents: list[Agent]
    decider: Decider
    feed_log: FeedEventLog
    run_context: RunContext
    snapshot_log: JsonlSnapshotCheckpointLog
    replay_archive: ReplayArchive
    spawn_agent: Callable[[AgentState], Agent]


def build_simulation(
    config_path: str | Path,
    *,
    seed: int,
    model: str,
    memory_root: str | Path,
    run_dir: str | Path,
    provider: str = DEFAULT_PROVIDER,
    context_window: int | None = None,
    feed_maxlen: int = 512,
    decider: Decider | None = None,
    vector_store_factory: Callable[[str], VectorStore] | None = None,
    world: WorldState | None = None,
) -> Simulation:
    """Assemble a :class:`Simulation` from a world config (no tasks started).

    Pipeline: load the seeded world; build the event log fan-out
    (:class:`~observability.event_log.JsonlEventLog` for durable replay +
    :class:`~observability.event_log.FeedEventLog` for the live view) behind a
    :class:`~observability.event_log.CompositeEventLog`; wire the bus, tool registry,
    and built-in tools; pick the decider and wrap it in a single shared
    :class:`~agents.decider.SerializingDecider` (the single-Ollama constraint); then
    build one breathing :class:`~agents.runtime.Agent` per configured agent, each with
    a per-agent :class:`~memory.store.FileMemoryStore`.

    Agents subscribe to the bus in :class:`~agents.runtime.Agent`'s constructor, so
    this function never subscribes them again.

    Args:
        config_path: Path to the ``world.yaml`` describing regions and agents.
        seed: RNG seed threaded into the world for a reproducible run. Artifacts are
            isolated beneath the generated run id rather than named by seed alone.
        model: Model name for the default decider; ignored when ``decider`` is
            supplied. Interpreted per ``provider`` (an MLX model for ``"mlx"``, an
            Ollama model for ``"ollama"``, or a hosted model for ``"gemini"``).
        memory_root: Root directory under which each agent's ``<agent_id>/`` memory
            directory is created (``FileMemoryStore`` appends the id itself).
        run_dir: Directory the JSONL replay log is written into.
        provider: Decider backend to build when ``decider`` is ``None`` -- ``"mlx"``
            (the default local backend) and ``"ollama"`` are serialized one-at-a-time;
            ``"gemini"`` is hosted and left UNserialized so agents breathe concurrently.
        feed_maxlen: Number of recent events retained by the live feed ring buffer.
        decider: Optional pre-built decider (tests inject a mock); when ``None`` a
            production :func:`~agents.decider.make_default_decider` is built for
            ``model``. Either way it is serialized (unless already a
            :class:`~agents.decider.SerializingDecider`).
        vector_store_factory: Optional ``agent_id -> VectorStore`` factory (tests
            inject a fast in-memory fake); when ``None`` a persistent
            :class:`~memory.vector_store.ChromaVectorStore` is created per agent.
        world: Optional pre-built world. The run-lifecycle API assembles its own
            (the config file's locked regions, scaled by the run's abundance, plus
            the beings the viewer configured and the run's derived
            :class:`~core.run_settings.RunSettings`) and passes it here. When
            ``None`` -- every path that existed before -- the world is loaded from
            ``config_path`` exactly as before. ``config_path`` is still read for the
            run's config hash either way.

    Returns:
        The assembled :class:`Simulation` (agents constructed and bus-subscribed,
        but no asyncio tasks started yet).
    """
    if world is None:
        world = load_config(config_path, seed=seed)

    # Effective context window: an explicit override wins; otherwise each provider
    # receives its declared window. MLX keeps the supplied model's 262,144-token
    # context; Ollama retains its module default; Gemini gets its hosted window.
    resolved_window = resolve_context_window(provider, context_window)

    run_context = build_run_context(
        config_path=config_path,
        seed=seed,
        model=model,
        provider=provider,
        memory_root=memory_root,
        run_dir=run_dir,
        context_window=resolved_window,
    )

    feed = FeedEventLog(maxlen=feed_maxlen)
    replay_archive = ReplayArchive(run_context.run_dir, run_context.run_id)
    _attach_exported_spatial_navigation(world, run_context, seed=seed)
    write_recording_sidecar(
        run_context,
        region_name=_recording_region_name(world),
        status=run_context.status,
    )
    snapshot_log = JsonlSnapshotCheckpointLog(
        run_context.snapshot_log_path,
        archive=replay_archive,
    )
    snapshot_events = SnapshotCheckpointEventLog(
        snapshot_log,
        world=world,
        run_context=run_context,
        event_cursor=lambda: feed.current_cursor,
    )
    bus = EventBus(world, event_log=CompositeEventLog(replay_archive, feed, snapshot_events))

    # Token-usage sink, a sibling of the replay log: per-decision input/output tokens
    # for cost accounting (read post-hoc by the chronicle). Operator metric, NOT routed
    # through the bus -- agents never perceive it.
    usage_log = JsonlUsageLog(run_context.usage_log_path)

    registry = ToolRegistry(world, bus)
    register_builtins(registry)

    # A NEW variable so the param's ``Decider | None`` is never reassigned to a
    # different type (keeps ``mypy --strict`` happy). MLX and Ollama serve one request
    # at a time, so their deciders are serialized exactly once; the Gemini (hosted)
    # path serves requests in parallel, so it is left UNserialized.
    inner: Decider = (
        decider if decider is not None else make_default_decider(model, provider=provider)
    )
    serialized: Decider = (
        inner
        if (provider == "gemini" or isinstance(inner, SerializingDecider))
        else SerializingDecider(inner)
    )

    shared_embedder = default_embedding_function() if vector_store_factory is None else None

    def _real_vector_store(agent_id: str) -> VectorStore:  # pragma: no cover - prod path
        """Build a persistent per-agent Chroma vector store (production default)."""
        assert shared_embedder is not None
        return ChromaVectorStore(
            agent_id,
            shared_embedder,
            path=Path(memory_root) / agent_id / "chroma",
        )

    make_vector_store = vector_store_factory or _real_vector_store

    def spawn_agent(state: AgentState) -> Agent:
        """Build one breathing agent (the single place that knows the wiring).

        Used both for the initial roster and by the runner's spawn-watcher for
        offspring born mid-run, so an offspring is wired identically to a founder.
        ``Agent.__init__`` subscribes it to the bus; ``pace=0.0`` is overridden by
        ``agent.run(pace=...)`` at launch.
        """
        memory = FileMemoryStore(
            state.id,
            Path(memory_root),
            persona=state.persona,
            vector_store=make_vector_store(state.id),
            clock=world.now,
        )
        return Agent(
            state.id,
            world,
            bus,
            registry,
            serialized,
            pace=0.0,
            memory=memory,
            usage_log=usage_log,
            model=model,
            context_window=resolved_window,
        )

    agents: list[Agent] = [spawn_agent(state) for state in world.get_all_agents()]

    logger.info(
        "Built simulation: %d agents, %d regions (seed=%s).",
        len(agents),
        len(world.get_all_regions()),
        seed,
    )
    return Simulation(
        world=world,
        bus=bus,
        agents=agents,
        decider=serialized,
        feed_log=feed,
        run_context=run_context,
        snapshot_log=snapshot_log,
        replay_archive=replay_archive,
        spawn_agent=spawn_agent,
    )


def _count_alive(world: WorldState, agents: Sequence[Agent]) -> int:
    """Count how many of the *breathing* ``agents`` are currently ``ALIVE``.

    Reasons about the breathing set (the agents with a running loop), not the whole
    world population, reading each one's status live from ``world``. Offspring added
    by ``accept_mating`` do not yet breathe (deferred to the spawn-watcher), so an
    inert ALIVE offspring must not read as a live, progressing agent -- otherwise it
    would mask a fully-paralyzed world and hang the collapse-watch.

    Args:
        world: The live world state (source of each agent's current status).
        agents: The breathing agents to consider.

    Returns:
        The number of ``agents`` whose live world status is ``ALIVE``.
    """
    alive = 0
    for agent in agents:
        state = world.get_agent(agent.agent_id)
        if state is not None and state.status is AgentStatus.ALIVE:
            alive += 1
    return alive


def _count_present(world: WorldState) -> int:
    """Count agents in the WORLD that are not ``DEAD`` (ALIVE or PARALYZED).

    "Present" means at least one being can still act or be revived. This is scanned over
    the whole world -- not just the breathing set -- on purpose: an offspring added by
    ``accept_mating`` is ALIVE in the world a poll *before* the spawn-watcher adopts it
    into the breathing set. Counting only the breathing set would let the run end at the
    instant of a birth where both parents died in the same mating transaction (a real
    path: commit all energy, mate, die in the trade -- the newborn would be lost). Since
    the spawn-watcher makes every live world agent breathe imminently, a non-DEAD world
    agent legitimately means the world has not ended. (The *collapse* check below stays on
    the breathing set, so an all-paralyzed breathing set still collapses; a transiently
    un-adopted offspring is counted there within a poll or two.)

    Args:
        world: The world to scan (read-only).

    Returns:
        The number of world agents whose status is not ``DEAD``.
    """
    return sum(1 for agent in world.get_all_agents() if agent.status is not AgentStatus.DEAD)


def _recording_region_name(world: WorldState) -> str | None:
    """Return the first deterministic region label for automatic run naming."""
    regions = sorted(world.get_all_regions(), key=lambda region: region.name)
    return regions[0].name if regions else None


async def _publish_spatial_navigation_transition(
    world: WorldState,
    bus: EventBus,
    transition: SpatialNavigationEvent,
    *,
    spatial: SpatialWorld,
) -> None:
    """Publish one queued cancellation or completed arrival from the navigator.

    Args:
        world: Live world whose optional map finalized the transition.
        bus: Shared event bus for durable logging and local delivery.
        transition: Finalized movement transition returned by ``SpatialWorld.tick``.
        spatial: Map that finalized the transition, retained through any handoff.

    Returns:
        None.
    """
    event_type = (
        "spatial_travel_cancelled"
        if transition.kind == "travel_cancelled"
        else "spatial_travel_arrived"
    )
    destination = spatial.get_landmark(transition.travel.destination_id)
    agent = world.get_agent(transition.agent_id)
    name = agent.name if agent is not None else transition.agent_id
    message = (
        f"{name} came to rest."
        if transition.kind == "travel_cancelled"
        else (
            f"{name} arrived at "
            f"{destination.name if destination is not None else transition.travel.destination_id}."
        )
    )
    spatial_state = spatial.snapshot_at_position(
        transition.position,
        transition.timestamp,
        travel=None,
    )
    await bus.publish(
        Event(
            event_type,
            transition.agent_id,
            spatial_travel_event_payload(
                spatial,
                transition.travel,
                position=transition.position,
                spatial_state=spatial_state,
                message=message,
                reason=transition.reason,
            ),
            scope=ScopeType.LOCAL,
            region=spatial.region_id,
            timestamp=transition.timestamp,
        )
    )
    if transition.kind == "travel_arrived" and transition.travel.destination_region is not None:
        try:
            handoff = world.complete_region_travel(spatial, transition)
        except SpatialNavigationError as exc:
            logger.warning("Regional entrance unavailable for %s: %s", transition.agent_id, exc)
            await _publish_spatial_navigation_transition(
                world,
                bus,
                replace(transition, kind="travel_cancelled", reason="region_entry_unavailable"),
                spatial=spatial,
            )
            return
        energy = agent.current_energy if agent is not None else 0.0
        common = {
            "agent_id": handoff.agent_id,
            "from_region": handoff.source_region,
            "to_region": handoff.destination_region,
            "move_energy_cost": MOVE_ENERGY_COST,
            "agent_energy": energy,
            "authoritative_spatial": True,
            "travel_id": handoff.travel_id,
        }
        await bus.publish(
            Event(
                "agent_left_region",
                handoff.agent_id,
                {
                    **common,
                    "source_position": handoff.source_position.to_json(),
                    "message": (
                        f"{name} left {handoff.source_region} for {handoff.destination_region}."
                    ),
                },
                scope=ScopeType.LOCAL,
                region=handoff.source_region,
                timestamp=transition.timestamp,
            )
        )
        await bus.publish(
            Event(
                "agent_entered_region",
                handoff.agent_id,
                {
                    **common,
                    "message": f"{name} entered {handoff.destination_region} at its entrance.",
                },
                scope=ScopeType.LOCAL,
                region=handoff.destination_region,
                timestamp=transition.timestamp,
            )
        )


async def _advance_spatial_navigator(world: WorldState, bus: EventBus) -> None:
    """Finalize due spatial routes once and publish their durable transitions.

    Args:
        world: Live world whose current clock is sampled exactly once.
        bus: Shared event bus receiving transition events.

    Returns:
        None.
    """
    now = world.now()
    for spatial in world.spatial_worlds():
        for transition in spatial.tick(now):
            await _publish_spatial_navigation_transition(world, bus, transition, spatial=spatial)


async def _finalize_spatial_navigation(
    world: WorldState,
    bus: EventBus,
    *,
    now: float,
) -> None:
    """Freeze every regional journey at one terminal world-clock sample.

    Routes due at the terminal sample become arrivals first.  Every remaining
    route then becomes a durable cancellation at that exact coordinate, so a
    stopped run cannot appear to keep walking when an observer later reads it.

    Args:
        world: Live world whose optional map is being stopped.
        bus: Shared event bus for durable terminal navigation transitions.
        now: Single final world-clock sample shared by every route.

    Returns:
        None.
    """
    for spatial in world.spatial_worlds():
        for transition in spatial.tick(now):
            await _publish_spatial_navigation_transition(world, bus, transition, spatial=spatial)
        for agent in world.get_all_agents():
            cancellation = spatial.cancel_travel(agent.id, now, reason="simulation_stopped")
            if cancellation is not None:
                await _publish_spatial_navigation_transition(
                    world, bus, cancellation, spatial=spatial
                )


async def _run_spatial_navigator(
    world: WorldState,
    bus: EventBus,
    stop: asyncio.Event,
    *,
    interval: float = SPATIAL_NAVIGATOR_INTERVAL,
) -> None:
    """Poll persistent journeys independently of the five-second ecology tick.

    Args:
        world: Live world whose optional map is read on each cadence.
        bus: Shared event bus receiving completed route transitions.
        stop: Shared lifecycle stop signal.
        interval: Navigation polling cadence in seconds.

    Returns:
        None.

    Raises:
        ValueError: If ``interval`` is not positive.
    """
    if interval <= 0:
        raise ValueError("spatial navigator interval must be positive")
    while not stop.is_set():
        await _advance_spatial_navigator(world, bus)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            continue


async def _liveness_watch(
    world: WorldState, agents: Sequence[Agent], stop: asyncio.Event, *, interval: float
) -> None:
    """Poll the breathing set and ``stop`` the run when the world has truly ended.

    Replaces the old fixed-list ``gather`` (which could not see offspring) with a poll
    over the *dynamic* breathing ``agents`` list, so a living lineage keeps the run
    going while a dead or wedged world still terminates. Two stop conditions:

    * **World ended** -- :func:`_count_present` is 0: every agent in the *world* is DEAD
      (scanned world-wide, not just the breathing set, so a just-born offspring not yet
      adopted by the spawn-watcher still counts). Stop immediately. (Polling adds up to
      one ``interval`` of latency vs the old event-driven path -- intentional, so the
      dynamic set is handled uniformly.)
    * **Collapse** -- :func:`_count_alive` is 0 for :data:`COLLAPSE_ZERO_ALIVE_TICKS`
      consecutive polls while some agents are still PARALYZED (present but unable to act
      and with no one left to feed them). An observable outcome, not a hang.

    Args:
        world: The world to read each breathing agent's status from (read-only).
        agents: The breathing agents (grows as offspring are spawned).
        stop: The shared stop event funnelling into the single shutdown path.
        interval: Seconds between polls (aligned with the world-tick interval).

    Returns:
        None.
    """
    consecutive_zero_alive = 0
    while not stop.is_set():
        await asyncio.sleep(interval)
        if _count_present(world) == 0:
            logger.info("Every agent in the world is dead; the world has ended. Stopping.")
            stop.set()
            return
        if _count_alive(world, agents) == 0:
            consecutive_zero_alive += 1
            if consecutive_zero_alive >= COLLAPSE_ZERO_ALIVE_TICKS:
                logger.warning(
                    "Ecology collapsed: no ALIVE agents for %d consecutive ticks; stopping.",
                    consecutive_zero_alive,
                )
                stop.set()
                return
        else:
            consecutive_zero_alive = 0


def _spawn_new_agents(
    world: WorldState,
    sim: Simulation,
    run_agent: Callable[[Agent], Coroutine[Any, Any, None]],
    agent_tasks: list[asyncio.Task[None]],
    known: set[str],
) -> None:
    """Detect agents in the world not yet breathing and launch their loops (one pass).

    For each world agent whose id is not in ``known`` (an offspring born via
    ``accept_mating``), builds it through :attr:`Simulation.spawn_agent` (which
    subscribes it to the bus), appends it to the breathing set ``sim.agents`` and to the
    shared ``agent_tasks`` list, and starts its ``run`` task. The mutations contain no
    ``await``, so they are atomic with respect to other cooperatively-scheduled readers
    (the liveness watch, the shutdown loop).

    Args:
        world: The live world state to scan for new agents.
        sim: The simulation bundle (its ``agents`` list and ``spawn_agent`` factory).
        run_agent: The runner's per-agent driver (unsubscribes the inbox on exit).
        agent_tasks: The shared, growing list of agent run tasks (mutated in place).
        known: The set of agent ids already breathing (mutated in place).

    Returns:
        None.
    """
    for state in world.get_all_agents():
        if state.id in known:
            continue
        agent = sim.spawn_agent(state)  # Agent.__init__ subscribes it to the bus
        sim.agents.append(agent)
        agent_tasks.append(asyncio.create_task(run_agent(agent), name=f"agent:{state.id}"))
        known.add(state.id)
        logger.info("New agent %r was born and began breathing.", state.id)


async def _spawn_watch(
    world: WorldState,
    sim: Simulation,
    run_agent: Callable[[Agent], Coroutine[Any, Any, None]],
    agent_tasks: list[asyncio.Task[None]],
    known: set[str],
    stop: asyncio.Event,
    *,
    interval: float,
) -> None:
    """Poll for newborn agents every ``interval`` and start them breathing.

    The single place reproduction becomes real: offspring added to the world by
    ``accept_mating`` would otherwise never breathe. Re-checks ``stop`` after the sleep
    so it never spawns a task during teardown (the spawned tasks are folded into the
    shutdown via the shared ``agent_tasks``/``sim.agents``).

    Args:
        world: The live world state to scan.
        sim: The simulation bundle.
        run_agent: The runner's per-agent driver.
        agent_tasks: The shared agent-task list (new tasks are appended here).
        known: Ids already breathing (seeded with the initial roster).
        stop: The shared stop event; the loop exits and never spawns once it is set.
        interval: Seconds between detection passes.

    Returns:
        None.
    """
    while not stop.is_set():
        await asyncio.sleep(interval)
        if stop.is_set():  # do not spawn during teardown
            return
        try:
            _spawn_new_agents(world, sim, run_agent, agent_tasks, known)
        except Exception:
            # Isolate a bad detection pass (e.g. building one offspring's memory store
            # raises) so a transient error can't permanently stop ALL future
            # reproduction -- the same crash-resistance the world-tick/feed drivers use.
            logger.exception("spawn-watch pass failed; skipping it to keep adopting newborns")


def _install_signal_handlers(stop: asyncio.Event) -> Callable[[], None]:
    """Funnel SIGINT/SIGTERM into ``stop`` so Ctrl-C uses the one shutdown path.

    Best-effort: a non-main thread or a platform without
    :meth:`~asyncio.loop.add_signal_handler` (e.g. inside the test event loop)
    silently skips installation -- ``--duration`` is always the backstop.

    Args:
        stop: The shared stop event the handlers set.

    Returns:
        A zero-argument cleanup callable that removes any handlers installed.
    """
    loop = asyncio.get_running_loop()
    installed: list[signal.Signals] = []
    for sig in (signal.SIGINT, signal.SIGTERM):
        # pragma: no cover - platform/thread dependent
        with contextlib.suppress(NotImplementedError, RuntimeError, ValueError):
            loop.add_signal_handler(sig, stop.set)
            installed.append(sig)

    def _remove() -> None:
        for sig in installed:  # pragma: no cover - mirrors install path
            with contextlib.suppress(NotImplementedError, RuntimeError, ValueError):
                loop.remove_signal_handler(sig)

    return _remove


def _render_summary(console: Console, world: WorldState, feed: FeedEventLog) -> None:
    """Render the final world snapshot and log the recorded-event total.

    Args:
        console: The shared ``rich`` console to print the snapshot to.
        world: The world to snapshot one last time (read-only).
        feed: The feed log whose monotonic count is the events-recorded total.

    Returns:
        None.

    Side effects:
        Prints the world table to ``console`` and emits one INFO log line.
    """
    total_events = feed.current_cursor
    console.print(render_world_table(world))
    logger.info("Run complete: %d events recorded.", total_events)


async def run_simulation(
    sim: Simulation,
    *,
    pace: float,
    duration: float | None,
    world_tick_interval: float,
    refresh_interval: float,
    console: Console | None = None,
    terminal_ui: bool = True,
    install_signal_handlers: bool = True,
    stop_event: asyncio.Event | None = None,
) -> None:
    """Run an assembled :class:`Simulation` to completion through one shutdown path.

    Publishes a GLOBAL ``simulation_started`` lifecycle event (so the run is
    observable from its first line and the event pipeline is exercised), then starts:
    one ``run()`` task per agent (each unsubscribing its inbox in a ``finally`` when it
    exits), the world-tick heartbeat, optionally the terminal activity feed, the
    collapse watch, and a watcher that signals stop once all agents have died.
    ``--duration`` bounds the run via :func:`asyncio.timeout`; SIGINT, an all-dead
    world, and the collapse watch all set the same ``stop`` event. However the run
    ends, the single ``finally`` cancels every outstanding task, unsubscribes every
    agent, and optionally renders a final terminal summary.

    Args:
        sim: The assembled simulation bundle.
        pace: Inter-breath sleep (seconds) passed to every agent's ``run``.
        duration: Wall-clock bound (seconds) on the whole run, or ``None`` for an
            unbounded run that ends only on a stop, a dead world, or a collapse
            (:func:`asyncio.timeout` treats ``None`` as no deadline).
        world_tick_interval: Seconds between world-ticks (regen + proposal sweep).
        refresh_interval: Seconds between activity-feed re-renders.
        console: Optional shared ``rich`` console (so log output and the live view
            share one stderr console); a fresh ``Console(stderr=True)`` is created
            when ``None`` and ``terminal_ui`` is enabled.
        terminal_ui: Whether to run the terminal activity feed and final summary.
            The CLI keeps this enabled; the browser-facing API server disables it.
        install_signal_handlers: Whether to install SIGINT/SIGTERM handlers. The
            browser-facing server disables this and lets Uvicorn own signals.
        stop_event: Optional externally-owned stop event. When supplied, setting it
            stops this run through the same shutdown path.

    Returns:
        None.

    Side effects:
        Mutates the world via the agents' tools; publishes events on ``sim.bus``;
        unsubscribes every agent from the bus at shutdown; optionally renders to
        ``console``.
    """
    if terminal_ui and console is None:
        console = Console(stderr=True)
    world = sim.world
    bus = sim.bus
    stop = stop_event or asyncio.Event()
    sim.run_context.set_timing(
        pace=pace,
        duration=duration,
        world_tick_interval=world_tick_interval,
        refresh_interval=refresh_interval,
    )
    sim.run_context.mark_running()
    update_recording_sidecar(
        sim.run_context,
        region_name=_recording_region_name(world),
        status=sim.run_context.status,
    )

    async def run_agent(agent: Agent) -> None:
        """Drive one agent's breathing loop, freeing its inbox when it exits."""
        try:
            await agent.run(pace=pace)
        finally:
            bus.unsubscribe(agent.agent_id)

    def write_world_tick_checkpoint() -> None:
        """Write a snapshot checkpoint after one world-tick heartbeat."""
        sim.snapshot_log.write_snapshot(
            world,
            sim.run_context,
            event_cursor=sim.feed_log.current_cursor,
            reason="world_tick",
        )

    # Announce the run so it is observable from line one (and the JSONL + feed
    # pipeline is exercised even before any agent acts).
    await bus.publish(
        Event(
            "simulation_started",
            "world",
            {
                "run_id": sim.run_context.run_id,
                "agent_count": len(sim.agents),
                "world_time": world.now(),
                "message": f"Simulation started: {len(sim.agents)} agents breathing.",
            },
            scope=ScopeType.GLOBAL,
            timestamp=world.now(),
        )
    )

    # The breathing set + its task list GROW as offspring are spawned; both are shared
    # with the spawn-watch (which appends) and the shutdown (which cancels/unsubscribes).
    known: set[str] = {agent.agent_id for agent in sim.agents}
    agent_tasks: list[asyncio.Task[None]] = [
        asyncio.create_task(run_agent(agent), name=f"agent:{agent.agent_id}")
        for agent in sim.agents
    ]
    background_tasks: list[asyncio.Task[None]] = [
        asyncio.create_task(
            run_world_tick(
                world,
                bus,
                interval=world_tick_interval,
                after_tick=write_world_tick_checkpoint,
            ),
            name="world-tick",
        ),
    ]
    if world.spatial_by_region:
        background_tasks.append(
            asyncio.create_task(
                _run_spatial_navigator(world, bus, stop),
                name="spatial-navigator",
            )
        )
    if terminal_ui:
        assert console is not None
        background_tasks.append(
            asyncio.create_task(
                run_activity_feed(
                    sim.feed_log,
                    world,
                    console,
                    refresh_interval=refresh_interval,
                    should_stop=stop.is_set,
                ),
                name="activity-feed",
            )
        )
    background_tasks.extend(
        [
            asyncio.create_task(
                _liveness_watch(world, sim.agents, stop, interval=world_tick_interval),
                name="liveness-watch",
            ),
            asyncio.create_task(
                _spawn_watch(
                    world,
                    sim,
                    run_agent,
                    agent_tasks,
                    known,
                    stop,
                    interval=world_tick_interval,
                ),
                name="spawn-watch",
            ),
        ]
    )

    if install_signal_handlers:
        remove_signal_handlers = _install_signal_handlers(stop)
    else:

        def remove_signal_handlers() -> None:
            return None

    try:
        async with asyncio.timeout(duration):
            await stop.wait()
    except TimeoutError:
        logger.info("Run duration (%.1fs) elapsed; shutting down.", duration or 0.0)
    finally:
        # `stop.set()` (no await before the cancels) is what actually prevents the
        # spawn-watch from creating new tasks during teardown -- its `stop.is_set()`
        # guard is the real mechanism, not cancellation order -- so cancelling all tasks
        # together here is safe. `agent_tasks`/`sim.agents` already include any offspring
        # the spawn-watch appended. The per-agent `run_agent` finally also unsubscribes,
        # so the loop below is an idempotent belt-and-suspenders.
        stop.set()
        for task in (*agent_tasks, *background_tasks):
            task.cancel()
        await asyncio.gather(*agent_tasks, *background_tasks, return_exceptions=True)
        if world.spatial_by_region:
            await _finalize_spatial_navigation(world, bus, now=world.now())
            sim.snapshot_log.write_snapshot(
                world,
                sim.run_context,
                event_cursor=sim.feed_log.current_cursor,
                reason="simulation_stopped",
            )
        for agent in sim.agents:
            bus.unsubscribe(agent.agent_id)
        if isinstance(sim.decider, AsyncCloseable):
            try:
                await sim.decider.aclose()
            except Exception:
                logger.exception("Failed to close the shared decider during shutdown.")
        sim.run_context.mark_stopped()
        update_recording_sidecar(
            sim.run_context,
            region_name=_recording_region_name(world),
            status=sim.run_context.status,
        )
        remove_signal_handlers()
        if terminal_ui:
            assert console is not None
            _render_summary(console, world, sim.feed_log)


def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser for a live run.

    Returns:
        The configured :class:`argparse.ArgumentParser`.
    """
    parser = argparse.ArgumentParser(
        prog="vivarium",
        description="Run the Vivarium multi-agent simulation (press play, perceive).",
    )
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Path to world.yaml.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="RNG seed (reproducible).")
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        choices=PROVIDER_CHOICES,
        help="Decider backend: local 'mlx' (default), local 'ollama', or hosted 'gemini'.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model name; defaults per provider "
        f"({DEFAULT_MLX_MODEL} for mlx, {DEFAULT_MODEL} for ollama, "
        f"{DEFAULT_GEMINI_MODEL} for gemini).",
    )
    parser.add_argument(
        "--context-tokens",
        type=int,
        default=None,
        help="Context window (tokens) for compaction; overrides the per-provider default "
        f"(mlx: {DEFAULT_MLX_CONTEXT_TOKENS}; gemini: {DEFAULT_GEMINI_CONTEXT_TOKENS}, "
        "compacting near 500K; ollama: the module default). Lower it to spend less, "
        "raise it to keep more lived history.",
    )
    parser.add_argument(
        "--pace", type=float, default=DEFAULT_PACE, help="Inter-breath sleep (seconds)."
    )
    parser.add_argument(
        "--duration", type=float, default=DEFAULT_DURATION, help="Run length (seconds)."
    )
    parser.add_argument(
        "--world-tick-interval",
        type=float,
        default=DEFAULT_WORLD_TICK_INTERVAL,
        help="Seconds between world-ticks.",
    )
    parser.add_argument(
        "--refresh-interval",
        type=float,
        default=DEFAULT_REFRESH_INTERVAL,
        help="Seconds between activity-feed re-renders.",
    )
    parser.add_argument(
        "--memory-root", default=DEFAULT_MEMORY_ROOT, help="Root dir for per-agent memory."
    )
    parser.add_argument("--run-dir", default=DEFAULT_RUN_DIR, help="Dir for the JSONL replay log.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - live entry glue
    """CLI entry point: parse args, configure logging, run the simulation.

    Args:
        argv: Optional argument vector (defaults to ``sys.argv[1:]``).

    Returns:
        Process exit code (``0`` on a clean run).
    """
    args = _build_parser().parse_args(argv)

    # Load .env so a hosted provider's key (e.g. GEMINI_API_KEY) is present without the
    # caller exporting it; the key is read inside the SDK, never logged here.
    load_dotenv()

    console = Console(stderr=True)
    configure_rich_logging(console)

    model = args.model or resolve_default_model(args.provider)
    sim = build_simulation(
        args.config,
        seed=args.seed,
        model=model,
        provider=args.provider,
        context_window=args.context_tokens,
        memory_root=args.memory_root,
        run_dir=args.run_dir,
    )
    asyncio.run(
        run_simulation(
            sim,
            pace=args.pace,
            duration=args.duration,
            world_tick_interval=args.world_tick_interval,
            refresh_interval=args.refresh_interval,
            console=console,
        )
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - module executed as a script
    import sys

    sys.exit(main())

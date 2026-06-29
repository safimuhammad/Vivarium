"""The multi-agent runner: assemble the world and *press play* (Sprint 6 F1).

This is the entry point the design has been building toward (``CLAUDE.md`` Section 1):
"set initial conditions, press play, perceive". It assembles one shared
:class:`~world.world.WorldState`, :class:`~bus.event_bus.EventBus`,
:class:`~tools.registry.ToolRegistry`, and serialized
:class:`~agents.decider.Decider`, builds 4-5 breathing :class:`~agents.runtime.Agent`\\ s,
and runs them concurrently over the single (sequential) Ollama alongside the
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
import signal
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console

from agents.decider import Decider, SerializingDecider, make_default_decider
from agents.runtime import Agent
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from config.loader import load_config
from core.logging import configure_rich_logging, get_logger
from memory.embedding import default_embedding_function
from memory.store import FileMemoryStore
from memory.vector_store import ChromaVectorStore, VectorStore
from observability.activity_feed import render_world_table, run_activity_feed
from observability.event_log import CompositeEventLog, FeedEventLog, JsonlEventLog
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentStatus
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
DEFAULT_MODEL: str = "qwen3:8b"
DEFAULT_PACE: float = 1.0
DEFAULT_DURATION: float = 1800.0
DEFAULT_WORLD_TICK_INTERVAL: float = 5.0
DEFAULT_REFRESH_INTERVAL: float = 2.0
DEFAULT_MEMORY_ROOT: str = "runs/memory"
DEFAULT_RUN_DIR: str = "runs"


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
    """

    world: WorldState
    bus: EventBus
    agents: list[Agent]
    decider: Decider
    feed_log: FeedEventLog


def build_simulation(
    config_path: str | Path,
    *,
    seed: int,
    model: str,
    memory_root: str | Path,
    run_dir: str | Path,
    decider: Decider | None = None,
    vector_store_factory: Callable[[str], VectorStore] | None = None,
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
        seed: RNG seed threaded into the world (reproducible run) and used to name
            the JSONL replay file (``run_<seed>.jsonl``).
        model: Ollama model name for the default decider; ignored when ``decider``
            is supplied.
        memory_root: Root directory under which each agent's ``<agent_id>/`` memory
            directory is created (``FileMemoryStore`` appends the id itself).
        run_dir: Directory the JSONL replay log is written into.
        decider: Optional pre-built decider (tests inject a mock); when ``None`` a
            production :func:`~agents.decider.make_default_decider` is built for
            ``model``. Either way it is serialized (unless already a
            :class:`~agents.decider.SerializingDecider`).
        vector_store_factory: Optional ``agent_id -> VectorStore`` factory (tests
            inject a fast in-memory fake); when ``None`` a persistent
            :class:`~memory.vector_store.ChromaVectorStore` is created per agent.

    Returns:
        The assembled :class:`Simulation` (agents constructed and bus-subscribed,
        but no asyncio tasks started yet).
    """
    world = load_config(config_path, seed=seed)

    feed = FeedEventLog()
    jsonl = JsonlEventLog(Path(run_dir) / f"run_{seed}.jsonl")
    bus = EventBus(world, event_log=CompositeEventLog(jsonl, feed))

    registry = ToolRegistry(world, bus)
    register_builtins(registry)

    # A NEW variable so the param's ``Decider | None`` is never reassigned to a
    # different type (keeps ``mypy --strict`` happy); then serialize exactly once.
    inner: Decider = decider if decider is not None else make_default_decider(model)
    serialized: Decider = (
        inner if isinstance(inner, SerializingDecider) else SerializingDecider(inner)
    )

    def _real_vector_store(agent_id: str) -> VectorStore:  # pragma: no cover - prod path
        """Build a persistent per-agent Chroma vector store (production default)."""
        return ChromaVectorStore(
            agent_id,
            default_embedding_function(),
            path=Path(memory_root) / agent_id / "chroma",
        )

    make_vector_store = vector_store_factory or _real_vector_store

    agents: list[Agent] = []
    for state in world.get_all_agents():
        memory = FileMemoryStore(
            state.id,
            Path(memory_root),
            persona=state.persona,
            vector_store=make_vector_store(state.id),
            clock=world.now,
        )
        agents.append(Agent(state.id, world, bus, registry, serialized, pace=0.0, memory=memory))

    logger.info(
        "Built simulation: %d agents, %d regions (seed=%s).",
        len(agents),
        len(world.get_all_regions()),
        seed,
    )
    return Simulation(world=world, bus=bus, agents=agents, decider=serialized, feed_log=feed)


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


async def _watch_agents_done(
    agent_tasks: Sequence[asyncio.Task[None]], stop: asyncio.Event
) -> None:
    """Set ``stop`` once every agent's run task has finished (a fully-DEAD world).

    Each agent's ``run()`` exits naturally on DEAD, so when all of them complete the
    world has ended; signalling ``stop`` funnels that into the single shutdown path.

    Args:
        agent_tasks: The per-agent run tasks to await.
        stop: The shared stop event to set when all tasks are done.

    Returns:
        None.
    """
    await asyncio.gather(*agent_tasks, return_exceptions=True)
    stop.set()


async def _collapse_watch(
    world: WorldState, agents: Sequence[Agent], stop: asyncio.Event, *, interval: float
) -> None:
    """Set ``stop`` after :data:`COLLAPSE_ZERO_ALIVE_TICKS` zero-ALIVE polls in a row.

    Polls the *breathing* ``agents`` every ``interval`` seconds. An all-paralyzed (or
    all-dead) breathing set can never make progress, so rather than spin forever the
    run is declared collapsed -- an observable outcome -- and shut down cleanly via
    ``stop``. Inert offspring (not in ``agents``) are deliberately excluded so they
    cannot mask a collapse.

    Args:
        world: The world to read each breathing agent's status from (read-only).
        agents: The breathing agents whose liveness defines a collapse.
        stop: The shared stop event to set on a sustained collapse.
        interval: Seconds between polls (aligned with the world-tick interval).

    Returns:
        None.
    """
    consecutive_zero = 0
    while not stop.is_set():
        await asyncio.sleep(interval)
        if _count_alive(world, agents) == 0:
            consecutive_zero += 1
            if consecutive_zero >= COLLAPSE_ZERO_ALIVE_TICKS:
                logger.warning(
                    "Ecology collapsed: no ALIVE agents for %d consecutive ticks; stopping.",
                    consecutive_zero,
                )
                stop.set()
                return
        else:
            consecutive_zero = 0


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
    total_events = feed.new_events(0)[1]
    console.print(render_world_table(world))
    logger.info("Run complete: %d events recorded.", total_events)


async def run_simulation(
    sim: Simulation,
    *,
    pace: float,
    duration: float,
    world_tick_interval: float,
    refresh_interval: float,
    console: Console | None = None,
) -> None:
    """Run an assembled :class:`Simulation` to completion through one shutdown path.

    Publishes a GLOBAL ``simulation_started`` lifecycle event (so the run is
    observable from its first line and the event pipeline is exercised), then starts:
    one ``run()`` task per agent (each unsubscribing its inbox in a ``finally`` when it
    exits), the world-tick heartbeat, the live activity feed, the collapse watch, and a
    watcher that signals stop once all agents have died. ``--duration`` bounds the run
    via :func:`asyncio.timeout`; SIGINT, an all-dead world, and the collapse watch all
    set the same ``stop`` event. However the run ends, the single ``finally`` cancels
    every outstanding task, unsubscribes every agent, and renders a final summary.

    Args:
        sim: The assembled simulation bundle.
        pace: Inter-breath sleep (seconds) passed to every agent's ``run``.
        duration: Wall-clock bound (seconds) on the whole run.
        world_tick_interval: Seconds between world-ticks (regen + proposal sweep).
        refresh_interval: Seconds between activity-feed re-renders.
        console: Optional shared ``rich`` console (so log output and the live view
            share one stderr console); a fresh ``Console(stderr=True)`` is created
            when ``None``.

    Returns:
        None.

    Side effects:
        Mutates the world via the agents' tools; publishes events on ``sim.bus``;
        unsubscribes every agent from the bus at shutdown; renders to ``console``.
    """
    if console is None:
        console = Console(stderr=True)
    world = sim.world
    bus = sim.bus
    stop = asyncio.Event()

    async def run_agent(agent: Agent) -> None:
        """Drive one agent's breathing loop, freeing its inbox when it exits."""
        try:
            await agent.run(pace=pace)
        finally:
            bus.unsubscribe(agent.agent_id)

    # Announce the run so it is observable from line one (and the JSONL + feed
    # pipeline is exercised even before any agent acts).
    await bus.publish(
        Event(
            "simulation_started",
            "world",
            {"message": f"Simulation started: {len(sim.agents)} agents breathing."},
            scope=ScopeType.GLOBAL,
            timestamp=world.now(),
        )
    )

    agent_tasks: list[asyncio.Task[None]] = [
        asyncio.create_task(run_agent(agent), name=f"agent:{agent.agent_id}")
        for agent in sim.agents
    ]
    background_tasks: list[asyncio.Task[None]] = [
        asyncio.create_task(
            run_world_tick(world, bus, interval=world_tick_interval), name="world-tick"
        ),
        asyncio.create_task(
            run_activity_feed(
                sim.feed_log,
                world,
                console,
                refresh_interval=refresh_interval,
                should_stop=stop.is_set,
            ),
            name="activity-feed",
        ),
        asyncio.create_task(
            _collapse_watch(world, sim.agents, stop, interval=world_tick_interval),
            name="collapse-watch",
        ),
        asyncio.create_task(_watch_agents_done(agent_tasks, stop), name="agents-done"),
    ]

    remove_signal_handlers = _install_signal_handlers(stop)
    try:
        async with asyncio.timeout(duration):
            await stop.wait()
    except TimeoutError:
        logger.info("Run duration (%.1fs) elapsed; shutting down.", duration)
    finally:
        stop.set()
        for task in (*agent_tasks, *background_tasks):
            task.cancel()
        await asyncio.gather(*agent_tasks, *background_tasks, return_exceptions=True)
        for agent in sim.agents:
            bus.unsubscribe(agent.agent_id)
        remove_signal_handlers()
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
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Ollama model name.")
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

    console = Console(stderr=True)
    configure_rich_logging(console)

    sim = build_simulation(
        args.config,
        seed=args.seed,
        model=args.model,
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

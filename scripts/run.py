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
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
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
from observability.usage import JsonlUsageLog
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
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
DEFAULT_PROVIDER: str = "ollama"
#: Default model per provider; ``--model`` overrides, else the provider picks its own.
DEFAULT_MODEL: str = "qwen3:8b"
DEFAULT_GEMINI_MODEL: str = "gemini-3.1-flash-lite"
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
    spawn_agent: Callable[[AgentState], Agent]


def build_simulation(
    config_path: str | Path,
    *,
    seed: int,
    model: str,
    memory_root: str | Path,
    run_dir: str | Path,
    provider: str = "ollama",
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
        model: Model name for the default decider; ignored when ``decider`` is
            supplied. Interpreted per ``provider`` (an Ollama model for ``"ollama"``,
            a hosted model for ``"gemini"``).
        memory_root: Root directory under which each agent's ``<agent_id>/`` memory
            directory is created (``FileMemoryStore`` appends the id itself).
        run_dir: Directory the JSONL replay log is written into.
        provider: Decider backend to build when ``decider`` is ``None`` -- ``"ollama"``
            (local, the default, serialized one-at-a-time) or ``"gemini"`` (hosted,
            left UNserialized so agents breathe concurrently).
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

    # Token-usage sink, a sibling of the replay log: per-decision input/output tokens
    # for cost accounting (read post-hoc by the chronicle). Operator metric, NOT routed
    # through the bus -- agents never perceive it.
    usage_log = JsonlUsageLog(Path(run_dir) / f"usage_{seed}.jsonl")

    registry = ToolRegistry(world, bus)
    register_builtins(registry)

    # A NEW variable so the param's ``Decider | None`` is never reassigned to a
    # different type (keeps ``mypy --strict`` happy). Ollama serves one request at a
    # time, so its decider is serialized exactly once; the Gemini (hosted) path serves
    # requests in parallel, so it is left UNserialized and agents breathe concurrently.
    inner: Decider = (
        decider if decider is not None else make_default_decider(model, provider=provider)
    )
    serialized: Decider = (
        inner
        if (provider == "gemini" or isinstance(inner, SerializingDecider))
        else SerializingDecider(inner)
    )

    def _real_vector_store(agent_id: str) -> VectorStore:  # pragma: no cover - prod path
        """Build a persistent per-agent Chroma vector store (production default)."""
        return ChromaVectorStore(
            agent_id,
            default_embedding_function(),
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

    # The breathing set + its task list GROW as offspring are spawned; both are shared
    # with the spawn-watch (which appends) and the shutdown (which cancels/unsubscribes).
    known: set[str] = {agent.agent_id for agent in sim.agents}
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
            _liveness_watch(world, sim.agents, stop, interval=world_tick_interval),
            name="liveness-watch",
        ),
        asyncio.create_task(
            _spawn_watch(
                world, sim, run_agent, agent_tasks, known, stop, interval=world_tick_interval
            ),
            name="spawn-watch",
        ),
    ]

    remove_signal_handlers = _install_signal_handlers(stop)
    try:
        async with asyncio.timeout(duration):
            await stop.wait()
    except TimeoutError:
        logger.info("Run duration (%.1fs) elapsed; shutting down.", duration)
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
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        choices=("ollama", "gemini"),
        help="Decider backend: local 'ollama' (default) or hosted 'gemini'.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model name; defaults per provider (qwen3:8b for ollama, "
        f"{DEFAULT_GEMINI_MODEL} for gemini).",
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

    model = args.model or (DEFAULT_GEMINI_MODEL if args.provider == "gemini" else DEFAULT_MODEL)
    sim = build_simulation(
        args.config,
        seed=args.seed,
        model=model,
        provider=args.provider,
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

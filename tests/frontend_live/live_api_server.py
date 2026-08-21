"""Test-only FastAPI live API launcher for real frontend smoke tests.

This module deliberately injects fake cognition and fake vector storage into the
production server factory so Playwright can exercise a real HTTP/SSE server
without touching Ollama, Gemini, Chroma, or repository run state.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any, cast

import uvicorn
from fastapi import FastAPI, HTTPException, Request

from agents.decider import Decision, ToolCall
from core.constants import (
    ATTACK_DAMAGE,
    BREAKIN_ENERGY_COST,
    BREAKIN_INTEGRITY_DAMAGE,
    BREAKIN_MATERIALS_COST,
    CORPSE_DECAY_SECONDS,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_DECAY_PER_SECOND,
    MATING_MIN_ENERGY_CONTRIBUTION,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
)
from core.logging import configure_logging
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import DEFAULT_CONFIG, DEFAULT_SEED, Simulation
from server.app import ServerSettings, create_app
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.homes import Home, HomeStatus
from world.regions import Region
from world.tick import tick
from world.world import WorldState

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8021
DEFAULT_MODEL = "frontend-live-mock-decider"
DEFAULT_DURATION_SECONDS = 120.0
DEFAULT_PACE_SECONDS = 0.5
DEFAULT_WORLD_TICK_SECONDS = 1.0
DEFAULT_REFRESH_SECONDS = 0.25
DEFAULT_SSE_POLL_SECONDS = 0.05
DEFAULT_STARTUP_TIMEOUT_SECONDS = 2.0
DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 2.0
SCRIPTED_DECISION_COUNT = 256
LIVE_SMOKE_MESSAGE = "The springs are awake."
LIVE_SMOKE_THOUGHT = "The springs remember quietly."
MECHANICS_SCHEMA = 1
MECHANICS_VERSION = "layer-22b-live-mechanics-v3"
MECHANICS_CACHE_STATE = "_test_mechanics_result"
MECHANICS_LOCK_STATE = "_test_mechanics_lock"
JOE_ID = "wanderer_001"
MAE_ID = "wanderer_002"
DICK_ID = "wanderer_003"
ALLEN_ID = "wanderer_004"
DECAYED_ID = "test_decayed_agent"
COLLAPSE_HOME_ID = "test_collapse_home"
WARM_SPRINGS = "warm_springs"
NIRVANA = "nirvana"
MECHANICS_EVENT_TYPES = frozenset(
    {
        "agent_entered_region",
        "agent_decayed",
        "agent_died",
        "agent_left_region",
        "agent_paralyzed",
        "agent_recovered",
        "agent_started_hoarding",
        "agent_born",
        "attack",
        "hearth_used",
        "home_breached",
        "home_built",
        "home_collapsed",
        "home_colonized",
        "home_joined",
        "home_left",
        "home_started_hoarding",
        "home_thieved",
        "mating_initiated",
        "mating_proposal_invalidated",
        "mating_proposal_timeout",
        "mating_rejected",
        "resource_transferred",
        "resource_changed",
        "ruins_scavenged",
        "self_talk",
        "speak",
    }
)


class MockDecider:
    """Deterministic decider for live frontend smoke tests.

    The script cycles forever, matching the test-suite mock behavior while
    keeping this standalone CLI free of pytest imports.
    """

    def __init__(self, scripted: Sequence[Decision]) -> None:
        """Initialise the decider with a non-empty decision script."""
        if not scripted:
            raise ValueError("scripted decisions must not be empty")
        self._scripted = list(scripted)
        self._index = 0

    async def decide(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> Decision:
        """Return the next scripted decision, cycling after the final item."""
        del messages, tools
        decision = self._scripted[self._index % len(self._scripted)]
        self._index += 1
        return decision


def _fake_vector_store(_agent_id: str) -> VectorStore:
    """Return a deterministic in-memory vector store for one agent."""
    return FakeVectorStore(FakeEmbeddingFunction())


def _scripted_decisions() -> list[Decision]:
    """Return one private thought followed by repeated visible speech decisions."""
    return [Decision(text=LIVE_SMOKE_THOUGHT)] + [
        Decision(
            tool_calls=[
                ToolCall(
                    "speak",
                    {"message": LIVE_SMOKE_MESSAGE},
                )
            ]
        )
        for _ in range(SCRIPTED_DECISION_COUNT)
    ]


def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser for the test-only live server."""
    parser = argparse.ArgumentParser(
        prog="python3 -m tests.frontend_live.live_api_server",
        description="Run a deterministic Vivarium live API for Playwright smoke tests.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--duration", type=float, default=DEFAULT_DURATION_SECONDS)
    parser.add_argument("--pace", type=float, default=DEFAULT_PACE_SECONDS)
    parser.add_argument(
        "--world-tick-interval",
        type=float,
        default=DEFAULT_WORLD_TICK_SECONDS,
    )
    parser.add_argument("--refresh-interval", type=float, default=DEFAULT_REFRESH_SECONDS)
    parser.add_argument("--sse-poll-interval", type=float, default=DEFAULT_SSE_POLL_SECONDS)
    parser.add_argument(
        "--startup-timeout",
        type=float,
        default=DEFAULT_STARTUP_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--shutdown-timeout",
        type=float,
        default=DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
    )
    parser.add_argument("--memory-root", type=Path, default=None)
    parser.add_argument("--run-dir", type=Path, default=None)
    parser.add_argument(
        "--log-level",
        default="warning",
        choices=("debug", "info", "warning", "error", "critical"),
    )
    return parser


def _test_storage_paths(
    args: argparse.Namespace,
    stack: contextlib.ExitStack,
) -> tuple[Path, Path]:
    """Resolve memory and run roots, defaulting to a temporary test-only tree."""
    temp_root = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="vivarium-live-")))
    memory_root = args.memory_root if args.memory_root is not None else temp_root / "memory"
    run_dir = args.run_dir if args.run_dir is not None else temp_root / "runs"
    return Path(memory_root), Path(run_dir)


def _settings(args: argparse.Namespace, memory_root: Path, run_dir: Path) -> ServerSettings:
    """Translate CLI arguments into server settings for the smoke app."""
    return ServerSettings(
        config_path=args.config,
        seed=args.seed,
        provider="ollama",
        model=DEFAULT_MODEL,
        pace=args.pace,
        duration=args.duration,
        world_tick_interval=args.world_tick_interval,
        refresh_interval=args.refresh_interval,
        memory_root=memory_root,
        run_dir=run_dir,
        sse_poll_interval=args.sse_poll_interval,
        startup_timeout=args.startup_timeout,
        shutdown_timeout=args.shutdown_timeout,
    )


def _install_test_mechanics_route(app: FastAPI) -> None:
    """Install the deterministic test-only mechanics trigger route.

    The route is deliberately attached by the live test harness after the production
    app is created. It uses the app-owned live simulation and real builtin tools, but
    keeps its result cached so repeated browser probes do not re-run stateful tools.
    """

    @app.post("/api/test/mechanics/run")
    async def run_test_mechanics(request: Request) -> dict[str, object]:
        """Run the deterministic mechanics script once and return its event window."""
        lock = _mechanics_lock(request.app)
        async with lock:
            cached = getattr(request.app.state, MECHANICS_CACHE_STATE, None)
            if cached is not None:
                return _cached_result(cast(dict[str, object], cached))

            sim = _simulation_from_state(request.app)
            await _quiesce_background_run(request.app)
            result = await _run_test_mechanics(sim)
            setattr(request.app.state, MECHANICS_CACHE_STATE, result)
            return result


def _mechanics_lock(app: FastAPI) -> asyncio.Lock:
    """Return the app-local lock serializing mechanics route execution."""
    lock = getattr(app.state, MECHANICS_LOCK_STATE, None)
    if lock is None:
        lock = asyncio.Lock()
        setattr(app.state, MECHANICS_LOCK_STATE, lock)
    return cast(asyncio.Lock, lock)


def _cached_result(result: dict[str, object]) -> dict[str, object]:
    """Return a cached mechanics response with cache flags flipped."""
    response = dict(result)
    response["newly_ran"] = False
    response["reused_cached_result"] = True
    return response


def _simulation_from_state(app: FastAPI) -> Simulation:
    """Fetch the live simulation from ``app.state`` for the test route."""
    sim = getattr(app.state, "simulation", None)
    if sim is None:
        raise HTTPException(status_code=503, detail="Simulation is not ready.")
    return cast(Simulation, sim)


async def _quiesce_background_run(app: FastAPI) -> None:
    """Stop and await the test server's breathing loop before mechanics assertions."""
    stop = getattr(app.state, "stop_event", None)
    task = getattr(app.state, "run_task", None)
    if not isinstance(stop, asyncio.Event) or not isinstance(task, asyncio.Task):
        raise HTTPException(status_code=503, detail="Simulation lifecycle is not ready.")
    stop.set()
    await task


async def _run_test_mechanics(sim: Simulation) -> dict[str, object]:
    """Prime the live world and run a deterministic real-tool mechanics script."""
    _prime_mechanics_world(sim.world)
    registry = ToolRegistry(sim.world, sim.bus)
    register_builtins(registry)
    start_cursor = sim.feed_log.current_cursor
    outcomes: list[dict[str, object]] = []

    await _emit_route_self_talk(sim, JOE_ID)
    await _invoke_tool(
        registry,
        outcomes,
        "speak",
        JOE_ID,
        {"message": "The deterministic springs are awake."},
    )
    _prime_recovery(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "transfer_resource",
        JOE_ID,
        {"target": MAE_ID, "resource_type": "energy", "amount": 8.0},
    )

    await _invoke_tool(registry, outcomes, "build_home", JOE_ID, {})
    home = _joe_home(sim.world)
    _prime_home_membership(sim.world, home)
    await _invoke_tool(
        registry,
        outcomes,
        "pledge_home",
        MAE_ID,
        {"home_id": home.home_id},
    )
    await _invoke_tool(registry, outcomes, "leave_home", MAE_ID, {})
    await _invoke_tool(registry, outcomes, "use_hearth", JOE_ID, {})
    await _invoke_tool(
        registry,
        outcomes,
        "harvest_resources",
        JOE_ID,
        {"resource_type": "energy", "amount": 5.0},
    )
    _prime_agent_hoarding(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "harvest_resources",
        JOE_ID,
        {"resource_type": "materials", "amount": 12.0},
    )
    await _invoke_tool(registry, outcomes, "move", DICK_ID, {"destination": WARM_SPRINGS})

    _prime_break_in(home, sim.world.get_agent(DICK_ID))
    await _invoke_tool(
        registry,
        outcomes,
        "break_in",
        DICK_ID,
        {"target_home": home.home_id, "intent": "thieve"},
    )

    colonize_home = _test_home(
        sim.world,
        home_id="test_colonize_home",
        owner_id=MAE_ID,
        vault_materials=20.0,
    )
    _prime_break_in(colonize_home, sim.world.get_agent(DICK_ID))
    await _invoke_tool(
        registry,
        outcomes,
        "break_in",
        DICK_ID,
        {"target_home": colonize_home.home_id, "intent": "colonize"},
    )
    _prime_deposit(sim.world)
    await _invoke_tool(registry, outcomes, "deposit_to_home", DICK_ID, {"amount": 320.0})

    ruin_home = _test_home(
        sim.world,
        home_id="test_ruin_home",
        owner_id=MAE_ID,
        vault_materials=80.0,
    )
    sim.world.make_ruin(ruin_home.home_id)
    _prime_scavenge(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "scavenge_ruins",
        DICK_ID,
        {"target_home": ruin_home.home_id, "amount": 12.0},
    )

    await _invoke_tool(
        registry,
        outcomes,
        "initiate_mating",
        JOE_ID,
        {
            "target": MAE_ID,
            "message": "A deterministic test proposal.",
            "resources": {
                "energy": MATING_MIN_ENERGY_CONTRIBUTION,
                "materials": MATING_MIN_MATERIALS_CONTRIBUTION,
            },
        },
    )
    await _invoke_tool(
        registry,
        outcomes,
        "reject_mating",
        MAE_ID,
        {"target": JOE_ID, "message": "A deterministic test rejection."},
    )
    _prime_invalidated_mating(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "initiate_mating",
        JOE_ID,
        {
            "target": MAE_ID,
            "message": "A deterministic proposal that will fall through.",
            "resources": {
                "energy": MATING_MIN_ENERGY_CONTRIBUTION,
                "materials": MATING_MIN_MATERIALS_CONTRIBUTION,
            },
        },
    )
    await _invoke_tool(
        registry,
        outcomes,
        "initiate_mating",
        JOE_ID,
        {
            "target": ALLEN_ID,
            "message": "A deterministic proposal that changes eligibility.",
            "resources": {
                "energy": MATING_MIN_ENERGY_CONTRIBUTION,
                "materials": MATING_MIN_MATERIALS_CONTRIBUTION,
            },
        },
    )
    await _invoke_tool(
        registry,
        outcomes,
        "accept_mating",
        ALLEN_ID,
        {"target": JOE_ID, "message": "A deterministic side acceptance."},
    )
    await _invoke_tool(
        registry,
        outcomes,
        "accept_mating",
        MAE_ID,
        {"target": JOE_ID, "message": "A deterministic stale acceptance."},
        allow_expected_invalid=True,
    )
    _prime_mating_pair(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "initiate_mating",
        JOE_ID,
        {
            "target": MAE_ID,
            "message": "A deterministic accepted proposal.",
            "resources": {
                "energy": MATING_MIN_ENERGY_CONTRIBUTION,
                "materials": MATING_MIN_MATERIALS_CONTRIBUTION,
            },
        },
    )
    await _invoke_tool(
        registry,
        outcomes,
        "accept_mating",
        MAE_ID,
        {"target": JOE_ID, "message": "A deterministic test acceptance."},
    )

    await _prime_and_tick_ambient_events(sim, registry, outcomes)

    _prime_attack(sim.world)
    await _invoke_tool(registry, outcomes, "attack", JOE_ID, {"target": MAE_ID})
    _prime_lethal_attack(sim.world)
    await _invoke_tool(registry, outcomes, "attack", JOE_ID, {"target": DICK_ID})

    end_cursor = sim.feed_log.current_cursor
    return {
        "schema": MECHANICS_SCHEMA,
        "version": MECHANICS_VERSION,
        "newly_ran": True,
        "reused_cached_result": False,
        "start_cursor": start_cursor,
        "end_cursor": end_cursor,
        "event_types": _mechanics_event_types(sim, start_cursor),
        "tools": outcomes,
    }


async def _invoke_tool(
    registry: ToolRegistry,
    outcomes: list[dict[str, object]],
    name: str,
    agent_id: str,
    params: dict[str, object],
    *,
    allow_expected_invalid: bool = False,
) -> None:
    """Invoke one real tool and append a JSON-safe outcome record."""
    try:
        result = await registry.invoke(name, agent_id, params)
    except Exception as exc:
        outcomes.append(
            {
                "tool": name,
                "agent_id": agent_id,
                "params": params,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
            }
        )
        return

    expected_invalid = allow_expected_invalid and result.startswith(
        "Invalid: This mating proposal is no longer valid"
    )
    ok = not result.startswith(("Error:", "Invalid:")) or expected_invalid
    record: dict[str, object] = {
        "tool": name,
        "agent_id": agent_id,
        "params": params,
        "ok": ok,
        "result": result,
    }
    if expected_invalid:
        record["expected_invalid"] = True
    if not ok:
        record["error"] = result
    outcomes.append(record)


async def _emit_route_self_talk(sim: Simulation, agent_id: str) -> None:
    """Emit one private thought through the runtime's real self-talk helper."""
    for agent in sim.agents:
        if agent.agent_id == agent_id:
            await agent._emit_self_talk(Decision(text="A deterministic private thought."))
            return
    raise HTTPException(status_code=500, detail=f"Missing runtime agent {agent_id}.")


def _prime_mechanics_world(world: WorldState) -> None:
    """Put the default live-test beings and resource pools in deterministic shape."""
    joe = _require_agent(world, JOE_ID, "Joe")
    mae = _require_agent(world, MAE_ID, "Mae")
    dick = _require_agent(world, DICK_ID, "Dick")
    allen = _require_agent(world, ALLEN_ID, "Allen")
    warm_springs = _require_region(world, WARM_SPRINGS)
    nirvana = _require_region(world, NIRVANA)
    if WARM_SPRINGS not in nirvana.connections:
        raise HTTPException(status_code=500, detail="nirvana must connect to warm_springs.")

    joe.current_position = WARM_SPRINGS
    joe.current_energy = 220.0
    joe.current_materials = (
        HOME_BUILD_MATERIALS_COST
        + HEARTH_MATERIALS_PER_USE
        + MATING_MIN_MATERIALS_CONTRIBUTION
        + 90.0
    )
    _mark_alive(joe)

    mae.current_position = WARM_SPRINGS
    mae.current_energy = ATTACK_DAMAGE
    mae.current_materials = 45.0
    _mark_alive(mae)

    dick.current_position = NIRVANA
    dick.current_energy = 160.0
    dick.current_materials = 100.0
    _mark_alive(dick)

    allen.current_position = WARM_SPRINGS
    allen.current_energy = 120.0
    allen.current_materials = 120.0
    _mark_alive(allen)

    warm_springs.current_energy = max(warm_springs.current_energy, 20.0)
    warm_springs.current_materials = max(warm_springs.current_materials, 20.0)


def _prime_home_membership(world: WorldState, home: Home) -> None:
    """Make Mae eligible to join and leave Joe's newly built home."""
    mae = _require_agent(world, MAE_ID, "Mae")
    mae.current_position = home.region
    mae.current_energy = max(mae.current_energy, 40.0)
    mae.current_materials = max(mae.current_materials, 40.0)
    _mark_alive(mae)
    existing_home = world.stakeholder_home_of(MAE_ID)
    if existing_home is not None and existing_home.home_id != home.home_id:
        world.remove_stakeholder(existing_home.home_id, MAE_ID)


def _prime_agent_hoarding(world: WorldState) -> None:
    """Put Joe one small harvest below the personal material hoard threshold."""
    joe = _require_agent(world, JOE_ID, "Joe")
    warm_springs = _require_region(world, WARM_SPRINGS)
    joe.current_position = WARM_SPRINGS
    joe.current_energy = min(max(joe.current_energy, 120.0), 240.0)
    joe.current_materials = HOARDING_MATERIALS_THRESHOLD - 8.0
    _mark_alive(joe)
    warm_springs.current_materials = max(warm_springs.current_materials, 24.0)


def _prime_break_in(home: Home, dick: AgentState | None) -> None:
    """Make the built home valid for a one-shot thieve breach by Dick."""
    if dick is None:
        raise HTTPException(status_code=500, detail="Dick is missing from the world.")
    dick.current_position = WARM_SPRINGS
    dick.current_energy = max(dick.current_energy, BREAKIN_ENERGY_COST + 40.0)
    dick.current_materials = max(dick.current_materials, BREAKIN_MATERIALS_COST + 60.0)
    _mark_alive(dick)
    home.region = WARM_SPRINGS
    home.integrity = BREAKIN_INTEGRITY_DAMAGE
    home.vault_materials = 60.0
    home.breachers.clear()


def _prime_recovery(world: WorldState) -> None:
    """Make Mae a paralyzed co-located receiver for a real recovery transfer."""
    joe = _require_agent(world, JOE_ID, "Joe")
    mae = _require_agent(world, MAE_ID, "Mae")
    joe.current_position = WARM_SPRINGS
    joe.current_energy = max(joe.current_energy, 220.0)
    _mark_alive(joe)
    mae.current_position = WARM_SPRINGS
    mae.current_energy = 1.0
    mae.status = AgentStatus.PARALYZED
    mae.died_at = None


def _test_home(
    world: WorldState,
    *,
    home_id: str,
    owner_id: str,
    vault_materials: float,
) -> Home:
    """Return a reusable test-only home, creating it directly when needed."""
    if world.get_home(home_id) is None:
        world.build_home(
            home_id=home_id,
            owner_id=owner_id,
            region=WARM_SPRINGS,
            built_at=world.now(),
            integrity=BREAKIN_INTEGRITY_DAMAGE,
        )
    home = world.get_home(home_id)
    if home is None:
        raise HTTPException(status_code=500, detail=f"Could not create {home_id}.")
    home.region = WARM_SPRINGS
    home.owner_id = owner_id
    home.stakeholders = [owner_id]
    home.integrity = BREAKIN_INTEGRITY_DAMAGE
    home.vault_materials = vault_materials
    home.remnant_materials = 0.0
    home.ruined_at = None
    home.breachers.clear()
    return home


def _prime_invalidated_mating(world: WorldState) -> None:
    """Set up Joe, Mae, and Allen for a real stale-initiator invalidation."""
    joe = _require_agent(world, JOE_ID, "Joe")
    mae = _require_agent(world, MAE_ID, "Mae")
    allen = _require_agent(world, ALLEN_ID, "Allen")
    for agent in (joe, mae, allen):
        agent.current_position = WARM_SPRINGS
        agent.current_energy = max(agent.current_energy, MATING_MIN_ENERGY_CONTRIBUTION * 3 + 80.0)
        agent.current_materials = max(
            agent.current_materials,
            MATING_MIN_MATERIALS_CONTRIBUTION * 3 + 80.0,
        )
        _mark_alive(agent)
    for target_id in (MAE_ID, ALLEN_ID):
        world.remove_proposal(JOE_ID, target_id)


async def _prime_and_tick_ambient_events(
    sim: Simulation,
    registry: ToolRegistry,
    outcomes: list[dict[str, object]],
) -> None:
    """Use real proposal, corpse, and home sweeps for ambient event coverage."""
    _prime_timeout_proposal(sim.world)
    await _invoke_tool(
        registry,
        outcomes,
        "initiate_mating",
        DICK_ID,
        {
            "target": ALLEN_ID,
            "message": "A deterministic proposal that will lapse.",
            "resources": {
                "energy": MATING_MIN_ENERGY_CONTRIBUTION,
                "materials": MATING_MIN_MATERIALS_CONTRIBUTION,
            },
        },
    )
    proposal = sim.world.get_agent_proposals(DICK_ID, ALLEN_ID)
    if not proposal:
        raise HTTPException(status_code=500, detail="Could not create timeout proposal.")
    proposal["timestamp"] = sim.world.now() - MATING_PROPOSAL_TIMEOUT_SECONDS - 1.0

    _prime_decayed_agent(sim.world)
    _prime_collapse_home(sim.world)
    await tick(sim.world, sim.bus)


def _prime_timeout_proposal(world: WorldState) -> None:
    """Make Dick and Allen eligible for a real proposal that can time out."""
    dick = _require_agent(world, DICK_ID, "Dick")
    allen = _require_agent(world, ALLEN_ID, "Allen")
    for agent in (dick, allen):
        agent.current_position = WARM_SPRINGS
        agent.current_energy = max(agent.current_energy, MATING_MIN_ENERGY_CONTRIBUTION + 60.0)
        agent.current_materials = max(
            agent.current_materials,
            MATING_MIN_MATERIALS_CONTRIBUTION + 60.0,
        )
        _mark_alive(agent)
    world.remove_proposal(DICK_ID, ALLEN_ID)


def _prime_decayed_agent(world: WorldState) -> None:
    """Create a test-only corpse old enough for the real corpse-decay sweep."""
    corpse = world.get_agent(DECAYED_ID)
    if corpse is None:
        corpse = AgentState(
            id=DECAYED_ID,
            name="Faded Witness",
            persona="A temporary test body for corpse decay coverage.",
            current_position=WARM_SPRINGS,
            current_energy=0.0,
            current_materials=0.0,
            status=AgentStatus.ALIVE,
        )
        world.add_agent(corpse)
    corpse.name = "Faded Witness"
    corpse.current_position = WARM_SPRINGS
    corpse.current_energy = 0.0
    corpse.current_materials = 0.0
    world.kill_agent(DECAYED_ID)
    corpse.died_at = world.now() - CORPSE_DECAY_SECONDS - 1.0


def _prime_collapse_home(world: WorldState) -> None:
    """Create a test-only untended home one real tick from collapse."""
    if world.get_home(COLLAPSE_HOME_ID) is None:
        world.build_home(
            home_id=COLLAPSE_HOME_ID,
            owner_id=ALLEN_ID,
            region=WARM_SPRINGS,
            built_at=world.now(),
            integrity=HOME_DECAY_PER_SECOND,
        )
    home = world.get_home(COLLAPSE_HOME_ID)
    if home is None:
        raise HTTPException(status_code=500, detail="Could not create collapse home.")
    home.owner_id = ALLEN_ID
    home.region = WARM_SPRINGS
    home.status = HomeStatus.STANDING
    home.stakeholders = []
    home.integrity = HOME_DECAY_PER_SECOND * 0.5
    home.vault_materials = 20.0
    home.remnant_materials = 0.0
    home.ruined_at = None
    home.breachers.clear()
    home.last_integrity_at = world.now() - 1.0
    home.last_upkeep_at = world.now() - 1.0


def _prime_deposit(world: WorldState) -> None:
    """Make Dick able to deposit enough materials to trigger home hoarding."""
    dick = _require_agent(world, DICK_ID, "Dick")
    dick.current_position = WARM_SPRINGS
    dick.current_materials = max(dick.current_materials, 360.0)
    dick.current_energy = max(dick.current_energy, 80.0)
    _mark_alive(dick)
    home = world.stakeholder_home_of(DICK_ID)
    if home is not None:
        home.integrity = max(home.integrity, 120.0)
        home.last_integrity_at = world.now()
        home.last_upkeep_at = world.now()


def _prime_scavenge(world: WorldState) -> None:
    """Make Dick alive and co-located for a real ruin-scavenge tool call."""
    dick = _require_agent(world, DICK_ID, "Dick")
    dick.current_position = WARM_SPRINGS
    dick.current_energy = max(dick.current_energy, 80.0)
    dick.current_materials = max(dick.current_materials, 40.0)
    _mark_alive(dick)


def _prime_mating_pair(world: WorldState) -> None:
    """Reset Joe and Mae so a second proposal can be accepted and birth a child."""
    joe = _require_agent(world, JOE_ID, "Joe")
    mae = _require_agent(world, MAE_ID, "Mae")
    for agent in (joe, mae):
        agent.current_position = WARM_SPRINGS
        agent.current_energy = max(agent.current_energy, MATING_MIN_ENERGY_CONTRIBUTION + 80.0)
        agent.current_materials = max(
            agent.current_materials,
            MATING_MIN_MATERIALS_CONTRIBUTION + 80.0,
        )
        _mark_alive(agent)
    world.remove_proposal(JOE_ID, MAE_ID)


def _prime_attack(world: WorldState) -> None:
    """Make the final attack deterministically paralyze Mae rather than kill her."""
    joe = _require_agent(world, JOE_ID, "Joe")
    mae = _require_agent(world, MAE_ID, "Mae")
    joe.current_position = WARM_SPRINGS
    joe.current_energy = max(joe.current_energy, 80.0)
    _mark_alive(joe)
    mae.current_position = WARM_SPRINGS
    mae.current_energy = ATTACK_DAMAGE
    _mark_alive(mae)


def _prime_lethal_attack(world: WorldState) -> None:
    """Make Dick a paralyzed co-located victim for a lethal real attack."""
    joe = _require_agent(world, JOE_ID, "Joe")
    dick = _require_agent(world, DICK_ID, "Dick")
    joe.current_position = WARM_SPRINGS
    joe.current_energy = max(joe.current_energy, 120.0)
    _mark_alive(joe)
    dick.current_position = WARM_SPRINGS
    dick.current_energy = 0.0
    dick.current_materials = max(dick.current_materials, 5.0)
    dick.status = AgentStatus.PARALYZED
    dick.died_at = None


def _joe_home(world: WorldState) -> Home:
    """Return Joe's home after the real build_home tool has run."""
    home = world.stakeholder_home_of(JOE_ID)
    if home is None:
        raise HTTPException(status_code=500, detail="Joe has no home to raid.")
    return home


def _require_agent(world: WorldState, agent_id: str, name: str) -> AgentState:
    """Return a default agent or fail the test route with a useful message."""
    agent = world.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=500, detail=f"Missing default agent {agent_id}.")
    agent.name = name
    return agent


def _require_region(world: WorldState, name: str) -> Region:
    """Return a default region or fail the test route with a useful message."""
    region = world.get_region(name)
    if region is None:
        raise HTTPException(status_code=500, detail=f"Missing default region {name}.")
    return region


def _mark_alive(agent: AgentState) -> None:
    """Reset lifecycle bookkeeping for deterministic route setup."""
    agent.status = AgentStatus.ALIVE
    agent.last_mated_at = None
    agent.offspring_count = 0
    agent.died_at = None


def _mechanics_event_types(sim: Simulation, start_cursor: int) -> list[str]:
    """Return mechanics event types emitted after ``start_cursor``."""
    events = sim.feed_log.read_events(start_cursor).events
    return [event.type for event in events if event.type in MECHANICS_EVENT_TYPES]


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - live server glue
    """Run the deterministic test live API until Uvicorn shuts down."""
    args = _build_parser().parse_args(argv)
    configure_logging(args.log_level.upper())
    with contextlib.ExitStack() as stack:
        memory_root, run_dir = _test_storage_paths(args, stack)
        app = create_app(
            _settings(args, memory_root, run_dir),
            decider=MockDecider(_scripted_decisions()),
            vector_store_factory=_fake_vector_store,
        )
        _install_test_mechanics_route(app)
        uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    return 0


if __name__ == "__main__":  # pragma: no cover - module executed as a script
    import sys

    sys.exit(main())

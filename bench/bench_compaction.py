"""Never-overflow benchmark for the Sprint-5.5 transcript compaction.

The one hard requirement: the assembled prompt must never exceed the model's context
window. This harness proves it two ways:

  * ``synthetic`` (default, fast, no model): drive an agent for hundreds of breaths
    with realistic + worst-case turn sizes and report the PEAK estimated prompt size
    against the budget. Pass condition: peak estimate <= PROMPT_BUDGET_TOKENS on every
    breath. This proves the property at scale.
  * ``live`` (needs Ollama + qwen3): run a handful of real breaths and compare the
    pre-call ESTIMATE to Ollama's ACTUAL ``prompt_eval_count``. Pass condition: the
    estimate is conservative (estimate >= actual). This proves the assumption the
    synthetic run rests on -- that the heuristic never under-counts real tokens.

Together: a conservative estimator (live) + the estimate held under budget at scale
(synthetic) == the prompt never overflows the window.

Run (fast):    python -m bench.bench_compaction --mode synthetic --breaths 400
Run (real):    python -m bench.bench_compaction --mode live --breaths 8

This is a script, so console output via print is intentional (bench/ is excluded from
the library no-print rule and from coverage).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import statistics
import tempfile
from pathlib import Path
from typing import Any

from agents.compaction import estimate_tokens
from agents.decider import Decision, ToolCall
from agents.runtime import Agent
from bus.event_bus import EventBus
from core import constants
from memory.embedding import FakeEmbeddingFunction
from memory.store import FileMemoryStore
from memory.vector_store import FakeVectorStore
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

AGENT_ID = "wanderer_001"
PERSONA = "You are Ada, a careful wanderer who values trust and remembers how others treat you."


def _build_world() -> WorldState:
    regions = [
        Region(
            name="meadow",
            description="A lush meadow, rich with energy and materials.",
            connections=["grove"],
            energy_rate=2.0,
            materials_rate=1.0,
            current_energy=400.0,
            current_materials=200.0,
            max_energy=600.0,
            max_materials=600.0,
        ),
        Region(
            name="grove",
            description="A quiet grove of old trees.",
            connections=["meadow"],
            energy_rate=1.0,
            materials_rate=1.0,
            current_energy=200.0,
            current_materials=200.0,
            max_energy=600.0,
            max_materials=600.0,
        ),
    ]
    agents = [
        AgentState(
            id=AGENT_ID,
            name="Ada",
            persona=PERSONA,
            current_position="meadow",
            current_energy=300.0,
            current_materials=80.0,
            status=AgentStatus.ALIVE,
        )
    ]
    return WorldState(regions, agents)


def _build_agent(root: Path, decider: Any) -> Agent:
    world = _build_world()
    bus = EventBus(world)
    bus.subscribe(AGENT_ID)
    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    memory = FileMemoryStore(
        AGENT_ID,
        root,
        persona=PERSONA,
        vector_store=FakeVectorStore(FakeEmbeddingFunction()),
        clock=world.now,
    )
    return Agent(AGENT_ID, world, bus, registry, decider, pace=0.0, memory=memory)


class SyntheticDecider:
    """Emits realistic-sized turns (large hidden thinking), a short recap on a
    no-tools (compaction) call, and an occasional memory on the reflection call.
    Counts the compaction calls it served."""

    def __init__(self, thinking_chars: int) -> None:
        self._thinking = "reflection. " * (thinking_chars // 12)
        self.compactions = 0

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        if not tools:  # compaction call
            self.compactions += 1
            return Decision(
                text="Recently my days have run together: I tended the meadow, "
                "watched the others come and go, and kept to my careful way."
            )
        names = {t["function"]["name"] for t in tools}
        if "remember" in names:  # reflection call
            return Decision(
                tool_calls=[
                    ToolCall(
                        "remember",
                        {
                            "content": "Patience has served me well in the meadow.",
                            "importance": "low",
                        },
                    )
                ]
            )
        return Decision(
            text="I take stock and decide to wait a moment longer.",
            thinking=self._thinking,
            tool_calls=[ToolCall("wait")],
        )


def run_synthetic(breaths: int, thinking_chars: int) -> int:
    """Drive a synthetic long run; print the report. Return process exit code."""
    root = Path(tempfile.mkdtemp(prefix="vivcompact_"))
    try:
        decider = SyntheticDecider(thinking_chars)
        agent = _build_agent(root, decider)
        estimates: list[int] = []

        async def _drive() -> None:
            for _ in range(breaths):
                await agent.breathe()
                estimates.append(estimate_tokens(agent.lifecycle_history, agent._action_schemas()))

        asyncio.run(_drive())

        peak = max(estimates)
        budget = constants.PROMPT_BUDGET_TOKENS
        window = constants.MODEL_CONTEXT_TOKENS
        ok = peak <= budget
        print(f"## Compaction never-overflow -- synthetic ({breaths} breaths)")
        print()
        trigger = constants.COMPACTION_TRIGGER_TOKENS
        print(f"- thinking/turn: ~{thinking_chars} chars (~{thinking_chars // 4} tok)")
        print(f"- PROMPT_BUDGET={budget}, window={window}, trigger={trigger}")
        print(f"- peak estimated prompt: {peak} tok ({100 * peak / window:.0f}% of window)")
        print(f"- mean estimated prompt: {statistics.mean(estimates):.0f} tok")
        print(f"- final history turns: {len(agent.lifecycle_history)}")
        print(f"- compactions performed: {decider.compactions}")
        print(f"- recap installed: {agent._recap_installed}")
        print()
        verdict = "PASS" if ok else "FAIL"
        relation = "<=" if ok else ">"
        print(f"**{verdict}: peak estimate {peak} {relation} budget {budget}**")
        return 0 if ok else 1
    finally:
        shutil.rmtree(root, ignore_errors=True)


def run_live(breaths: int, model: str) -> int:
    """Run real qwen3 breaths; confirm the estimate is conservative vs prompt_eval_count."""
    from agents.decider import make_default_decider

    root = Path(tempfile.mkdtemp(prefix="vivcompact_live_"))
    try:
        agent = _build_agent(root, make_default_decider(model))
        rows: list[tuple[int, int, int]] = []  # (breath, estimate_before_decide, actual)

        async def _drive() -> None:
            for i in range(breaths):
                # estimate the prompt the upcoming decide will send (after perceive)
                await agent.perceive()
                est = estimate_tokens(agent.lifecycle_history, agent._action_schemas())
                decision = await agent.decide()
                actual = decision.prompt_tokens if decision else 0
                if decision is not None:
                    await agent.execute(decision.tool_calls)
                agent.breath_count += 1
                rows.append((i, est, actual))

        asyncio.run(_drive())

        window = constants.MODEL_CONTEXT_TOKENS
        conservative = all(est >= actual for _, est, actual in rows if actual)
        peak_actual = max((actual for _, _, actual in rows), default=0)
        print(f"## Compaction never-overflow -- live qwen3 ({model}, {breaths} breaths)")
        print()
        print("| breath | estimate | actual prompt_eval | est>=actual? |")
        print("|--:|--:|--:|--|")
        for i, est, actual in rows:
            mark = "yes" if est >= actual else "**NO**"
            print(f"| {i} | {est} | {actual} | {mark} |")
        print()
        print(
            f"- peak actual prompt: {peak_actual} tok ({100 * peak_actual / window:.0f}% of window)"
        )
        print(
            f"**{'PASS' if conservative else 'FAIL'}: the estimate is "
            f"{'always >= ' if conservative else 'NOT always >= '}the real prompt_eval_count**"
        )
        return 0 if conservative else 1
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vivarium compaction never-overflow benchmark")
    parser.add_argument("--mode", choices=("synthetic", "live"), default="synthetic")
    parser.add_argument("--breaths", type=int, default=400)
    parser.add_argument(
        "--thinking", type=int, default=3000, help="chars of thinking per turn (synthetic)"
    )
    parser.add_argument("--model", default=os.environ.get("VIVARIUM_MODEL", "qwen3:8b"))
    args = parser.parse_args(argv)

    if args.mode == "live":
        return run_live(args.breaths, args.model)
    return run_synthetic(args.breaths, args.thinking)


if __name__ == "__main__":
    raise SystemExit(main())

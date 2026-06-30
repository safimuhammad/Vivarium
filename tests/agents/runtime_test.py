"""Tests for the agent breathing loop (:mod:`agents.runtime`).

Covers the Phase-3 acceptance suite (design spec Sections 9.1-9.3): loop
mechanics, perception, and the paralysis status boundary. Every test is
deterministic -- it drives the loop with a scripted decider (no live Ollama), the
seeded ``world`` fixture, and ``pace=0`` so no test sleeps for real (see
``CLAUDE.md`` Section 5).
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

import agents.runtime as runtime_module
from agents.compaction import estimate_tokens
from agents.decider import Decision, ToolCall
from agents.recall import RECALL_TOOL_NAME
from agents.runtime import DECIDE_BACKOFF_SECONDS, Agent
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    ATTACK_ENERGY_COST,
    MATING_MAX_OFFSPRING,
    PARALYSIS_ENERGY_THRESHOLD,
    REFLECT_EVERY_N_BREATHS,
)
from memory.models import Importance
from memory.store import FileMemoryStore
from observability.event_log import InMemoryEventLog
from tests.conftest import MockDecider
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState

ADA: str = "wanderer_001"
BORIS: str = "wanderer_002"


class ScriptedDecider:
    """A decider whose script may contain either decisions or exceptions to raise.

    Each ``decide`` call consumes the next script item (cycling): a
    :class:`~agents.decider.Decision` is returned and recorded, while an
    ``Exception`` instance is raised (to exercise the loop's failure handling).
    """

    def __init__(self, script: list[Decision | Exception]) -> None:
        """Initialise the decider with an ordered script."""
        self._script: list[Decision | Exception] = list(script)
        self._index: int = 0
        self.history: list[Decision] = []

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        """Return the next scripted decision or raise the next scripted error."""
        item = self._script[self._index % len(self._script)]
        self._index += 1
        if isinstance(item, Exception):
            raise item
        self.history.append(item)
        return item


def _live(world: WorldState, agent_id: str) -> AgentState:
    """Return an agent that must exist (narrows ``AgentState | None`` for mypy)."""
    agent_state = world.get_agent(agent_id)
    assert agent_state is not None
    return agent_state


def _wired(
    world: WorldState, *, with_log: bool = False
) -> tuple[EventBus, ToolRegistry, InMemoryEventLog | None]:
    """Build a bus (optionally with an in-memory log) + a populated registry.

    The registry shares the returned bus, so tool side effects and the agent's
    own events land in the same (optionally logged) bus.
    """
    log = InMemoryEventLog() if with_log else None
    bus = EventBus(world, event_log=log)
    for agent in world.get_all_agents():
        bus.subscribe(agent.id)
    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    return bus, registry, log


def _no_double_user(history: list[dict[str, Any]]) -> bool:
    """Return True if no two consecutive messages are both ``user`` turns."""
    roles = [message["role"] for message in history]
    return not any(roles[i] == "user" and roles[i + 1] == "user" for i in range(len(roles) - 1))


# ---------------------------------------------------------------------------
# 9.1 Loop mechanics
# ---------------------------------------------------------------------------


async def test_init_seeds_system_prompt_with_persona_and_tools(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    assert agent.lifecycle_history[0]["role"] == "system"
    system = agent.lifecycle_history[0]["content"]
    assert "Curious and careful." in system  # the agent's persona, verbatim
    for name in populated_registry.list_tools():
        assert name in system


async def test_breathe_records_token_usage(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A breath records its decision's token usage into the usage log (operator metric)."""
    from observability.usage import InMemoryUsageLog

    usage_log = InMemoryUsageLog()
    decider = MockDecider(
        [Decision(tool_calls=[ToolCall("look_around")], prompt_tokens=100, completion_tokens=20)]
    )
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        decider,
        pace=0.0,
        usage_log=usage_log,
        model="gemini-3.1-flash-lite",
    )

    await agent.breathe()

    breaths = [r for r in usage_log.records if r.kind == "breath"]
    assert len(breaths) == 1
    rec = breaths[0]
    assert rec.agent_id == ADA and rec.model == "gemini-3.1-flash-lite"
    assert rec.prompt_tokens == 100 and rec.completion_tokens == 20
    assert rec.timestamp == world.now()


async def test_breathe_without_usage_log_does_not_crash(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """The usage log is optional: a breath with no log behaves exactly as before."""
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    await agent.breathe()
    assert agent.breath_count == 1


async def test_breathe_survives_a_failing_usage_log(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A usage-sink error is swallowed so a metric never crashes a breath (run-forever)."""

    class _BoomLog:
        def record(self, usage: object) -> None:
            raise RuntimeError("disk full")

    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        decider,
        pace=0.0,
        usage_log=_BoomLog(),
        model="m",
    )

    await agent.breathe()  # must not raise
    assert agent.breath_count == 1


async def test_breathe_appends_user_assistant_and_paired_tool(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()

    assert agent.breath_count == 1
    assert [m["role"] for m in agent.lifecycle_history] == ["system", "user", "assistant", "tool"]
    assistant = agent.lifecycle_history[2]
    tool_message = agent.lifecycle_history[3]
    assert len(assistant["tool_calls"]) == 1
    call_id = assistant["tool_calls"][0]["id"]
    assert call_id
    assert tool_message["tool_call_id"] == call_id
    assert tool_message["tool_name"] == "look_around"
    assert "Energy" in tool_message["content"]


async def test_run_runs_exactly_max_breaths_and_skips_trailing_sleep(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    mock_decider: MockDecider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr("agents.runtime.asyncio.sleep", fake_sleep)
    agent = Agent(ADA, world, event_bus, populated_registry, mock_decider, pace=0.0)

    await agent.run(max_breaths=5)

    assert agent.breath_count == 5
    assert sleeps == [0.0, 0.0, 0.0, 0.0]  # five breaths, trailing sleep skipped


async def test_empty_tool_calls_decision_completes_without_crash(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(text="Just musing aloud.")])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()

    assert agent.breath_count == 1
    assert [m["role"] for m in agent.lifecycle_history] == ["system", "user", "assistant"]
    assert agent.lifecycle_history[-1]["content"] == "Just musing aloud."


async def test_unknown_tool_is_caught_and_fed_back_loop_continues(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(tool_calls=[ToolCall("teleport")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()  # must not raise

    assert [m["role"] for m in agent.lifecycle_history] == ["system", "user", "assistant", "tool"]
    tool_message = agent.lifecycle_history[-1]
    assert tool_message["tool_name"] == "teleport"
    assert "could not" in tool_message["content"].lower()
    assert agent.breath_count == 1
    assert agent.alive


async def test_decide_that_raises_rolls_back_perception(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = ScriptedDecider([RuntimeError("model is down")])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()  # must not raise

    # The perception user turn was rolled back so history never has two users.
    assert [m["role"] for m in agent.lifecycle_history] == ["system"]
    assert agent.breath_count == 1
    assert agent.alive


async def test_decide_with_unschemad_tool_rolls_back_perception(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A registered tool lacking a TOOL_SCHEMAS entry must not break atomicity.

    ``schemas_for()`` raising (e.g. KeyError for a dynamically-registered tool with
    no schema) must be caught inside ``decide`` like any decide failure: roll back
    the perception turn and end the breath gracefully, never leaving two
    consecutive ``user`` turns that degrade the model.
    """

    async def rogue(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
        return "ok"  # pragma: no cover - schemas_for fails before this is invoked

    populated_registry.register("rogue_tool_without_schema", rogue)
    decider = ScriptedDecider([Decision(tool_calls=[ToolCall("wait")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()  # must not raise despite the missing schema

    assert [m["role"] for m in agent.lifecycle_history] == ["system"]
    assert agent.breath_count == 1
    assert agent.alive


async def test_no_two_consecutive_user_turns_across_mixed_breaths(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = ScriptedDecider(
        [
            Decision(tool_calls=[ToolCall("wait")]),
            RuntimeError("blip"),
            Decision(tool_calls=[ToolCall("wait")]),
        ]
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()  # ok
    await agent.breathe()  # decide raises -> rolled back
    await agent.breathe()  # ok

    assert agent.breath_count == 3
    assert _no_double_user(agent.lifecycle_history)


async def test_two_tool_decision_is_correctly_id_paired(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around"), ToolCall("wait")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()

    assistant = next(m for m in agent.lifecycle_history if m["role"] == "assistant")
    tool_messages = [m for m in agent.lifecycle_history if m["role"] == "tool"]
    call_ids = [call["id"] for call in assistant["tool_calls"]]
    assert len(call_ids) == 2
    assert all(call_ids)
    assert len(set(call_ids)) == 2  # ids are distinct per call
    assert [m["tool_call_id"] for m in tool_messages] == call_ids
    assert [m["tool_name"] for m in tool_messages] == ["look_around", "wait"]


async def test_failed_decide_backs_off_instead_of_busy_looping(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr("agents.runtime.asyncio.sleep", fake_sleep)
    decider = ScriptedDecider([RuntimeError("model is down")])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.run(max_breaths=2)

    assert agent.breath_count == 2
    # Two breaths, both failed: the one inter-breath sleep uses the backoff, not
    # the (zero) pace, so a downed model does not spin the loop.
    assert sleeps == [DECIDE_BACKOFF_SECONDS]
    assert agent.lifecycle_history == [agent.lifecycle_history[0]]  # only the system prompt


async def test_resource_keys_are_coerced_to_enum_before_tool_use(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    # The model emits JSON string keys; execute coerces them to ResourceTypes so
    # the mating tool (which keys on the enum) can process the escrow (DD6).
    decision = Decision(
        tool_calls=[
            ToolCall(
                "initiate_mating",
                {
                    "target": BORIS,
                    "message": "Will you join me?",
                    # Meets the mating minimums so the escrow is actually stored; the
                    # point of this test is the string-key -> enum coercion, not the rule.
                    "resources": {"energy": 50.0, "materials": 30.0},
                },
            )
        ]
    )
    decider = MockDecider([decision])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    energy_before = _live(world, ADA).current_energy

    await agent.breathe()

    proposal = world.get_agent_proposals(ADA, BORIS)
    assert proposal  # the escrow was actually stored
    assert set(proposal["resources"].keys()) == {ResourceTypes.ENERGY, ResourceTypes.MATERIALS}
    assert _live(world, ADA).current_energy == energy_before - 50.0


# ---------------------------------------------------------------------------
# 9.2 Perception
# ---------------------------------------------------------------------------


async def test_perceive_includes_local_speak_and_drains_inbox(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    await populated_registry.invoke("speak", BORIS, {"message": "Greetings, traveller."})

    await agent.perceive()

    perception = agent.lifecycle_history[-1]
    assert perception["role"] == "user"
    content = perception["content"]
    assert "Greetings, traveller." in content
    assert "Boris" in content and BORIS in content  # attributed to the speaker (name + id)
    assert "says" in content  # a broadcast, not a whisper
    assert event_bus.get_events(ADA) == []  # inbox drained


async def test_perceive_marks_a_whisper_as_private(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A targeted message is rendered as a private whisper, not a public broadcast."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    await populated_registry.invoke("speak", BORIS, {"message": "Just between us.", "target": ADA})

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "Just between us." in content
    assert "whispers to you" in content  # listener knows it was private
    assert "Boris" in content  # still attributed


async def test_perceive_contains_self_state_and_region_snapshot(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "100.0" in content  # own energy
    assert "50.0" in content  # own materials
    assert "alpha" in content  # own position
    assert "alive" in content  # own status
    assert "Boris" in content  # co-located agent
    assert BORIS in content  # ...and its id, so it can be targeted by a tool
    assert "beta" in content  # region connection


async def test_perceive_surfaces_standing_incoming_mating_offer(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A pending offer to the agent is shown every breath (not just the arrival event)."""
    world.add_proposal(BORIS, ADA, {ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0})
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "Mating offers awaiting a reply" in content
    assert BORIS in content  # the initiator's id, so the agent can accept/reject it
    assert "accept_mating" in content and "reject_mating" in content


async def test_perceive_surfaces_outstanding_outgoing_mating_offer(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """The proposer is reminded of its own outstanding offer awaiting a reply."""
    world.add_proposal(ADA, BORIS, {ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0})
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "awaiting an answer to your mating offer" in content
    assert BORIS in content  # the target's id


# ---------------------------------------------------------------------------
# Context-engineering gap-fill: the agent must perceive its own condition and
# its surroundings fully enough to act on them (Findings 2, 3, 5, 9).
# ---------------------------------------------------------------------------


async def test_perceive_names_self_with_id(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """The agent sees its own name and id (Finding 9), so it can recognise itself when
    others address it by id in events and standing offers."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert f"You are Ada [id: {ADA}]" in content


async def test_perceive_shows_reproductive_self_state_when_available(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A never-mated agent sees a zero offspring count and that it may mate now (Finding 2)."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "Children brought into the world: 0" in content
    assert "able to bring a child into the world now" in content


async def test_perceive_shows_mating_cooldown_remaining(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """Just after mating, perception reports the cooldown, not availability (Finding 2).

    The agent reads the same frozen clock the world does, so recording a mating at
    ``world.now()`` leaves the full cooldown outstanding at perception time.
    """
    assert world.record_mating(ADA, world.now()) is True
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "Children brought into the world: 1" in content
    assert "not yet time to bring another child" in content
    assert "able to bring a child into the world now" not in content


async def test_perceive_reports_offspring_cap_reached(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """At the per-agent offspring cap, perception says no more children are possible (Finding 2)."""
    for _ in range(MATING_MAX_OFFSPRING):
        assert world.record_mating(ADA, world.now()) is True
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert f"Children brought into the world: {MATING_MAX_OFFSPRING}" in content
    assert "all the children into the world that you can" in content


async def test_perceive_shows_neighbor_energy_and_materials(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A co-located agent is described with its energy and materials (Finding 3), so the
    perceiver can judge it as a mating partner or attack target -- not just a bare name."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert f"Boris [id: {BORIS}] (energy 100.0, materials 50.0)" in content


async def test_perceive_shows_region_capacity_and_regeneration(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """The region block surfaces the resource ceiling and renewal rate (Finding 5), so the
    agent can tell a rich place from a near-exhausted one and whether what it takes returns."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)

    await agent.perceive()

    content = agent.lifecycle_history[-1]["content"]
    assert "of up to 500.0" in content  # the region ceiling, not just the current level
    assert "the land renews about 1.0 each moment" in content  # the regeneration rate


async def test_breathing_loop_completes_a_mating_end_to_end(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """The full perceive->decide->execute chain closes the mating arc into a birth.

    The tool layer (accept -> spawn) and the perception layer (a standing offer is
    surfaced) are each covered in isolation; this drives the WHOLE loop through two
    Agent runtimes -- the initiator proposes on one breath, then the acceptor PERCEIVES
    the standing offer and its decider chooses ``accept_mating`` -- and asserts a new
    agent is born. This is the deterministic proof of the arc the live qwen3 run is
    meant to exhibit; the 600s proposal-timeout retune matters precisely because it
    keeps the offer alive long enough for the acceptor's next breath to reach it.

    Resources use string keys (``{"energy": ...}``) to replicate the real decide path,
    where the local-LLM decider emits JSON the mating tool must clean.
    """
    before = {agent.id for agent in world.get_all_agents()}

    joe = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider(
            [
                Decision(
                    tool_calls=[
                        ToolCall(
                            "initiate_mating",
                            {
                                "target": BORIS,
                                "message": "Build a life with me.",
                                "resources": {"energy": 50.0, "materials": 30.0},
                            },
                        )
                    ]
                )
            ]
        ),
        pace=0.0,
    )
    mae = Agent(
        BORIS,
        world,
        event_bus,
        populated_registry,
        MockDecider(
            [Decision(tool_calls=[ToolCall("accept_mating", {"target": ADA, "message": "Yes."})])]
        ),
        pace=0.0,
    )

    joe_state = world.get_agent(ADA)
    mae_state = world.get_agent(BORIS)
    assert joe_state is not None and mae_state is not None

    await joe.breathe()  # proposes: escrow deducted, proposal stored
    await mae.breathe()  # perceives the standing offer, accepts -> birth

    after = {agent.id for agent in world.get_all_agents()}
    newborn_ids = after - before
    assert len(newborn_ids) == 1  # exactly one offspring was born
    (newborn_id,) = newborn_ids
    newborn = world.get_agent(newborn_id)
    assert newborn is not None
    assert newborn.status is AgentStatus.ALIVE
    assert newborn.current_position == "alpha"  # born where the acceptor stands
    assert newborn.persona == f"{joe_state.persona}|{mae_state.persona}"
    # The birth is announced as an agent_born event sourced from the newborn.
    born_events = [e for e in event_bus.get_events(ADA) if e.type == "agent_born"]
    assert len(born_events) == 1 and born_events[0].source == newborn_id
    # The proposal is consumed, not left dangling.
    assert world.get_agent_proposals(ADA, BORIS) == {}


# ---------------------------------------------------------------------------
# Sprint 6 T5: revisit items (low-energy attack warning; abort-on-paralyze)
# ---------------------------------------------------------------------------


def test_low_energy_attack_warning_in_perception(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """Below ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD, perception warns of paralysis."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 8.0))  # 8 energy
    text = agent._render_perception([])
    assert "⚠" in text and "paralyzed" in text.lower()


async def test_execute_aborts_remaining_calls_when_paralyzed_midbreath(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """If a tool call paralyzes the agent, later calls in the same breath are skipped."""
    # speak costs 0.5; drive ADA to 5.5 so the first speak -> 5.0 => PARALYZED.
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 5.5))
    await agent.execute(
        [ToolCall("speak", {"message": "one"}), ToolCall("speak", {"message": "two"})]
    )
    # The second call must produce a skipped tool message (not a real action).
    tool_msgs = [m for m in agent.lifecycle_history if m["role"] == "tool"]
    assert any(
        "could not act" in m["content"].lower() or "paralyzed" in m["content"].lower()
        for m in tool_msgs
    )


# ---------------------------------------------------------------------------
# 9.3 Status (paralysis is recoverable; only death is terminal -- Sprint 6 T1)
# ---------------------------------------------------------------------------


async def test_paralyzed_agent_loop_continues_and_only_drains(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A PARALYZED agent keeps _can_continue True, takes no action, and drains its inbox."""
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    # Drive ADA to paralysis directly via the world (sole status writer).
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 1.0))  # ~1 energy
    assert _live(world, ADA).status is AgentStatus.PARALYZED
    history_len_before = len(agent.lifecycle_history)

    # Put an event in ADA's inbox; a paralyzed breath should drain (not append) it.
    await event_bus.publish(
        Event(
            "speak",
            BORIS,
            {"message": "hi"},
            scope=ScopeType.LOCAL,
            region=_live(world, ADA).current_position,
        )
    )
    await agent.breathe()

    assert agent._can_continue(None) is True  # paralysis is NOT terminal
    assert len(agent.lifecycle_history) == history_len_before  # no perceive-append
    assert event_bus.get_events(ADA) == []  # inbox was drained
    assert agent.breath_count == 1


async def test_dead_agent_loop_terminates(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.update_agent_status(ADA, AgentStatus.DEAD)
    assert agent._can_continue(None) is False


async def test_revived_agent_acts_again(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """Fed back above the threshold, a previously-paralyzed agent decides and acts."""
    decider = MockDecider(
        [
            Decision(tool_calls=[ToolCall("look_around")]),
            Decision(tool_calls=[ToolCall("look_around")]),
        ]
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 1.0))
    await agent.breathe()  # paralyzed: drains only
    world.modify_agent_energy(ADA, 50.0)  # fed -> revives ALIVE
    await agent.breathe()  # now acts
    assert any(m["role"] == "assistant" for m in agent.lifecycle_history)


async def test_breath_into_paralysis_emits_event_and_loop_survives(world: WorldState) -> None:
    bus, registry, log = _wired(world, with_log=True)
    assert log is not None
    world.modify_agent_energy(ADA, -94.5)  # 100.0 -> 5.5, still ALIVE (> 5.0)
    assert _live(world, ADA).status is AgentStatus.ALIVE
    decider = MockDecider([Decision(tool_calls=[ToolCall("speak", {"message": "Fading..."})])])
    agent = Agent(ADA, world, bus, registry, decider, pace=0.0)

    await agent.run(max_breaths=10)

    assert _live(world, ADA).status is AgentStatus.PARALYZED  # speak's 0.5 cost: 5.5 -> 5.0
    assert agent.breath_count == 10  # the loop kept breathing through paralysis (did NOT stop)
    assert agent._can_continue(None) is True  # paralysis is NOT terminal; the loop survives
    paralyzed = [event for event in log.events if event.type == "agent_paralyzed"]
    assert len(paralyzed) == 1  # the transition fires exactly once, not every frozen breath


async def test_run_does_not_act_for_dead_agent(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(tool_calls=[ToolCall("wait")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    world.update_agent_status(ADA, AgentStatus.DEAD)

    await agent.run(max_breaths=5)

    assert agent.breath_count == 0
    assert not agent.alive


# ---------------------------------------------------------------------------
# Sprint 6 review fixes: runtime robustness
# ---------------------------------------------------------------------------


async def test_execute_recall_that_raises_is_caught_and_paired(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A recall whose backend raises still produces a paired tool turn, never dangling.

    In production ``recall`` hits a real vector store that can raise; the assistant
    turn must never be left with an unpaired tool call (which would corrupt history).
    """

    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("vector store unavailable")

    monkeypatch.setattr(memory_store, "recall", boom)
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), memory=memory_store)

    await agent.execute([ToolCall(RECALL_TOOL_NAME, {"query": "anything"})])

    tool_msgs = [m for m in agent.lifecycle_history if m["role"] == "tool"]
    assert len(tool_msgs) == 1  # the call is paired, not dangling
    assert "could not" in tool_msgs[0]["content"].lower()


async def test_reflection_skipped_when_paralyzed_midbreath(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    """A reflection-cadence breath that paralyzes the agent mid-breath spends no Ollama on it."""
    reflection = Decision(
        tool_calls=[ToolCall("remember", {"content": "I reflected.", "importance": "high"})]
    )
    decider = ReflectAwareDecider(
        action=Decision(tool_calls=[ToolCall("speak", {"message": "Fading..."})]),
        reflection=reflection,
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)
    # 5.5 energy: the speak action costs 0.5 -> 5.0 => PARALYZED mid-breath.
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 5.5))
    agent.breath_count = REFLECT_EVERY_N_BREATHS - 1  # next breath is a reflection breath

    await agent.breathe()

    assert _live(world, ADA).status is AgentStatus.PARALYZED
    assert reflection not in decider.history  # reflection never ran on the frozen agent
    assert memory_store.memory_count() == 0  # nothing was authored


async def test_paralyzed_breath_resets_last_decide_failed(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A drain-only paralyzed breath clears the stale decide-failed backoff flag."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - 1.0))  # PARALYZED
    agent._last_decide_failed = True  # left over from a prior failed decide

    await agent.breathe()

    assert agent._last_decide_failed is False  # a paralyzed breath performs no decide


def test_perception_annotates_non_alive_neighbors(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """Corpses / fallen agents in the region are labelled, not shown as normal neighbours."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    assert world.kill_agent(BORIS) is True

    text = agent._render_perception([])

    assert "Boris" in text
    assert "(dead)" in text  # marked as a corpse, not an ordinary neighbour


def test_low_energy_attack_warning_fires_at_exact_threshold(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """At exactly ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD the warning still fires.

    Attacking from 15.0 lands at 5.0, which is <= the paralysis threshold and DOES
    paralyse, so the advisory must include the boundary (a ``<`` would miss it).
    """
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    threshold = ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD
    world.modify_agent_energy(ADA, -(_live(world, ADA).current_energy - threshold))
    text = agent._render_perception([])
    assert "⚠" in text and "paralyzed" in text.lower()


# ---- Sprint 5: memory + reflection integration --------------------------------


class ReflectAwareDecider:
    """Returns one decision for action turns, another when reflection tools appear.

    Lets a single decider serve both the action ``decide`` and the reflection call
    in the breathing loop without brittle script-position counting: it branches on
    whether the offered tools include ``remember`` (the reflection toolset).
    """

    def __init__(self, action: Decision, reflection: Decision) -> None:
        self._action = action
        self._reflection = reflection
        self.history: list[Decision] = []

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        names = {tool["function"]["name"] for tool in tools}
        decision = self._reflection if "remember" in names else self._action
        self.history.append(decision)
        return decision


async def test_memories_live_in_resident_block_not_perception(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    memory_store.append_memory("Kai betrayed me in the meadow.", Importance.HIGH, breath=0)
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("wait")])]),
        memory=memory_store,
    )

    # The memory is resident at [1] (user) with the agent's ack at [2] (assistant).
    assert agent.lifecycle_history[1]["role"] == "user"
    assert "Kai betrayed me" in agent.lifecycle_history[1]["content"]
    assert agent.lifecycle_history[2]["role"] == "assistant"

    await agent.perceive()

    perception = agent.lifecycle_history[-1]
    assert perception["role"] == "user"
    assert "Kai betrayed me" not in perception["content"]  # perception is pure sensory now
    roles = [m["role"] for m in agent.lifecycle_history]
    assert not any(roles[i] == roles[i + 1] == "user" for i in range(len(roles) - 1))


async def test_resident_block_absent_for_memory_less_agent(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider())  # NULL_MEMORY

    # No block injected: history is just the system turn (non-breaking for ~30 sites).
    assert [m["role"] for m in agent.lifecycle_history] == ["system"]


async def test_resident_block_byte_stable_across_a_breath(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    memory_store.append_memory("a durable memory", Importance.HIGH, breath=0)
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("wait")])]),
        memory=memory_store,
    )
    block_before = dict(agent.lifecycle_history[1])
    ack_before = dict(agent.lifecycle_history[2])

    await agent.perceive()  # a non-reflection step must not disturb the block

    assert agent.lifecycle_history[1] == block_before  # byte-stable -> KV cache stays warm
    assert agent.lifecycle_history[2] == ack_before
    assert agent.lifecycle_history[-1]["role"] == "user"


async def test_reflection_refreshes_resident_block(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    decider = ReflectAwareDecider(
        action=Decision(tool_calls=[ToolCall("wait")]),
        reflection=Decision(
            tool_calls=[
                ToolCall(
                    "remember",
                    {"content": "I have made a friend in Mara.", "importance": "high"},
                )
            ]
        ),
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)
    assert "Mara" not in agent.lifecycle_history[1]["content"]  # not yet remembered

    await agent.reflect()

    assert "friend in Mara" in agent.lifecycle_history[1]["content"]  # now resident


async def test_resident_block_nudges_to_recall_when_overflowed(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import constants

    monkeypatch.setattr(constants, "MEMORY_RESIDENT_CAP", 1)
    memory_store.append_memory("oldest", Importance.LOW, 0)
    memory_store.append_memory("the lasting one", Importance.HIGH, 1)
    memory_store.append_memory("newest", Importance.LOW, 2)
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), memory=memory_store)

    block = agent.lifecycle_history[1]["content"]
    assert "search your memory" in block.lower()  # overflow -> nudge toward recall


async def test_reflection_fires_on_nth_breath_and_persists(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import agents.runtime as runtime_module

    monkeypatch.setattr(runtime_module, "REFLECT_EVERY_N_BREATHS", 2)
    decider = ReflectAwareDecider(
        action=Decision(tool_calls=[ToolCall("wait")]),
        reflection=Decision(
            tool_calls=[ToolCall("remember", {"content": "I trust no one.", "importance": "high"})]
        ),
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)

    await agent.breathe()  # breath 1: (0+1)%2 != 0 -> no reflection
    assert memory_store.retrieve("trust", current_breath=1, k=5) == []

    await agent.breathe()  # breath 2: (1+1)%2 == 0 -> reflection fires
    surfaced = memory_store.retrieve("trust", current_breath=2, k=5)
    assert any("trust no one" in m.content.lower() for m in surfaced)


async def test_reflection_does_not_fire_before_nth_breath(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    # Default cadence is 12; a single breath must not reflect.
    decider = ReflectAwareDecider(
        action=Decision(tool_calls=[ToolCall("wait")]),
        reflection=Decision(
            tool_calls=[ToolCall("remember", {"content": "premature", "importance": "low"})]
        ),
    )
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)

    await agent.breathe()

    assert memory_store.retrieve("premature", current_breath=1, k=5) == []


async def test_revise_self_rebuilds_system_turn(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider(
            [Decision(tool_calls=[ToolCall("revise_self", {"identity": "I am reborn, wary."})])]
        ),
        memory=memory_store,
    )

    await agent.reflect()

    assert "reborn, wary" in agent.lifecycle_history[0]["content"]
    assert "reborn, wary" in memory_store.load_identity()


async def test_reflection_with_no_tool_calls_does_not_crash(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA, world, event_bus, populated_registry, MockDecider([Decision()]), memory=memory_store
    )

    await agent.reflect()  # Probe-A path: model authors nothing -> no raise, no write

    assert memory_store.retrieve("anything", current_breath=1, k=5) == []


async def test_system_turn_byte_stable_across_breaths_without_revise(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("wait")])]),
        memory=memory_store,
    )
    before = agent.lifecycle_history[0]["content"]

    await agent.breathe()
    await agent.breathe()

    assert agent.lifecycle_history[0]["content"] == before  # KV-cache discipline guard


async def test_reflection_swallows_decider_failure(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        ScriptedDecider([RuntimeError("model down")]),
        memory=memory_store,
    )

    await agent.reflect()  # a failing decider must not crash reflection

    assert memory_store.retrieve("anything", current_breath=1, k=5) == []


async def test_remember_ignores_blank_content(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider(
            [Decision(tool_calls=[ToolCall("remember", {"content": "   ", "importance": "high"})])]
        ),
        memory=memory_store,
    )

    await agent.reflect()

    assert memory_store.retrieve("anything", current_breath=1, k=5) == []


async def test_remember_falls_back_to_medium_on_bad_importance(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider(
            [
                Decision(
                    tool_calls=[
                        ToolCall("remember", {"content": "a thing", "importance": "urgent"})
                    ]
                )
            ]
        ),
        memory=memory_store,
    )

    await agent.reflect()

    surfaced = memory_store.retrieve("a thing", current_breath=1, k=5)
    assert surfaced and surfaced[0].importance is Importance.MEDIUM


async def test_revise_self_ignores_blank_identity(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("revise_self", {"identity": "  "})])]),
        memory=memory_store,
    )
    before = agent.lifecycle_history[0]["content"]

    await agent.reflect()

    assert agent.lifecycle_history[0]["content"] == before


async def test_reflection_ignores_unexpected_tool(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("look_around")])]),
        memory=memory_store,
    )

    await agent.reflect()  # unexpected tool offered nowhere -> ignored, no crash

    assert memory_store.retrieve("anything", current_breath=1, k=5) == []


# ---- Sprint 5.1: the recall action --------------------------------------------


class ToolsCapturingDecider:
    """Records the tool schemas offered on the latest ``decide`` call."""

    def __init__(self) -> None:
        self.tools: list[dict[str, Any]] = []

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        self.tools = tools
        return Decision()


async def test_recall_offered_in_action_schemas_when_memory_present(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    decider = ToolsCapturingDecider()
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)

    await agent.decide()

    names = {tool["function"]["name"] for tool in decider.tools}
    assert "recall" in names
    assert "look_around" in names  # registry tools still offered alongside recall


async def test_recall_not_offered_without_memory(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
) -> None:
    decider = ToolsCapturingDecider()
    agent = Agent(ADA, world, event_bus, populated_registry, decider)  # NULL_MEMORY default

    await agent.decide()

    names = {tool["function"]["name"] for tool in decider.tools}
    assert "recall" not in names  # a memory-less being cannot search a memory


async def test_execute_routes_recall_to_memory_not_registry(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    memory_store.append_memory("the spring lies east of the dead oak", Importance.LOW, breath=0)
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), memory=memory_store)

    await agent.execute([ToolCall("recall", {"query": "where is the spring"})])

    last = agent.lifecycle_history[-1]
    assert last["role"] == "tool"
    assert last["tool_name"] == "recall"
    # Routed to memory, NOT the registry: the registry would reject the unknown
    # tool with the "could not be performed" sentinel.
    assert "could not be performed" not in last["content"]


async def test_execute_recall_tolerates_missing_query(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), memory=memory_store)

    await agent.execute([ToolCall("recall", {})])  # no query key -> empty search, no crash

    last = agent.lifecycle_history[-1]
    assert last["role"] == "tool"
    assert last["tool_name"] == "recall"


# ---- Sprint 5.5: transcript compaction ----------------------------------------


class CompactionScriptDecider:
    """Branches by the offered tools: compaction (no tools) -> recap text; reflection
    (has 'remember') -> nothing; otherwise an action with large hidden thinking that
    grows the transcript fast. Records every tools list it was offered."""

    def __init__(self, thinking_chars: int = 0, recap_text: str = "Lately, life happened.") -> None:
        self.thinking = "t" * thinking_chars
        self.recap_text = recap_text
        self.tools_seen: list[list[dict[str, Any]]] = []

    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        self.tools_seen.append(tools)
        names = {t["function"]["name"] for t in tools}
        if not tools:  # the compaction call passes tools=[]
            return Decision(text=self.recap_text)
        if "remember" in names:  # the reflection call
            return Decision()
        return Decision(text="I wait.", thinking=self.thinking, tool_calls=[ToolCall("wait")])


def _shrink_budget(monkeypatch: pytest.MonkeyPatch, **overrides: int) -> None:
    """Patch the compaction budget constants in the runtime module to test-sized values."""
    defaults = {
        "PROMPT_BUDGET_TOKENS": 8000,
        "COMPACTION_HARD_SAFETY_TOKENS": 7000,
        "COMPACTION_TRIGGER_TOKENS": 4000,
        "COMPACTION_TARGET_TOKENS": 2000,
        "COMPACTION_KEEP_RECENT_TURNS": 4,
        "COMPACTION_RECAP_RESERVE_TOKENS": 100,
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        monkeypatch.setattr(runtime_module, name, value)


async def test_compaction_fires_over_trigger_and_installs_recap(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _shrink_budget(monkeypatch)
    decider = CompactionScriptDecider(thinking_chars=1200)  # ~340 tok/breath
    agent = Agent(ADA, world, event_bus, populated_registry, decider)  # NULL memory

    for _ in range(12):
        await agent.breathe()

    assert agent._recap_installed  # the transcript grew past the trigger and compacted
    recap = agent.lifecycle_history[agent._recap_index()]
    assert recap["role"] == "user"
    assert "Lately, life happened." in recap["content"]


async def test_recap_stays_bounded_across_many_compactions(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A verbose recap model must not grow the recap turn without bound."""
    _shrink_budget(monkeypatch)
    # A decider whose recap text is huge every time -> tests the authoring-time bound.
    verbose = "and then more happened, " * 500

    class VerboseRecapDecider(CompactionScriptDecider):
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            if not tools:
                return Decision(text=verbose)
            return await super().decide(messages, tools)

    agent = Agent(ADA, world, event_bus, populated_registry, VerboseRecapDecider(1500))

    for _ in range(20):
        await agent.breathe()

    assert agent._recap_installed
    recap_tokens = estimate_tokens([agent.lifecycle_history[agent._recap_index()]], [])
    # Bounded by the reserve (+ small framing/marker overhead), not the verbose text.
    assert recap_tokens <= runtime_module.COMPACTION_RECAP_RESERVE_TOKENS + 50


async def test_prompt_never_exceeds_budget_over_many_breaths(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The headline guarantee: the assembled prompt never exceeds PROMPT_BUDGET."""
    _shrink_budget(monkeypatch)
    decider = CompactionScriptDecider(thinking_chars=1500)
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    for breath in range(40):
        await agent.breathe()
        estimate = estimate_tokens(agent.lifecycle_history, agent._action_schemas())
        assert estimate <= runtime_module.PROMPT_BUDGET_TOKENS, (
            f"breath {breath}: estimate {estimate} exceeded budget"
        )
        assert _no_double_user(agent.lifecycle_history)


async def test_compaction_keeps_tail_on_user_turn(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _shrink_budget(monkeypatch)
    decider = CompactionScriptDecider(thinking_chars=1500)
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    for _ in range(12):
        await agent.breathe()

    # The first verbatim turn after the recap pair must be a perception (user).
    first_verbatim = agent.lifecycle_history[agent._prefix_len()]
    assert first_verbatim["role"] == "user"
    assert _no_double_user(agent.lifecycle_history)


async def test_compaction_passes_no_tools_to_the_recap_call(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _shrink_budget(monkeypatch)
    decider = CompactionScriptDecider(thinking_chars=1500)
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    for _ in range(12):
        await agent.breathe()

    assert any(tools == [] for tools in decider.tools_seen)  # H3: recap call gets no tools


async def test_compaction_is_mechanical_when_decider_fails(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C2: even if the recap LLM call fails, the oldest turns are still evicted."""
    _shrink_budget(monkeypatch)

    class FailingRecapDecider(CompactionScriptDecider):
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            if not tools:  # the compaction call -> blow up
                raise RuntimeError("recap model down")
            return await super().decide(messages, tools)

    decider = FailingRecapDecider(thinking_chars=1500)
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    for _ in range(20):
        await agent.breathe()  # must never raise despite recap failures

    estimate = estimate_tokens(agent.lifecycle_history, agent._action_schemas())
    assert estimate <= runtime_module.PROMPT_BUDGET_TOKENS  # bounded by mechanical eviction alone


async def test_hard_safety_net_forces_compaction(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even when the estimate is under target, a too-large ACTUAL last prompt compacts."""
    _shrink_budget(monkeypatch, COMPACTION_TRIGGER_TOKENS=10_000)  # estimate never trips it
    decider = CompactionScriptDecider(thinking_chars=400)
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    # Seed several verbatim turns, then pretend the real prompt came back huge.
    for _ in range(4):
        await agent.breathe()
    assert not agent._recap_installed  # estimate-trigger was raised out of reach
    agent._last_prompt_tokens = runtime_module.COMPACTION_HARD_SAFETY_TOKENS + 1

    await agent.breathe()

    assert agent._recap_installed  # the actual-token net forced a compaction


async def test_recap_pair_sits_after_memory_block(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _shrink_budget(monkeypatch)
    memory_store.append_memory("I carry a vow.", Importance.HIGH, breath=0)
    decider = CompactionScriptDecider(thinking_chars=1500)
    agent = Agent(ADA, world, event_bus, populated_registry, decider, memory=memory_store)

    for _ in range(12):
        await agent.breathe()

    # [0]=system [1]=block(user) [2]=block-ack [3]=recap(user) [4]=recap-ack
    assert agent._recap_installed and agent._recap_index() == 3
    assert agent.lifecycle_history[1]["role"] == "user"  # memory block
    assert agent.lifecycle_history[3]["role"] == "user"  # recap
    assert "I carry a vow." in agent.lifecycle_history[1]["content"]  # block intact
    assert _no_double_user(agent.lifecycle_history)


async def test_live_turns_excludes_recap_scaffolding(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _shrink_budget(monkeypatch)
    decider = CompactionScriptDecider(thinking_chars=1500, recap_text="UNIQUE_RECAP_MARKER")
    agent = Agent(ADA, world, event_bus, populated_registry, decider)

    for _ in range(12):
        await agent.breathe()

    assert agent._recap_installed
    live = agent._live_turns()
    assert all("UNIQUE_RECAP_MARKER" not in str(m.get("content", "")) for m in live)


def test_floor_net_shrinks_a_single_oversized_turn(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A lone surviving turn bigger than the budget (e.g. a huge perception, which the
    generation reserve does NOT bound) must still be shrunk to fit (review finding C1)."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider())  # NULL memory
    agent.lifecycle_history.append({"role": "user", "content": "x" * 200_000})
    tools = agent._action_schemas()
    fixed = estimate_tokens([agent.lifecycle_history[0]], tools)
    monkeypatch.setattr(runtime_module, "PROMPT_BUDGET_TOKENS", fixed + 500)
    assert estimate_tokens(agent.lifecycle_history, tools) > runtime_module.PROMPT_BUDGET_TOKENS

    agent._enforce_prompt_budget(tools)

    assert estimate_tokens(agent.lifecycle_history, tools) <= runtime_module.PROMPT_BUDGET_TOKENS


def test_floor_net_logs_critical_when_tools_alone_exceed_budget(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The irreducible floor: tool schemas are unshrinkable, so if they alone exceed the
    budget no truncation can make the prompt fit. The loop empties every turn, logs
    CRITICAL (observable, not silent), and returns without crashing -- the honest floor."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider())
    agent.lifecycle_history.append({"role": "user", "content": "a perception " * 50})
    tools = agent._action_schemas()
    monkeypatch.setattr(runtime_module, "PROMPT_BUDGET_TOKENS", 1)  # below even the schemas

    with caplog.at_level(logging.CRITICAL):
        agent._enforce_prompt_budget(tools)

    assert any("tool schemas alone exceed" in r.message for r in caplog.records)
    assert all(m["content"] == "" for m in agent.lifecycle_history)  # every turn emptied trying


def test_floor_net_shrinks_scaffolding_when_it_alone_exceeds_budget(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even when the system prompt + tools alone exceed the budget (a misconfiguration),
    the prompt is STILL forced to fit -- the system turn is shrunk as the absolute last
    resort rather than the loop returning silently over budget (review finding)."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider())  # NULL memory
    tools = agent._action_schemas()
    # A budget below the system turn but above the (tiny, unshrinkable) tool schemas, so a
    # fit is reachable only by shrinking the system turn itself.
    tools_floor = estimate_tokens([{"role": "system", "content": ""}], tools)
    monkeypatch.setattr(runtime_module, "PROMPT_BUDGET_TOKENS", tools_floor + 50)
    assert estimate_tokens(agent.lifecycle_history, tools) > runtime_module.PROMPT_BUDGET_TOKENS

    agent._enforce_prompt_budget(tools)

    assert estimate_tokens(agent.lifecycle_history, tools) <= runtime_module.PROMPT_BUDGET_TOKENS


def test_floor_net_drops_oldest_breath_groups_as_last_resort(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no recap/block to shrink, the oldest whole breath-groups are dropped, always
    leaving the tail starting on a user turn (the last-resort never-overflow strategy)."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider())  # NULL: no block
    for i in range(4):
        perception = f"perception {i}: " + "road " * 300
        agent.lifecycle_history.append({"role": "user", "content": perception})
        agent.lifecycle_history.append({"role": "assistant", "content": f"act {i}"})
    tools = agent._action_schemas()
    # A budget that fits the system prefix plus only the final group -> older groups out.
    final_group = [agent.lifecycle_history[0], *agent.lifecycle_history[-2:]]
    budget = estimate_tokens(final_group, tools) + 50
    monkeypatch.setattr(runtime_module, "PROMPT_BUDGET_TOKENS", budget)
    assert estimate_tokens(agent.lifecycle_history, tools) > budget

    agent._enforce_prompt_budget(tools)

    assert estimate_tokens(agent.lifecycle_history, tools) <= budget
    assert agent.lifecycle_history[1]["role"] == "user"  # tail begins on a user turn
    assert _no_double_user(agent.lifecycle_history)


def test_floor_overflow_net_truncates_block_to_fit(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
    memory_store: FileMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When system+block alone exceed budget, the in-context block is truncated to fit."""
    for i in range(120):  # a large resident block
        memory_store.append_memory(f"memory number {i} about the road and trust", Importance.LOW, i)
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), memory=memory_store)

    tools = agent._action_schemas()
    fixed = estimate_tokens([agent.lifecycle_history[0]], tools)  # system + tools
    monkeypatch.setattr(runtime_module, "PROMPT_BUDGET_TOKENS", fixed + 600)
    monkeypatch.setattr(runtime_module, "COMPACTION_RECAP_RESERVE_TOKENS", 50)
    assert estimate_tokens(agent.lifecycle_history, tools) > runtime_module.PROMPT_BUDGET_TOKENS

    agent._enforce_prompt_budget(tools)

    assert estimate_tokens(agent.lifecycle_history, tools) <= runtime_module.PROMPT_BUDGET_TOKENS

"""Tests for the agent breathing loop (:mod:`agents.runtime`).

Covers the Phase-3 acceptance suite (design spec Sections 9.1-9.3): loop
mechanics, perception, and the paralysis status boundary. Every test is
deterministic -- it drives the loop with a scripted decider (no live Ollama), the
seeded ``world`` fixture, and ``pace=0`` so no test sleeps for real (see
``CLAUDE.md`` Section 5).
"""

from __future__ import annotations

from typing import Any

import pytest

from agents.decider import Decision, ToolCall
from agents.runtime import DECIDE_BACKOFF_SECONDS, Agent
from bus.event_bus import EventBus
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
                    "resources": {"energy": 10.0, "materials": 5.0},
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
    assert _live(world, ADA).current_energy == energy_before - 10.0


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
    assert "Greetings, traveller." in perception["content"]
    assert event_bus.get_events(ADA) == []  # inbox drained


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
    assert "beta" in content  # region connection


# ---------------------------------------------------------------------------
# 9.3 Status (paralysis only; death is Sprint 6)
# ---------------------------------------------------------------------------


async def test_breath_into_paralysis_emits_event_and_stops_run(world: WorldState) -> None:
    bus, registry, log = _wired(world, with_log=True)
    assert log is not None
    world.modify_agent_energy(ADA, -94.5)  # 100.0 -> 5.5, still ALIVE (> 5.0)
    assert _live(world, ADA).status is AgentStatus.ALIVE
    decider = MockDecider([Decision(tool_calls=[ToolCall("speak", {"message": "Fading..."})])])
    agent = Agent(ADA, world, bus, registry, decider, pace=0.0)

    await agent.run(max_breaths=10)

    assert _live(world, ADA).status is AgentStatus.PARALYZED  # speak's 0.5 cost: 5.5 -> 5.0
    assert agent.breath_count == 1  # the loop stopped after paralysis
    assert not agent.alive
    paralyzed = [event for event in log.events if event.type == "agent_paralyzed"]
    assert len(paralyzed) == 1


async def test_run_does_not_act_for_dead_agent(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    decider = MockDecider([Decision(tool_calls=[ToolCall("wait")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    world.update_agent_status(ADA, AgentStatus.DEAD)

    await agent.run(max_breaths=5)

    assert agent.breath_count == 0
    assert not agent.alive


async def test_paralyzed_agent_breathe_perceives_but_does_not_act(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    world.modify_agent_energy(ADA, -100.0)  # 100.0 -> 0.0 -> PARALYZED
    assert _live(world, ADA).status is AgentStatus.PARALYZED
    decider = MockDecider([Decision(tool_calls=[ToolCall("wait")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()

    assert [m["role"] for m in agent.lifecycle_history] == ["system", "user"]  # perceived only
    assert decider.history == []  # decide was never called
    assert agent.breath_count == 1
    assert "paralyzed" in agent.lifecycle_history[-1]["content"]


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


async def test_surfaced_memories_appear_in_perception(
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

    await agent.perceive()

    perception = agent.lifecycle_history[-1]
    assert perception["role"] == "user"
    assert "Kai betrayed me" in perception["content"]
    roles = [m["role"] for m in agent.lifecycle_history]
    assert not any(roles[i] == roles[i + 1] == "user" for i in range(len(roles) - 1))


async def test_memories_appended_at_tail_not_mid_history(
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
    snapshot = list(agent.lifecycle_history)  # system turn only

    await agent.perceive()

    assert agent.lifecycle_history[: len(snapshot)] == snapshot  # prefix unchanged
    assert agent.lifecycle_history[-1]["role"] == "user"


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

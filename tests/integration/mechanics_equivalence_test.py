"""Golden-trace gate for mechanics-neutral infrastructure optimizations."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from agents.decider import Decision, ToolCall
from agents.runtime import Agent
from bus.event_bus import EventBus
from memory.store import NULL_MEMORY
from observability.event_log import CompositeEventLog, InMemoryEventLog, serialize_event
from observability.replay_archive import ReplayArchive
from observability.snapshot import serialize_world_snapshot
from tests.conftest import FakeClock, MockDecider
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.tick import tick
from world.world import WorldState

ADA = "wanderer_001"
FIXTURE_PATH = Path(__file__).parents[1] / "fixtures" / "mechanics_chronicle_digest.json"


async def test_seeded_mock_chronicle_matches_mechanics_digest(
    world: WorldState,
    fake_clock: FakeClock,
    tmp_path: Path,
) -> None:
    """Infrastructure changes must leave the normalized world chronology unchanged."""
    event_log = InMemoryEventLog()
    archive = ReplayArchive(tmp_path / "golden-run", "golden-run")
    bus = EventBus(world, event_log=CompositeEventLog(archive, event_log))
    for state in world.get_all_agents():
        bus.subscribe(state.id)

    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    decider = MockDecider(
        [
            Decision(
                tool_calls=[
                    ToolCall(
                        "harvest_resources",
                        {"resource_type": "energy", "amount": 10.0},
                    )
                ]
            ),
            Decision(tool_calls=[ToolCall("speak", {"message": "The meadow is awake."})]),
            Decision(tool_calls=[ToolCall("move", {"destination": "beta"})]),
        ]
    )
    agent = Agent(ADA, world, bus, registry, decider, memory=NULL_MEMORY)

    await agent.breathe()
    await agent.breathe()
    await agent.breathe()
    fake_clock.advance(5.0)
    await tick(world, bus)

    chronology = _normalized_chronology(world, event_log, agent.breath_count)
    digest = hashlib.sha256(_canonical_json(chronology)).hexdigest()
    expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    assert expected["schema"] == 1
    assert digest == expected["sha256"]
    assert chronology["snapshot"] == expected["snapshot"]
    assert chronology["events"] == expected["events"]
    assert [json.loads(line) for _, line in archive.iter_lines("events")] == chronology["events"]


def _normalized_chronology(
    world: WorldState,
    event_log: InMemoryEventLog,
    breath_count: int,
) -> dict[str, Any]:
    """Return stable mechanics state while excluding per-run infrastructure identity."""
    events = [serialize_event(event) for event in event_log.events]
    snapshot = serialize_world_snapshot(
        world,
        run_id="<run>",
        event_cursor=len(events),
    )
    return {
        "breath_count": breath_count,
        "events": events,
        "snapshot": snapshot,
    }


def _canonical_json(value: object) -> bytes:
    """Encode one normalized chronology deterministically for hashing."""
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")

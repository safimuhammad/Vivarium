"""Regression coverage for exact, bounded replay-page sizing."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from agents.decider import Decision, ToolCall
from bus.events import Event, ScopeType
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import Simulation
from server import app
from server.app import ServerSettings, create_app
from tests.conftest import MockDecider


def _exact_size(payload: dict[str, object]) -> int:
    """Return the response JSON byte size using the production wire settings."""
    return len(
        json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _event_records(count: int, *, first_cursor: int = 8) -> list[dict[str, object]]:
    """Return event-envelope records containing escaped and multibyte text."""
    records: list[dict[str, object]] = []
    for cursor in range(first_cursor + 1, first_cursor + count + 1):
        records.append(
            {
                "cursor": cursor,
                "event": {
                    "type": "speak",
                    "source": "being-\U0001fabb",
                    "payload": {
                        "message": (
                            f'line {cursor}: quote " slash \\ newline\\n tab\\t '
                            "caf\u00e9 \u4e16\u754c \U0001fabb"
                        )
                    },
                    "scope": "global",
                    "region": None,
                    "target": None,
                    "timestamp": float(cursor),
                },
                "resolved": {"actor_id": "being-\U0001fabb"},
                "snapshot_after": None,
            }
        )
    return records


def _checkpoint_records(count: int, *, first_line: int = 1) -> list[dict[str, object]]:
    """Return checkpoint-envelope records containing escaped and multibyte text."""
    records: list[dict[str, object]] = []
    for line in range(first_line, first_line + count):
        records.append(
            {
                "line": line,
                "checkpoint": {
                    "schema": 1,
                    "type": "world_snapshot_checkpoint",
                    "reason": "manual",
                    "run_id": "run-\u4e16\u754c-\U0001fabb",
                    "world_time": float(line),
                    "event_cursor": line,
                    "snapshot": {
                        "message": (
                            f'line {line}: quote " slash \\ newline\\n tab\\t '
                            "caf\u00e9 \u4e16\u754c \U0001fabb"
                        )
                    },
                },
            }
        )
    return records


def _reference_event_page_size(
    run_id: str,
    after: int,
    count: int,
    records: list[dict[str, object]],
) -> int:
    """Return the original whole-page event sizing calculation."""
    next_after = cast(int, records[-1]["cursor"]) if records else after
    return _exact_size(
        {
            "schema": 1,
            "run_id": run_id,
            "after": after,
            "next_after": next_after,
            "has_more": next_after < count,
            "truncated": True,
            "events": records,
        }
    )


def _reference_fit_events(
    run_id: str,
    after: int,
    count: int,
    records: list[dict[str, object]],
    budget: int,
) -> list[dict[str, object]]:
    """Return the prefix selected by the pre-optimization loop."""
    kept = records
    while len(kept) > 1 and _reference_event_page_size(run_id, after, count, kept) > budget:
        kept = kept[:-1]
    return kept


def _reference_checkpoint_page_size(
    run_id: str,
    before: int,
    records: list[dict[str, object]],
) -> int:
    """Return the original whole-page checkpoint sizing calculation."""
    next_before = cast(int, records[0]["line"]) if records else before
    return _exact_size(
        {
            "schema": 1,
            "run_id": run_id,
            "before": before,
            "next_before": next_before,
            "has_more": bool(records) and next_before > 1,
            "truncated": True,
            "checkpoints": records,
        }
    )


def _reference_fit_checkpoints(
    run_id: str,
    before: int,
    records: list[dict[str, object]],
    budget: int,
) -> list[dict[str, object]]:
    """Return the suffix selected by the pre-optimization loop."""
    kept = records
    while len(kept) > 1 and _reference_checkpoint_page_size(run_id, before, kept) > budget:
        kept = kept[1:]
    return kept


def _count_record_sizing_work(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Count record-sized JSON work while leaving the production encoder intact."""
    original_encoded_size = app._encoded_size
    work = [0]

    def counted_encoded_size(payload: dict[str, object]) -> int:
        if "events" in payload:
            events = payload["events"]
            assert isinstance(events, list)
            work[0] += len(events)
        elif "checkpoints" in payload:
            checkpoints = payload["checkpoints"]
            assert isinstance(checkpoints, list)
            work[0] += len(checkpoints)
        elif ("cursor" in payload and "event" in payload) or (
            "line" in payload and "checkpoint" in payload
        ):
            work[0] += 1
        return original_encoded_size(payload)

    monkeypatch.setattr(app, "_encoded_size", counted_encoded_size)
    return work


def test_event_fitting_bounds_json_record_work_when_over_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An oversized event page must not reserialize shrinking whole pages."""
    records = _event_records(24)
    work = _count_record_sizing_work(monkeypatch)
    monkeypatch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", 1)

    assert app._fit_event_records("run-\u4e16\u754c-\U0001fabb", 8, 32, records) == records[:1]
    assert work[0] <= len(records) * 2


def test_checkpoint_fitting_bounds_json_record_work_when_over_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An oversized checkpoint page must not reserialize shrinking whole pages."""
    records = _checkpoint_records(24)
    work = _count_record_sizing_work(monkeypatch)
    monkeypatch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", 1)

    assert app._fit_checkpoint_records("run-\u4e16\u754c-\U0001fabb", 25, records) == records[-1:]
    assert work[0] <= len(records) * 2


def test_event_fitting_matches_old_page_selection_at_exact_byte_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Event prefixes keep the old choice across UTF-8 and cursor-size boundaries."""
    run_id = "run-\u4e16\u754c-\U0001fabb"
    after = 8
    records = _event_records(12, first_cursor=after)
    count = cast(int, records[-1]["cursor"])

    for record_count in range(1, len(records) + 1):
        boundary = _reference_event_page_size(run_id, after, count, records[:record_count])
        for budget in (boundary - 1, boundary, boundary + 1):
            expected = _reference_fit_events(run_id, after, count, records, budget)
            with monkeypatch.context() as patch:
                patch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", budget)
                assert app._fit_event_records(run_id, after, count, records) == expected


def test_checkpoint_fitting_matches_old_page_selection_at_exact_byte_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Checkpoint suffixes keep the old choice across UTF-8 and line-size boundaries."""
    run_id = "run-\u4e16\u754c-\U0001fabb"
    records = _checkpoint_records(12)
    before = 13

    for record_count in range(1, len(records) + 1):
        boundary = _reference_checkpoint_page_size(run_id, before, records[-record_count:])
        for budget in (boundary - 1, boundary, boundary + 1):
            expected = _reference_fit_checkpoints(run_id, before, records, budget)
            with monkeypatch.context() as patch:
                patch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", budget)
                assert app._fit_checkpoint_records(run_id, before, records) == expected


def test_fitters_preserve_empty_and_singleton_records_below_the_page_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Record-level 413 guards remain responsible for a lone oversized record."""
    event = _event_records(1)
    checkpoint = _checkpoint_records(1)
    monkeypatch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", 1)

    assert app._fit_event_records("run", 8, 9, []) == []
    assert app._fit_event_records("run", 8, 9, event) == event
    assert app._fit_checkpoint_records("run", 2, []) == []
    assert app._fit_checkpoint_records("run", 2, checkpoint) == checkpoint


def _fake_vector_store_factory(_agent_id: str) -> VectorStore:
    """Return the deterministic vector store required by the live test app."""
    return FakeVectorStore(FakeEmbeddingFunction())


def _client(tmp_path: Path) -> TestClient:
    """Create a live API client with mocked local-model dependencies."""
    return TestClient(
        create_app(
            ServerSettings(
                memory_root=tmp_path / "memory",
                run_dir=tmp_path / "runs",
                duration=10.0,
                pace=0.0,
                world_tick_interval=60.0,
                refresh_interval=0.05,
                sse_poll_interval=0.01,
            ),
            decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
            vector_store_factory=_fake_vector_store_factory,
        )
    )


def _simulation(client: TestClient) -> Simulation:
    """Return the current simulation exposed by a started test client."""
    return cast(Simulation, cast(Any, client.app).state.simulation)


def _speech_event(index: int) -> Event:
    """Return an individually-small event whose pages need byte clamping."""
    return Event(
        "speak",
        "wanderer_001",
        {"message": f"event {index}: caf\u00e9 \u4e16\u754c \U0001fabb " + ("x" * 700)},
        scope=ScopeType.LOCAL,
        region="nirvana",
        timestamp=float(index),
    )


def _checkpoint_line(sim: Simulation, index: int) -> bytes:
    """Return one individually-small valid checkpoint record for ``sim``."""
    payload: dict[str, object] = {
        "schema": 1,
        "type": "world_snapshot_checkpoint",
        "reason": "manual",
        "run_id": sim.run_context.run_id,
        "world_time": float(index),
        "event_cursor": index,
        "snapshot": {
            "message": f"checkpoint {index}: caf\u00e9 \u4e16\u754c \U0001fabb " + ("x" * 700)
        },
    }
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _read_event_records(
    sim: Simulation,
    *,
    after: int,
    count: int,
) -> list[dict[str, object]]:
    """Return the endpoint's decoded event records for a bounded archive slice."""
    return [
        app._event_envelope(app._deserialize_event(line), cursor=cursor)
        for cursor, line in sim.replay_archive.iter_lines(
            "events",
            first_line=after + 1,
            last_line=count,
        )
    ]


def _read_checkpoint_records(
    sim: Simulation,
    *,
    first_line: int,
    last_line: int,
) -> list[dict[str, object]]:
    """Return the endpoint's decoded checkpoint records for an archive slice."""
    return [
        {"line": line_number, "checkpoint": app._decode_checkpoint(line, sim.replay_archive.run_id)}
        for line_number, line in sim.replay_archive.iter_lines(
            "checkpoints",
            first_line=first_line,
            last_line=last_line,
        )
    ]


@pytest.mark.parametrize("retained_count", [2, 3])
def test_replay_pages_stay_contiguous_in_both_directions_at_multiple_budgets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    retained_count: int,
) -> None:
    """HTTP replay pages preserve chronological coverage at exact byte budgets."""
    with _client(tmp_path) as client:
        sim = _simulation(client)
        event_after = sim.replay_archive.record_count("events")
        for index in range(6):
            sim.replay_archive.record(_speech_event(index))
        event_count = sim.replay_archive.record_count("events")
        event_records = _read_event_records(sim, after=event_after, count=event_count)
        event_budget = (
            max(
                _reference_event_page_size(
                    sim.run_context.run_id,
                    event_after + index,
                    event_count,
                    event_records[index : index + retained_count],
                )
                for index in range(len(event_records) - retained_count + 1)
            )
            + 1
        )

        checkpoint_first_line = sim.replay_archive.record_count("checkpoints") + 1
        for index in range(6):
            sim.replay_archive.append_checkpoint_line(_checkpoint_line(sim, index))
        checkpoint_last_line = sim.replay_archive.record_count("checkpoints")
        checkpoint_before = checkpoint_last_line + 1
        checkpoint_records = _read_checkpoint_records(
            sim,
            first_line=checkpoint_first_line,
            last_line=checkpoint_last_line,
        )
        checkpoint_budget = (
            max(
                _reference_checkpoint_page_size(
                    sim.run_context.run_id,
                    checkpoint_first_line + available_count,
                    checkpoint_records[available_count - retained_count : available_count],
                )
                for available_count in range(retained_count, len(checkpoint_records) + 1)
            )
            + 1
        )

        with monkeypatch.context() as patch:
            patch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", event_budget)
            seen_events: list[int] = []
            after = event_after
            first_page = True
            while after < event_count:
                response = client.get(f"/api/replay/events?after={after}&limit=6")
                assert response.status_code == 200
                assert len(response.content) <= event_budget
                body = response.json()
                cursors = [entry["cursor"] for entry in body["events"]]
                assert cursors == list(range(after + 1, after + 1 + len(cursors)))
                assert body["next_after"] == cursors[-1]
                if first_page:
                    assert len(cursors) == retained_count
                    assert body["truncated"] is True
                    first_page = False
                seen_events.extend(cursors)
                after = body["next_after"]
            assert seen_events == list(range(event_after + 1, event_count + 1))

        with monkeypatch.context() as patch:
            patch.setattr(app, "REPLAY_RESPONSE_MAX_BYTES", checkpoint_budget)
            seen_checkpoints: list[int] = []
            before = checkpoint_before
            first_page = True
            while before > checkpoint_first_line:
                remaining = before - checkpoint_first_line
                response = client.get(
                    f"/api/replay/checkpoints?before={before}&limit={min(6, remaining)}"
                )
                assert response.status_code == 200
                assert len(response.content) <= checkpoint_budget
                body = response.json()
                lines = [entry["line"] for entry in body["checkpoints"]]
                assert lines == list(range(body["next_before"], before))
                if first_page:
                    assert len(lines) == retained_count
                    assert body["truncated"] is True
                    first_page = False
                seen_checkpoints = lines + seen_checkpoints
                before = body["next_before"]
            assert seen_checkpoints == list(range(checkpoint_first_line, checkpoint_last_line + 1))

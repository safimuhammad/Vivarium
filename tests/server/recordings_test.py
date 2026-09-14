"""Focused tests for the saved-recordings catalogue and replay routes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from observability.replay_archive import ReplayArchive
from observability.run_context import build_run_context
from server.app import ServerSettings, create_app
from server.recordings import (
    EVENTS_FILENAME,
    RecordingPathError,
    RecordingSecurityError,
    iter_recording_file,
    list_recordings,
    load_recording,
    recording_file_path,
    recording_metadata,
    update_recording_sidecar,
    write_recording_sidecar,
)


def _event(timestamp: float = 10.0, *, source: str = "alice") -> dict[str, object]:
    """Return the smallest event accepted by the recorded-run parser."""
    return {
        "type": "look_around",
        "source": source,
        "payload": {"message": "A quiet observation."},
        "scope": "global",
        "region": None,
        "target": None,
        "timestamp": timestamp,
    }


def _snapshot(
    run_id: str,
    *,
    agent_count: int = 2,
    region_count: int = 2,
    reason: str = "run_stopped",
) -> dict[str, object]:
    """Return a compact valid checkpoint with configurable preview sizes."""
    agents = [
        {
            "id": f"agent-{index}",
            "name": f"Being {index}",
            "persona": f"Persona {index}",
            "position": f"region-{index % max(region_count, 1)}",
            "status": "dead" if index == agent_count - 1 else "alive",
        }
        for index in range(agent_count)
    ]
    regions = [{"name": f"Region {index}"} for index in range(region_count)]
    inner = {
        "schema": 1,
        "run_id": run_id,
        "world_time": 20.0,
        "event_cursor": 1,
        "agents": agents,
        "regions": regions,
    }
    return {
        "schema": 1,
        "type": "world_snapshot_checkpoint",
        "reason": reason,
        "run_id": run_id,
        "world_time": 20.0,
        "event_cursor": 1,
        "snapshot": inner,
    }


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def _write_recording(
    root: Path,
    run_id: str,
    *,
    agent_count: int = 2,
    region_count: int = 2,
    started_at: float | None = 100.0,
    model: str | None = "test-model",
    provider: str | None = "test-provider",
    tail: bool = False,
    sidecar: bool = True,
) -> Path:
    """Create a small on-disk recording using the production JSONL shapes."""
    child = root / run_id
    child.mkdir(parents=True)
    _write_jsonl(child / "events.jsonl", [_event(10.0), _event(20.0, source="bob")])
    _write_jsonl(
        child / "snapshots.jsonl",
        [_snapshot(run_id, agent_count=agent_count, region_count=region_count)],
    )
    if tail:
        with (child / "events.jsonl").open("ab") as handle:
            handle.write(b'{"incomplete"')
        with (child / "snapshots.jsonl").open("ab") as handle:
            handle.write(b'{"incomplete"')
    if model is not None:
        _write_jsonl(child / "usage.jsonl", [{"model": model}])
    if sidecar:
        child.joinpath("run.json").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "run_id": run_id,
                    "name": f"Saved {run_id}",
                    "started_at": started_at,
                    "ended_at": (started_at + 30.0) if started_at is not None else None,
                    "duration_seconds": 30.0 if started_at is not None else 0.0,
                    "status": "stopped",
                    "seed": 11,
                    "provider": provider,
                    "model": model,
                }
            ),
            encoding="utf-8",
        )
    return child


def test_catalogue_is_recent_first_and_caps_previews(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    _write_recording(
        root,
        "older",
        agent_count=2,
        region_count=2,
        started_at=100.0,
    )
    _write_recording(
        root,
        "newer",
        agent_count=8,
        region_count=13,
        started_at=200.0,
    )

    runs = list_recordings(root)

    assert [run["id"] for run in runs] == ["newer", "older"]
    newest = runs[0]
    assert newest["name"] == "Saved newer"
    assert newest["model"] == "test-model"
    assert newest["base_url"] == "/api/recordings/newer"
    assert newest["agent_count"] == 8
    assert newest["living_count"] == 7
    assert newest["region_count"] == 13
    assert len(cast(list[object], newest["agents"])) == 6
    assert len(cast(list[object], newest["regions"])) == 12


def test_legacy_recording_uses_id_and_usage_fallbacks(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    run_id = "seed-7-1700000000000-legacy"
    _write_recording(root, run_id, sidecar=False, model="legacy-model")

    runs = list_recordings(root)
    metadata = recording_metadata(root, run_id)

    assert len(runs) == 1
    assert runs[0]["id"] == run_id
    assert runs[0]["model"] == "legacy-model"
    assert runs[0]["status"] == "stopped"
    assert runs[0]["started_at"] == pytest.approx(1_700_000_000.0)
    assert metadata == {
        "seed": 7,
        "provider": None,
        "model": "legacy-model",
        "name": runs[0]["name"],
        "started_at": pytest.approx(1_700_000_000.0),
    }


def test_partial_final_lines_are_ignored_when_loading_one_recording(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    child = _write_recording(root, "partial", tail=True)

    info = load_recording(root, "partial")
    events = b"".join(iter_recording_file(root, "partial", "events.jsonl"))
    snapshots = b"".join(iter_recording_file(root, "partial", "snapshots.jsonl"))

    assert info.files.events == child / "events.jsonl"
    assert events.count(b"\n") == 2
    assert b"incomplete" not in events
    assert snapshots.count(b"\n") == 1
    assert b"incomplete" not in snapshots


def test_semantically_invalid_final_objects_are_ignored_during_streaming(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    child = _write_recording(root, "semantic-tail")
    with (child / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"payload": {}}) + "\n")

    runs = list_recordings(root)
    events = b"".join(iter_recording_file(root, "semantic-tail", "events.jsonl"))

    assert [run["id"] for run in runs] == ["semantic-tail"]
    assert events.count(b"\n") == 2
    assert b'"payload": {}' not in events


def test_rotated_segments_and_active_tail_are_catalogued_and_streamed(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    run_id = "rotated"
    child = root / run_id
    child.mkdir(parents=True)
    archive = ReplayArchive(child, run_id, max_segment_bytes=1)
    event_one = (json.dumps(_event(10.0)) + "\n").encode("utf-8")
    event_two = (json.dumps(_event(20.0, source="bob")) + "\n").encode("utf-8")
    snapshot_one = (json.dumps(_snapshot(run_id)) + "\n").encode("utf-8")
    snapshot_two = (json.dumps(_snapshot(run_id, reason="world_tick")) + "\n").encode("utf-8")
    archive.append_event_line(event_one)
    archive.append_checkpoint_line(snapshot_one)
    archive.max_segment_bytes = 64 * 1024
    archive.append_event_line(event_two)
    archive.append_checkpoint_line(snapshot_two)
    child.joinpath("run.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "run_id": run_id,
                "name": "Rotated",
                "started_at": 100.0,
                "status": "running",
                "seed": 11,
                "provider": "test-provider",
                "model": "test-model",
            }
        ),
        encoding="utf-8",
    )

    runs = list_recordings(root)
    events = b"".join(iter_recording_file(root, run_id, "events.jsonl"))
    snapshots = b"".join(iter_recording_file(root, run_id, "snapshots.jsonl"))

    assert runs[0]["event_count"] == 2
    assert events == event_one + event_two
    assert snapshots == snapshot_one + snapshot_two


def test_recording_routes_list_metadata_and_stream_one_run(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    _write_recording(root, "route-run", tail=True)
    app = create_app(
        ServerSettings(
            memory_root=tmp_path / "memory",
            run_dir=root,
            autostart=False,
        )
    )

    with TestClient(app) as client:
        catalogue = client.get("/api/recordings")
        metadata = client.get("/api/recordings/route-run/metadata.json")
        events = client.get("/api/recordings/route-run/events.jsonl")
        snapshots = client.get("/api/recordings/route-run/snapshots.jsonl")

    assert catalogue.status_code == 200
    assert [run["id"] for run in catalogue.json()["runs"]] == ["route-run"]
    assert metadata.status_code == 200
    assert metadata.json()["model"] == "test-model"
    assert events.status_code == 200
    assert events.content.count(b"\n") == 2
    assert b"incomplete" not in events.content
    assert snapshots.status_code == 200
    assert snapshots.content.count(b"\n") == 1
    assert b"incomplete" not in snapshots.content


def test_path_traversal_and_symlink_recordings_are_refused(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    valid = _write_recording(root, "valid")
    outside = tmp_path / "outside.jsonl"
    outside.write_text("{}\n", encoding="utf-8")

    with pytest.raises(RecordingPathError):
        recording_file_path(root, "../outside", EVENTS_FILENAME)
    with pytest.raises(RecordingPathError):
        recording_file_path(root, "valid", "run.json")

    symlink_run = root / "linked-run"
    symlink_run.symlink_to(valid, target_is_directory=True)
    with pytest.raises(RecordingSecurityError):
        load_recording(root, "linked-run")

    symlink_events = root / "linked-file"
    _write_recording(root, "linked-file")
    symlink_events.joinpath("events.jsonl").unlink()
    symlink_events.joinpath("events.jsonl").symlink_to(outside)
    with pytest.raises(RecordingSecurityError):
        load_recording(root, "linked-file")


def test_sidecar_is_atomic_and_terminal_update_survives_restart(tmp_path: Path) -> None:
    run_context = build_run_context(
        config_path="config/world.yaml",
        seed=3,
        model="model-3",
        provider="provider-3",
        memory_root=tmp_path / "memory",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=lambda: 100.0,
    )

    path = write_recording_sidecar(
        run_context,
        region_name="Nirvana",
        status="starting",
    )
    update_recording_sidecar(
        run_context,
        region_name="Nirvana",
        status="stopped",
        ended_at=130.0,
    )

    payload = cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))
    assert payload["status"] == "stopped"
    assert payload["started_at"] == 100.0
    assert payload["ended_at"] == 130.0
    assert payload["duration_seconds"] == 30.0
    assert payload["model"] == "model-3"
    assert payload["provider"] == "provider-3"
    assert not path.with_name("run.json.tmp").exists()

    _write_jsonl(run_context.run_dir / "events.jsonl", [_event()])
    _write_jsonl(
        run_context.run_dir / "snapshots.jsonl",
        [_snapshot(run_context.run_id)],
    )
    restarted = list_recordings(tmp_path / "runs")
    assert [run["id"] for run in restarted] == [run_context.run_id]
    assert restarted[0]["status"] == "stopped"
    assert restarted[0]["model"] == "model-3"

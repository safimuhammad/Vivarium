"""Tests for the run-lifecycle API: start, replace, stop, and an honest status.

Before these routes existed a run began when the *process* began. What is exercised
here is the behaviour that makes the hosted run replaceable: a new ``run_id`` per
start, no leaked breathing tasks, a status a viewer can trust for the whole lifecycle,
and the two coupled values the server derives instead of accepting.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from agents.decider import Decision, ToolCall
from core.run_settings import (
    GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS,
    OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS,
)
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import Simulation
from server.app import ServerSettings, create_app, settings_from_cli
from server.run_manager import RunManager
from tests.conftest import MockDecider


def _fake_factory(_agent_id: str) -> VectorStore:
    return FakeVectorStore(FakeEmbeddingFunction())


def _settings(tmp_path: Path) -> ServerSettings:
    return ServerSettings(
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        duration=10.0,
        pace=0.0,
        world_tick_interval=60.0,
        refresh_interval=0.05,
        feed_maxlen=16,
        sse_poll_interval=0.01,
        shutdown_timeout=5.0,
    )


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        _settings(tmp_path),
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
        vector_store_factory=_fake_factory,
    )
    return TestClient(app)


def _sim(client: TestClient) -> Simulation:
    app = cast(Any, client.app)
    return cast(Simulation, app.state.simulation)


def _manager(client: TestClient) -> RunManager:
    app = cast(Any, client.app)
    return cast(RunManager, app.state.run_manager)


def _config(client: TestClient, **overrides: object) -> dict[str, Any]:
    """Return the default payload from the server itself, with overrides applied."""
    defaults = client.get("/api/run/defaults").json()
    payload = cast(dict[str, Any], defaults["defaults"])
    payload.update(overrides)
    return payload


def _await_status(client: TestClient, status: str, *, timeout: float = 5.0) -> dict[str, Any]:
    """Poll ``GET /api/run`` until it reports ``status``.

    Args:
        client: The test client.
        status: The lifecycle status being waited for.
        timeout: Seconds to wait before giving up.

    Returns:
        The last ``/api/run`` body observed.
    """
    deadline = time.monotonic() + timeout
    body: dict[str, Any] = {}
    while time.monotonic() < deadline:
        body = client.get("/api/run").json()
        if body["status"] == status:
            return body
        time.sleep(0.01)
    return body


def _checkpoint_reasons(client: TestClient, path: Path, *, timeout: float = 5.0) -> list[str]:
    """Return the run's checkpoint reasons once the closing one has landed.

    ``run_simulation`` marks the run ``stopped`` inside its own ``finally``, and the
    manager's watcher writes the closing checkpoint on the very next scheduling hop --
    so a client that sees ``stopped`` may be a hop ahead of the file. Durability is
    polled for rather than assumed.

    Args:
        client: The test client, driven so the server's loop keeps running.
        path: The run's snapshot JSONL path.
        timeout: Seconds to wait for the closing record.

    Returns:
        Every checkpoint reason in file order.
    """
    deadline = time.monotonic() + timeout
    reasons: list[str] = []
    while time.monotonic() < deadline:
        reasons = [
            json.loads(line)["reason"] for line in path.read_text().splitlines() if line.strip()
        ]
        if "run_stopped" in reasons:
            return reasons
        client.get("/api/run")
        time.sleep(0.01)
    return reasons


# --- Defaults ---------------------------------------------------------------


def test_defaults_endpoint_serves_bounds_labels_and_locked_regions(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/api/run/defaults")
        assert response.status_code == 200
        body = response.json()
        assert body["schema"] == 1
        assert len(body["defaults"]["beings"]) == 4
        assert body["knobs"]["beings"]["max_count"] == 12
        assert body["locked"]["regions"] == [
            "nirvana",
            "nirvana_east",
            "warm_springs",
            "nirvana_west",
        ]
        assert body["locked"]["world_tick_interval_seconds"] == 5.0
        assert body["derived"]["mating_proposal_timeout_seconds"]["gemini"] == 45.0


# --- The process-launched run ----------------------------------------------


def test_run_config_reports_the_process_run_honestly(tmp_path: Path) -> None:
    """A run nobody configured still has a configuration a viewer can read."""
    with _client(tmp_path) as client:
        body = client.get("/api/run/config").json()
        assert body["schema"] == 1
        assert body["run_id"] == client.get("/api/run").json()["run_id"]
        assert body["config"]["seed"] == 7
        assert body["config"]["provider"] == "ollama"  # ServerSettings default
        assert body["config"]["duration_seconds"] == 10.0
        assert [being["name"] for being in body["config"]["beings"]] == [
            "Joe",
            "Mae",
            "Dick",
            "Allen",
        ]


def test_the_process_run_keeps_the_pre_api_memory_wiring(tmp_path: Path) -> None:
    """Namespacing it would change what a being wakes up remembering. Not plumbing."""
    with _client(tmp_path) as client:
        assert _sim(client).run_context.memory_root == tmp_path / "mem"


# --- Starting ---------------------------------------------------------------


def test_start_replaces_the_previous_run_with_a_new_id(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        first = client.get("/api/run").json()
        first_handle = _manager(client).require_run()

        response = client.post("/api/run/start", json=_config(client))
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "starting"
        assert body["run_id"] != first["run_id"]

        # The replaced run was stopped and awaited, not abandoned.
        assert first_handle.task.done()
        assert first_handle.status == "stopped"

        running = _await_status(client, "running")
        assert running["run_id"] == body["run_id"]


def test_start_applies_the_configured_beings(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        payload = _config(
            client,
            beings=[
                {"name": "Sol", "start_region": "nirvana", "energy": 120.0, "materials": 60.0},
                {"name": "Vera", "start_region": "nirvana", "energy": 80.0, "materials": 10.0},
            ],
        )
        assert client.post("/api/run/start", json=payload).status_code == 202
        _await_status(client, "running")

        world = client.get("/api/world").json()
        assert [agent["name"] for agent in world["agents"]] == ["Sol", "Vera"]

        config = client.get("/api/run/config").json()["config"]
        assert [being["name"] for being in config["beings"]] == ["Sol", "Vera"]


def test_start_scales_every_region_rate_by_abundance(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert client.post("/api/run/start", json=_config(client, abundance=2.0)).status_code == 202
        _await_status(client, "running")
        regions = {region.name: region for region in _sim(client).world.get_all_regions()}
        assert regions["nirvana"].energy_rate == 0.4
        assert regions["warm_springs"].energy_rate == 0.5
        # The authored gradient survives the slider.
        assert regions["warm_springs"].energy_rate > regions["nirvana_west"].energy_rate


def test_start_derives_the_mating_timeout_from_provider_and_being_count(
    tmp_path: Path,
) -> None:
    """The defect this closes: a proposal that expires before its target ever breathes."""
    with _client(tmp_path) as client:
        assert (
            client.post("/api/run/start", json=_config(client, provider="gemini")).status_code
            == 202
        )
        _await_status(client, "running")
        assert _sim(client).world.run_settings.mating_proposal_timeout_seconds == (
            GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS
        )

        assert (
            client.post("/api/run/start", json=_config(client, provider="ollama")).status_code
            == 202
        )
        _await_status(client, "running")
        assert _sim(client).world.run_settings.mating_proposal_timeout_seconds == (
            OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
        )


def test_start_gives_every_run_a_fresh_memory_root(tmp_path: Path) -> None:
    """``seed.md`` is write-once, so a shared root discards the persona just written."""
    with _client(tmp_path) as client:
        first_payload = _config(
            client,
            beings=[{"name": "Sol", "start_region": "nirvana", "persona": "I keep what I find."}],
        )
        assert client.post("/api/run/start", json=first_payload).status_code == 202
        _await_status(client, "running")
        first_root = _sim(client).run_context.memory_root
        assert (first_root / "wanderer_001" / "seed.md").read_text() == "I keep what I find."

        second_payload = _config(
            client,
            beings=[{"name": "Sol", "start_region": "nirvana", "persona": "I give what I have."}],
        )
        assert client.post("/api/run/start", json=second_payload).status_code == 202
        _await_status(client, "running")
        second_root = _sim(client).run_context.memory_root

        assert second_root != first_root
        assert (second_root / "wanderer_001" / "seed.md").read_text() == "I give what I have."


def test_start_reports_the_derived_values_without_accepting_them(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert (
            client.post("/api/run/start", json=_config(client, provider="ollama")).status_code
            == 202
        )
        _await_status(client, "running")
        derived = client.get("/api/run/config").json()["derived"]
        assert derived["mating_proposal_timeout_seconds"] == (
            OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
        )
        assert derived["memory_root"] == str(_sim(client).run_context.memory_root)


def test_start_returns_warnings_without_refusing_a_bleak_world(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        payload = _config(
            client,
            beings=[
                {"name": "A", "start_region": "nirvana"},
                {"name": "B", "start_region": "nirvana_east"},
                {"name": "C", "start_region": "warm_springs"},
                {"name": "D", "start_region": "nirvana_west"},
            ],
        )
        response = client.post("/api/run/start", json=payload)
        assert response.status_code == 202
        assert any("begins alone" in warning for warning in response.json()["warnings"])


def test_an_unbounded_run_starts(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert (
            client.post("/api/run/start", json=_config(client, duration_seconds=None)).status_code
            == 202
        )
        _await_status(client, "running")
        assert client.get("/api/run").json()["timing"]["duration"] is None


# --- Validation over HTTP ---------------------------------------------------


def test_a_bad_configuration_is_refused_with_a_message_per_field(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        before = client.get("/api/run").json()["run_id"]
        payload = _config(client, abundance=99.0)
        payload["beings"][0]["start_region"] = "atlantis"

        response = client.post("/api/run/start", json=payload)
        assert response.status_code == 422
        errors = {error["field"]: error["message"] for error in response.json()["detail"]["errors"]}
        assert "between 0.25x and 3.0x" in errors["abundance"]
        assert "The four regions are locked" in errors["beings.0.start_region"]

        # A refused configuration must not disturb the run that is already live.
        assert client.get("/api/run").json()["run_id"] == before
        assert client.get("/api/run").json()["status"] == "running"


def test_submitting_a_derived_value_is_refused(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        payload = _config(client, memory_root="/tmp/anywhere")
        response = client.post("/api/run/start", json=payload)
        assert response.status_code == 422
        errors = {error["field"]: error["message"] for error in response.json()["detail"]["errors"]}
        assert "derived by the server, never submitted" in errors["memory_root"]


# --- Stopping ---------------------------------------------------------------


def test_stop_winds_the_run_down_and_says_so(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        run_id = client.get("/api/run").json()["run_id"]

        response = client.post("/api/run/stop")
        assert response.status_code == 202
        assert response.json() == {"run_id": run_id, "status": "stopping"}

        stopped = _await_status(client, "stopped")
        assert stopped["status"] == "stopped"
        assert stopped["run_id"] == run_id


def test_stop_writes_a_final_checkpoint(tmp_path: Path) -> None:
    """Graceful means the last world state is durable, not merely that tasks ended."""
    with _client(tmp_path) as client:
        snapshot_path = _sim(client).run_context.snapshot_log_path
        client.post("/api/run/stop")
        _await_status(client, "stopped")

        reasons = _checkpoint_reasons(client, snapshot_path)
        assert reasons[-1] == "run_stopped"
        assert reasons.count("run_stopped") == 1


def test_stopping_twice_is_harmless(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        first = client.post("/api/run/stop")
        second = client.post("/api/run/stop")
        assert first.status_code == 202
        assert second.status_code == 202
        assert second.json()["run_id"] == first.json()["run_id"]
        _await_status(client, "stopped")


def test_a_run_can_be_started_again_after_being_stopped(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        stopped_id = client.post("/api/run/stop").json()["run_id"]
        _await_status(client, "stopped")

        response = client.post("/api/run/start", json=_config(client))
        assert response.status_code == 202
        assert response.json()["run_id"] != stopped_id
        assert _await_status(client, "running")["status"] == "running"


# --- Status honesty ---------------------------------------------------------


def test_status_walks_the_whole_lifecycle(tmp_path: Path) -> None:
    """A finished run must not look like beings deep in thought."""
    with _client(tmp_path) as client:
        assert client.get("/api/run").json()["status"] == "running"
        client.post("/api/run/stop")
        assert _await_status(client, "stopped")["status"] == "stopped"

        client.post("/api/run/start", json=_config(client))
        assert _await_status(client, "running")["status"] == "running"

    assert _sim(client).run_context.status == "stopped"


def test_a_run_that_ends_by_itself_still_reports_stopped(tmp_path: Path) -> None:
    """Nobody presses anything when a duration elapses; the status must still be true."""
    app = create_app(
        ServerSettings(
            memory_root=tmp_path / "mem",
            run_dir=tmp_path / "runs",
            duration=0.05,
            pace=0.0,
            world_tick_interval=60.0,
            refresh_interval=0.05,
            feed_maxlen=16,
            sse_poll_interval=0.01,
        ),
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
        vector_store_factory=_fake_factory,
    )
    with TestClient(app) as client:
        assert _await_status(client, "stopped")["status"] == "stopped"
        snapshot_path = _sim(client).run_context.snapshot_log_path
        assert "run_stopped" in _checkpoint_reasons(client, snapshot_path)


# --- Concurrency ------------------------------------------------------------


def test_back_to_back_starts_leave_exactly_one_run_breathing(tmp_path: Path) -> None:
    """Two starts must not interleave, leak tasks, or leave two worlds writing."""
    with _client(tmp_path) as client:
        handles = [_manager(client).require_run()]
        for _ in range(3):
            assert client.post("/api/run/start", json=_config(client)).status_code == 202
            handles.append(_manager(client).require_run())

        live = handles[-1]
        for handle in handles[:-1]:
            assert handle.task.done(), f"run {handle.run_id} was left breathing"
            assert handle.status == "stopped"
        assert not live.task.done()
        assert len({handle.run_id for handle in handles}) == len(handles)


# --- Booting idle -----------------------------------------------------------
#
# Safi (2026-08-20): *"instead of starting both separately, make it one from frontend
# UI, a page to configure and start the sim -- no need of starting backend separately."*
# The blocker was that the ``lifespan`` started a run, so the run's provider, duration
# and memory root came from CLI flags and the configuration screen's choices could only
# ever *replace* a run someone else had already configured. Booting idle is what makes
# the screen the first mover rather than the second.


def _idle_settings(tmp_path: Path) -> ServerSettings:
    """Return settings that boot the server with no run at all."""
    return ServerSettings(
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        duration=10.0,
        pace=0.0,
        world_tick_interval=60.0,
        refresh_interval=0.05,
        feed_maxlen=16,
        sse_poll_interval=0.01,
        shutdown_timeout=5.0,
        autostart=False,
    )


def _idle_client(tmp_path: Path) -> TestClient:
    app = create_app(
        _idle_settings(tmp_path),
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
        vector_store_factory=_fake_factory,
    )
    return TestClient(app)


def test_autostart_is_the_default_so_every_existing_launcher_is_unchanged() -> None:
    """``create_app`` must still build a run unless a caller explicitly opts out."""
    assert ServerSettings().autostart is True


def test_an_idle_server_reports_ready_instead_of_pretending_a_run_exists(
    tmp_path: Path,
) -> None:
    with _idle_client(tmp_path) as client:
        response = client.get("/api/run")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ready"
        assert body["run_id"] == ""
        assert body["event_cursor"] == 0
        assert _manager(client).current is None


def test_an_idle_server_answers_every_world_read_honestly(tmp_path: Path) -> None:
    """A read that needs a world must say there is no run -- never invent one."""
    with _idle_client(tmp_path) as client:
        for path in (
            "/api/world",
            "/api/events",
            "/api/run/config",
            "/api/replay/manifest",
            "/api/replay/checkpoints/latest",
        ):
            response = client.get(path)
            assert response.status_code == 409, path
            assert response.json()["detail"] == "No run has been started."


def test_an_idle_server_still_serves_the_screen_its_defaults(tmp_path: Path) -> None:
    """The configuration screen reads its knobs before any run exists."""
    with _idle_client(tmp_path) as client:
        response = client.get("/api/run/defaults")
        assert response.status_code == 200
        assert response.json()["defaults"]["beings"]


def test_stopping_an_idle_server_is_a_conflict_not_a_crash(tmp_path: Path) -> None:
    with _idle_client(tmp_path) as client:
        response = client.post("/api/run/stop")
        assert response.status_code == 409
        assert response.json()["detail"] == "No run has been started."


def test_the_screen_starts_the_FIRST_run_on_an_idle_server(tmp_path: Path) -> None:
    """The whole point: the first run is the one the configuration screen asked for."""
    with _idle_client(tmp_path) as client:
        payload = _config(client, seed=1234)
        accepted = client.post("/api/run/start", json=payload)
        assert accepted.status_code == 202
        assert accepted.json()["status"] == "starting"

        body = _await_status(client, "running")
        assert body["status"] == "running"
        assert body["seed"] == 1234
        assert body["run_id"]
        # The run the screen configured is the FIRST run, not a replacement.
        assert client.get("/api/run/config").json()["config"]["seed"] == 1234
        assert client.get("/api/world").status_code == 200


def test_idle_flag_turns_autostart_off_and_is_absent_by_default() -> None:
    """``python -m server.app --idle`` is the opt-in; every other invocation is unchanged."""
    assert settings_from_cli([]).autostart is True
    assert settings_from_cli(["--idle"]).autostart is False

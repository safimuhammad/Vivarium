"""The wire contract, pinned from the server's side.

Three mismatches shipped between two halves that were each green in isolation: a
closed status enum that threw on ``starting``, a defaults payload that diverged in
nine field names, and a rejection body the screen could not read -- so no per-field
validation message had ever reached a viewer. Two of the three were on error paths,
which is exactly where nobody looks.

What closes that is a **capture the server itself is responsible for keeping true**.
This module drives the real application object through every interaction the
configuration screen makes, and asserts the result against a checked-in capture that
the frontend's own parsers are run over
(``frontend/src/app/gateway/runApiContract.test.ts``). A change on either side turns
one of the two suites red:

* change a server payload and this module fails, naming the endpoint;
* change a frontend parser so it can no longer read those bytes and the vitest half
  fails.

The capture is *generated*, never hand-written -- re-make it with::

    VIVARIUM_UPDATE_RUN_API_CONTRACT=1 pytest tests/server/frontend_contract_test.py

and then run the frontend half, which is where a shape change is judged.

**How real is "the real server"?** :class:`fastapi.testclient.TestClient` drives the
same ASGI application ``python -m server.app`` serves: real routing, real Pydantic
validation, real FastAPI exception envelopes, real JSON serialization. What it does
not do is cross a socket, which changes no byte of a JSON body. In exchange the test
is deterministic and runs in the ordinary CI ``pytest`` job with no port, no
subprocess and no browser.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Final, cast

from fastapi.testclient import TestClient

from agents.decider import Decision, ToolCall
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from observability.run_context import RunStatus
from server.app import ServerSettings, create_app
from tests.conftest import MockDecider

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]

CONTRACT_PATH: Final[Path] = (
    REPO_ROOT / "frontend" / "src" / "app" / "gateway" / "runApiContract.json"
)
"""Where the capture lives: beside the parsers that are run over it."""

UPDATE_ENV_VAR: Final[str] = "VIVARIUM_UPDATE_RUN_API_CONTRACT"

RECAPTURE_HINT: Final[str] = (
    f"Re-capture with `{UPDATE_ENV_VAR}=1 pytest tests/server/frontend_contract_test.py`, "
    "then run `npx vitest run src/app/gateway/runApiContract` in `frontend/` -- that half "
    "is what says whether the frontend can still read the new bytes."
)

REDACTED: Final[str] = "<redacted-per-run>"
"""Placeholder for a per-run *string*.

Redaction is **type-preserving**: a redacted number becomes ``0`` and a redacted
string becomes this sentinel, so the capture stays a body the frontend's parsers can
actually be run over. A stand-in of the wrong type would turn the pin into a
different, easier test than the one that matters.
"""

REDACTED_NUMBER: Final[float] = 0.0
"""Placeholder for a per-run *number*. See :data:`REDACTED`."""

VOLATILE_PATHS: Final[frozenset[str]] = frozenset(
    {
        # Every acknowledgement and envelope mints or echoes a fresh run id.
        "run_start_accepted.run_id",
        "run_start_with_warnings.run_id",
        "run_stop.run_id",
        "run_metadata.run_id",
        "run_config.run_id",
        # Wall-clock, world-clock and cursor move while the capture is being taken.
        "run_metadata.started_at",
        "run_metadata.world_time",
        "run_metadata.event_cursor",
        # A hash of `config/world.yaml`, which is a tracked file rather than a shape.
        "run_metadata.config_hash",
        # Absolute paths under the test's own temporary directory.
        "run_metadata.artifacts.events",
        "run_metadata.artifacts.usage",
        "run_metadata.artifacts.snapshots",
        "run_metadata.artifacts.memory_root",
        "run_config.derived.memory_root",
    }
)
"""Keys whose *value* is per-run and whose *presence and type* are the contract.

Fully qualified by interaction on purpose: ``derived.memory_root`` is a real
per-run path on ``/api/run/config`` and the constant sentence
*"a fresh directory per run"* on ``/api/run/defaults``, and redacting the second
would hide a real change to the words a viewer reads.

Redacting these is what makes the capture stable. Nothing else may vary: the test
below captures twice and fails if any un-redacted value differs between the two,
so a newly-volatile field cannot quietly rot the pin.
"""


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


def _await_status(client: TestClient, status: str, *, timeout: float = 5.0) -> dict[str, Any]:
    """Poll ``GET /api/run`` until it reports ``status``, then return that body."""
    deadline = time.monotonic() + timeout
    body: dict[str, Any] = {}
    while time.monotonic() < deadline:
        body = client.get("/api/run").json()
        if body["status"] == status:
            return body
        time.sleep(0.01)
    return body


def _placeholder_for(value: object) -> object:
    """Return a stand-in of the same JSON type as ``value``.

    Type-preserving on purpose: the capture is fed to the frontend's real parsers,
    which reject a string where a number belongs. Substituting the wrong type would
    quietly turn the pin into a weaker test than the one being written.
    """
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int | float):
        return REDACTED_NUMBER
    return REDACTED


def _redact(value: object, prefix: str = "") -> object:
    """Return ``value`` with every :data:`VOLATILE_PATHS` leaf replaced.

    Args:
        value: Any JSON-decoded value.
        prefix: Dotted path of ``value`` within its response body.

    Returns:
        A structurally identical value with per-run leaves replaced by a stand-in of
        their own type. List indices are not part of a path, so a redacted key inside
        a list element is matched by its key alone.
    """
    if isinstance(value, dict):
        redacted: dict[str, object] = {}
        for key, item in cast(dict[str, object], value).items():
            path = f"{prefix}{key}"
            redacted[key] = (
                _placeholder_for(item) if path in VOLATILE_PATHS else _redact(item, f"{path}.")
            )
        return redacted
    if isinstance(value, list):
        return [_redact(item, prefix) for item in cast(list[object], value)]
    return value


def _interaction(
    name: str,
    *,
    method: str,
    path: str,
    status: int,
    body: object,
    request: object = None,
    note: str,
) -> dict[str, object]:
    """Return one captured request/response pair, ready to serialize.

    Args:
        name: The interaction's key, which is also the root of every dotted path
            matched against :data:`VOLATILE_PATHS`.
        method: HTTP method, recorded so the capture reads as a transcript.
        path: Endpoint path.
        status: The status code the server really answered with.
        body: The decoded response body.
        request: The decoded request body, where one was sent.
        note: One sentence on why this interaction is part of the contract.

    Returns:
        A JSON-ready mapping with every per-run value replaced by a same-typed
        stand-in.
    """
    entry: dict[str, object] = {
        "note": note,
        "method": method,
        "path": path,
        "status": status,
    }
    if request is not None:
        entry["request"] = _redact(request, f"{name}.request.")
    entry["body"] = _redact(body, f"{name}.")
    return entry


def _capture(tmp_path: Path) -> dict[str, object]:
    """Drive the real application through every interaction the screen makes.

    Args:
        tmp_path: Scratch root for this capture's memory and run directories.

    Returns:
        The whole contract document, redacted and ready to write.
    """
    with _client(tmp_path) as client:
        defaults_response = client.get("/api/run/defaults")
        defaults_body = defaults_response.json()
        submitted = cast(dict[str, Any], defaults_body["defaults"])

        accepted = client.post("/api/run/start", json=submitted)
        metadata = _await_status(client, "running")
        config_response = client.get("/api/run/config")

        # Bleak but legal: every being alone, nothing to build with, a dying land.
        bleak = dict(submitted)
        bleak["abundance"] = 0.25
        bleak["beings"] = [
            {"name": "A", "start_region": "nirvana", "energy": 100.0, "materials": 0.0},
            {"name": "B", "start_region": "nirvana_east", "energy": 100.0, "materials": 0.0},
            {"name": "C", "start_region": "warm_springs", "energy": 100.0, "materials": 0.0},
            {"name": "D", "start_region": "nirvana_west", "energy": 100.0, "materials": 0.0},
        ]
        warned = client.post("/api/run/start", json=bleak)
        _await_status(client, "running")

        # Three bad fields at once: the whole point of one-pass validation is that a
        # viewer is not made to discover them one submission at a time.
        rejected_payload = dict(submitted)
        rejected_payload["beings"] = [
            {"name": "", "start_region": "nirvana", "energy": 100.0, "materials": 45.0},
            {"name": "Mae", "start_region": "atlantis", "energy": 9000.0, "materials": 45.0},
        ]
        rejected = client.post("/api/run/start", json=rejected_payload)

        stopped = client.post("/api/run/stop")

    statuses = list(cast(tuple[str, ...], RunStatus.__value__.__args__))
    return {
        "schema": 1,
        "captured_by": "tests/server/frontend_contract_test.py",
        "how_to_recapture": RECAPTURE_HINT,
        "redacted_string": REDACTED,
        "redacted_number": REDACTED_NUMBER,
        "redacted_paths": sorted(VOLATILE_PATHS),
        "lifecycle_statuses": statuses,
        "interactions": {
            "run_defaults": _interaction(
                "run_defaults",
                method="GET",
                path="/api/run/defaults",
                status=defaults_response.status_code,
                body=defaults_body,
                note="Every bound, label, choice and marker the configuration screen renders.",
            ),
            "run_start_accepted": _interaction(
                "run_start_accepted",
                method="POST",
                path="/api/run/start",
                status=accepted.status_code,
                request=submitted,
                body=accepted.json(),
                note="The server's own defaults, submitted back unchanged, and accepted.",
            ),
            "run_start_with_warnings": _interaction(
                "run_start_with_warnings",
                method="POST",
                path="/api/run/start",
                status=warned.status_code,
                request=bleak,
                body=warned.json(),
                note="Bleak but legal: accepted, with the cautions a viewer is entitled to.",
            ),
            "run_start_rejected": _interaction(
                "run_start_rejected",
                method="POST",
                path="/api/run/start",
                status=rejected.status_code,
                request=rejected_payload,
                body=rejected.json(),
                note="Three bad fields reported in one pass. This body was unreadable once.",
            ),
            "run_metadata": _interaction(
                "run_metadata",
                method="GET",
                path="/api/run",
                status=200,
                body=metadata,
                note="The observer's own join payload; its status vocabulary is the contract.",
            ),
            "run_config": _interaction(
                "run_config",
                method="GET",
                path="/api/run/config",
                status=config_response.status_code,
                body=config_response.json(),
                note="The config the live run started with, wrapped in run metadata.",
            ),
            "run_stop": _interaction(
                "run_stop",
                method="POST",
                path="/api/run/stop",
                status=stopped.status_code,
                body=stopped.json(),
                note="A stop is acknowledged before it finishes; the status says so.",
            ),
        },
    }


def _write(document: dict[str, object]) -> None:
    """Write the contract document with a trailing newline, stably ordered."""
    CONTRACT_PATH.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def test_the_captured_contract_still_matches_the_real_server(tmp_path: Path) -> None:
    """The checked-in capture is what the frontend's parsers are tested against.

    If this fails, the server's wire shape moved. That is allowed -- but the capture
    must move with it, and the frontend half must then prove it can still read it.
    """
    captured = _capture(tmp_path)
    if os.environ.get(UPDATE_ENV_VAR) == "1":
        _write(captured)
        return

    assert CONTRACT_PATH.exists(), f"{CONTRACT_PATH} is missing. {RECAPTURE_HINT}"
    stored = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    for name, interaction in cast(dict[str, Any], captured["interactions"]).items():
        assert name in stored["interactions"], f"{name} is new on the wire. {RECAPTURE_HINT}"
        assert stored["interactions"][name] == interaction, (
            f"`{interaction['method']} {interaction['path']}` no longer matches the "
            f"captured contract ({name}). {RECAPTURE_HINT}"
        )
    assert stored["interactions"].keys() == cast(dict[str, Any], captured["interactions"]).keys()
    assert stored["lifecycle_statuses"] == captured["lifecycle_statuses"], (
        f"The run status vocabulary changed. {RECAPTURE_HINT}"
    )


def test_nothing_outside_the_redaction_list_varies_between_two_runs(tmp_path: Path) -> None:
    """A newly-volatile field must be declared, not silently rot the pin.

    Without this, a value that starts varying per run would make the capture flap and
    the honest response would be to weaken the assertion. Here it fails as itself.
    """
    first = _capture(tmp_path / "a")
    second = _capture(tmp_path / "b")

    assert first == second, (
        "Something outside VOLATILE_PATHS differs between two captures of the same "
        "server. Add it to VOLATILE_PATHS if it is legitimately per-run."
    )


def test_the_rejection_body_carries_a_field_and_a_message_per_complaint(tmp_path: Path) -> None:
    """The shape that was unreadable, asserted at its source.

    ``{"detail": {"errors": [{"field", "message"}]}}`` -- a nested list, not the flat
    map or FastAPI's ``[{loc, msg}]``. Nothing else reaches the screen.
    """
    interactions = cast(dict[str, Any], _capture(tmp_path)["interactions"])
    rejected = cast(dict[str, Any], interactions["run_start_rejected"])

    assert rejected["status"] == 422
    errors = rejected["body"]["detail"]["errors"]
    assert len(errors) >= 3
    for error in errors:
        assert set(error) == {"field", "message"}
        assert error["message"].endswith((".", "!"))
    fields = {error["field"] for error in errors}
    assert "beings.0.name" in fields
    assert "beings.1.start_region" in fields
    assert "beings.1.energy" in fields


def test_a_bleak_configuration_is_accepted_with_cautions_rather_than_refused(
    tmp_path: Path,
) -> None:
    """The warnings path is a contract too -- it was being dropped on the floor."""
    interactions = cast(dict[str, Any], _capture(tmp_path)["interactions"])
    warned = cast(dict[str, Any], interactions["run_start_with_warnings"])

    assert warned["status"] == 202
    warnings = warned["body"]["warnings"]
    assert len(warnings) >= 2
    assert all(isinstance(warning, str) and warning.strip() for warning in warnings)
    assert any("begins alone" in warning for warning in warnings)

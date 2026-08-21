"""Tests for deterministic live-frontend server lifecycle helpers."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI

from tests.frontend_live.live_api_server import _quiesce_background_run


@pytest.mark.asyncio
async def test_quiesce_background_run_stops_and_awaits_simulation() -> None:
    """The mechanics harness observes a stable world after stopping background tasks."""
    stop = asyncio.Event()
    completed = asyncio.Event()

    async def run_until_stopped() -> None:
        await stop.wait()
        await asyncio.sleep(0)
        completed.set()

    task = asyncio.create_task(run_until_stopped())
    app = FastAPI()
    app.state.stop_event = stop
    app.state.run_task = task

    await _quiesce_background_run(app)

    assert stop.is_set()
    assert completed.is_set()
    assert task.done()

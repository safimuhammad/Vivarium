"""The live terminal activity feed -- how a run is *perceived* while it happens.

Perception is the product (``CLAUDE.md`` Section 1): a run no one can watch is the
Game of Life with the screen off. This module renders the simulation's event
stream and a world snapshot to a ``rich`` terminal view.

It exposes three things:

* :func:`render_event` -- a pure :class:`~bus.events.Event` -> human-readable line
  used by both the live feed and tests.
* :func:`render_world_table` -- a pure :class:`~world.world.WorldState` snapshot ->
  ``rich.table.Table`` (per-agent status + per-region resources).
* :func:`run_activity_feed` -- the async ``rich.Live`` loop that polls a
  :class:`~observability.event_log.FeedEventLog` and re-renders on an interval.

The renderers are pure (no I/O) so they unit-test cleanly; the live loop is
integration-only (it drives a real terminal) and is excluded from the fast suite.
The feed is an **observer**: it only reads world state, never mutates it.
"""

from __future__ import annotations

import asyncio
from collections import deque
from typing import TYPE_CHECKING

from rich.console import Console, Group
from rich.panel import Panel
from rich.table import Table

from bus.events import Event
from core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Callable

    from observability.event_log import FeedEventLog
    from world.world import WorldState

logger = get_logger(__name__)

DEFAULT_REFRESH_INTERVAL: float = 2.0
"""Seconds between live re-renders; capped to avoid CPU pressure on long runs."""

MAX_FEED_LINES: int = 200
"""Maximum event lines kept in the scrolling feed panel (bounded for a long run)."""

_EVENT_VERBS: dict[str, str] = {
    "speak": "spoke",
    "attack": "attacked someone",
    "agent_died": "died",
    "agent_recovered": "recovered",
    "agent_paralyzed": "was paralyzed",
    "agent_born": "was born",
    "harvest": "harvested resources",
    "move": "moved",
    "resource_transferred": "transferred resources",
    "mating_proposed": "proposed mating",
    "mating_accepted": "accepted a mating proposal",
    "mating_rejected": "rejected a mating proposal",
    "look_around": "looked around",
}
"""Fallback templates per event type when an event carries no ``message`` payload."""


def render_event(event: Event) -> str:
    """Render a single event as one human-readable feed line.

    Pure (no I/O). Prefers the event's conventional ``payload["message"]`` (the
    rich, agent-facing narration tools already produce); otherwise falls back to a
    templated verb for the event ``type``, and finally to the raw type string for
    unknown kinds. The line is always prefixed with the emitting ``source`` so the
    feed reads as "who did what".

    Args:
        event: The event to render.

    Returns:
        A single-line string suitable for the scrolling activity panel.
    """
    message = event.payload.get("message")
    body = str(message) if message else _EVENT_VERBS.get(event.type, event.type)
    return f"[{event.source}] {body}"


def render_world_table(world: WorldState) -> Table:
    """Render a compact snapshot of the world as a ``rich`` table.

    Pure (read-only): builds two stacked sub-tables -- agents
    (id/status/energy/materials/position) and regions (name/energy/materials) --
    inside a grid so the whole snapshot is a single ``rich.table.Table`` renderable.
    Does not mutate the world.

    Args:
        world: The world whose agents and regions to snapshot.

    Returns:
        A ``rich.table.Table`` (a grid stacking the agent and region tables).
    """
    agents_table = Table(title="Agents", expand=True)
    agents_table.add_column("ID")
    agents_table.add_column("Status")
    agents_table.add_column("Energy", justify="right")
    agents_table.add_column("Materials", justify="right")
    agents_table.add_column("Region")
    for agent in world.get_all_agents():
        agents_table.add_row(
            agent.id,
            agent.status.value,
            f"{agent.current_energy:.1f}",
            f"{agent.current_materials:.1f}",
            agent.current_position,
        )

    regions_table = Table(title="Regions", expand=True)
    regions_table.add_column("Region")
    regions_table.add_column("Energy", justify="right")
    regions_table.add_column("Materials", justify="right")
    for region in world.get_all_regions():
        regions_table.add_row(
            region.name,
            f"{region.current_energy:.1f}",
            f"{region.current_materials:.1f}",
        )

    layout = Table.grid(expand=True)
    layout.add_column()
    layout.add_row(agents_table)
    layout.add_row(regions_table)
    return layout


async def run_activity_feed(
    feed: FeedEventLog,
    world: WorldState,
    console: Console,
    *,
    refresh_interval: float = DEFAULT_REFRESH_INTERVAL,
    should_stop: Callable[[], bool],
) -> None:
    """Drive the live ``rich.Live`` activity view until ``should_stop`` is True.

    Each tick polls :meth:`~observability.event_log.FeedEventLog.new_events` by a
    monotonic cursor, appends the rendered lines to a bounded display buffer, and
    re-renders the event panel above the world table, then sleeps
    ``refresh_interval``. An observer only -- it never mutates the world. The live
    loop is integration-only (it requires a terminal) and is excluded from the unit
    coverage gate.

    Args:
        feed: The bounded feed log to poll for new events.
        world: The world to snapshot in the table panel (read-only).
        console: The shared ``rich`` console (typically ``Console(stderr=True)`` so
            it coexists with ``RichHandler`` log output).
        refresh_interval: Seconds to sleep between re-renders.
        should_stop: Predicate polled each tick; the loop exits when it returns True.

    Returns:
        None.

    Side effects:
        Renders to ``console`` via a ``rich.Live`` context; reads ``feed`` and
        ``world``.
    """
    cursor: int = 0
    lines: deque[str] = deque(maxlen=MAX_FEED_LINES)
    from rich.live import Live

    with Live(console=console, refresh_per_second=4) as live:  # pragma: no cover
        while not should_stop():
            # Isolate a render error so one bad frame cannot freeze the live view for
            # the rest of the run (perception is the product). The renderers it calls
            # are pure and unit-tested; this guard covers transient rich/terminal hiccups.
            try:
                events, cursor = feed.new_events(cursor)
                for event in events:
                    lines.append(render_event(event))
                panel = Panel("\n".join(lines), title="Activity")
                live.update(Group(panel, render_world_table(world)))
            except Exception:
                logger.exception("activity-feed render failed; skipping this frame")
            await asyncio.sleep(refresh_interval)

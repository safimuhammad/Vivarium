"""Shared helpers for JSON-ready event payload fragments.

Also owns the **display-only** classification: which event types are utterances a
watcher reads over a being's head rather than acts that occupy its body. This is
a presentation fact the backend *states* (see :func:`is_display_only`), not a
heuristic the frontend infers from the type string; it is stamped onto every
serialized event by :func:`observability.event_log.serialize_event`, never onto
the live :class:`~bus.events.Event` a being perceives.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from world.regions import ResourceTypes

DISPLAY_ONLY_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "self_talk",  # a being's private thought: routed to no inbox, read by watchers
        "speak",  # an utterance: heard where it is said, but it occupies no body
    }
)
"""Event types that carry no body-occupying choreography.

A display-only beat can be rendered as a non-blocking overlay: it is layered over
its being, is concurrent with anything else that being is doing, and never takes
an exclusive lease on the stage. Everything else -- movement, combat, building,
mating, home acts -- occupies exactly one body for the duration of its scene.

Deliberately narrow: these two are the utterances named by the live-presentation
spec (§3.1), and they were 359 of the 388 events in the measured run. Adding a
type here changes how a watcher sees the world, so it is a design decision, not
a convenience.
"""


def is_display_only(event_type: str) -> bool:
    """Return whether ``event_type`` is an utterance rather than a physical act.

    Args:
        event_type: The event's machine-readable kind (e.g. ``"speak"``).

    Returns:
        ``True`` when the type is in :data:`DISPLAY_ONLY_EVENT_TYPES`.
    """
    return event_type in DISPLAY_ONLY_EVENT_TYPES


def resource_type_value(resource_type: object) -> str:
    """Return the public string value for a resource enum or resource-like key."""
    if isinstance(resource_type, ResourceTypes):
        return resource_type.value
    if isinstance(resource_type, str):
        try:
            return ResourceTypes(resource_type).value
        except ValueError:
            return resource_type
    return str(resource_type)


def serialize_resource_map(resources: Mapping[Any, float]) -> dict[str, float]:
    """Convert resource-keyed mappings to JSON-ready ``{"energy": 1.0}`` payloads."""
    return {
        resource_type_value(resource_type): float(quantity)
        for resource_type, quantity in resources.items()
    }

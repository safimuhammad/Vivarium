"""Event model for the simulation's pub/sub bus.

Defines :class:`Event` -- the immutable-by-convention message that flows from a
tool through the :class:`~bus.event_bus.EventBus` into other agents' inboxes --
and :class:`ScopeType`, which decides how an event is routed.

Routing contract (interpreted by :class:`~bus.event_bus.EventBus`):

* :attr:`ScopeType.LOCAL` -- heard within one region. If :attr:`Event.region` is
  set, that region is used; otherwise the source agent's current region.
* :attr:`ScopeType.GLOBAL` -- heard by every subscribed agent.
* :attr:`ScopeType.TARGETED` -- delivered to the single agent named by
  :attr:`Event.target`.

Public API note: the field order (``type``, ``source``, ``payload``, ``scope``,
then optional ``region``/``target``/``timestamp``) is depended on by the tool
layer (``tools/builtin/*``), which constructs events with ``scope`` passed
positionally. Do not reorder or rename these fields.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ScopeType(Enum):
    """How an :class:`Event` is routed by the :class:`~bus.event_bus.EventBus`.

    Attributes:
        LOCAL: Delivered to agents in a single region (the event's ``region`` if
            set, otherwise the source agent's current region).
        GLOBAL: Delivered to every subscribed agent.
        TARGETED: Delivered to the single agent named by the event's ``target``.
    """

    LOCAL = "local"
    GLOBAL = "global"
    TARGETED = "targeted"


@dataclass(slots=True)
class Event:
    """A single message published to the bus and perceived by agents.

    A mutable, hot-path record (``slots=True`` for a small memory/access win; not
    frozen by design, consistent with the other domain dataclasses). Tools build
    these and publish them; agents drain them from their inbox during perception.

    Attributes:
        type: Short machine-readable event kind (e.g. ``"attack"``, ``"speak"``,
            ``"agent_born"``).
        source: Id of the agent (or system) that emitted the event.
        payload: Arbitrary event data. Conventionally carries a human-readable
            ``"message"`` key destined for the perceiving agent's LLM.
        scope: Routing scope; see :class:`ScopeType`.
        region: Target region for a ``LOCAL`` event. ``None`` means "use the
            source agent's current region". Ignored for ``GLOBAL``/``TARGETED``.
        target: Recipient agent id for a ``TARGETED`` event. ``None`` for
            broadcast (``GLOBAL``) and region-scoped (``LOCAL``) events.
        timestamp: Emission time in seconds. Optional: defaults to wall-clock
            :func:`time.time` when omitted. Tools should pass the world's clock
            value (``timestamp=world.now()``) so logged runs stay reproducible.
    """

    type: str
    source: str  # the emitting agent's id (or a system source)
    payload: dict[str, Any]
    scope: ScopeType
    region: str | None = None  # used by LOCAL events; None -> source's region
    target: str | None = None  # used by TARGETED events; None for broadcast/local
    timestamp: float = field(default_factory=time.time)

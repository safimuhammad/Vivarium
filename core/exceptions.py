"""Typed exception hierarchy for Vivarium infrastructure failures.

Vivarium uses a two-layer error model (see ``CLAUDE.md`` Section 4):

* **Agent-facing** failures inside *tool logic* are never exceptions. They are
  returned as natural-language result strings (``"Error: ..."`` for
  precondition/lookup failures, ``"Invalid: ..."`` for rule violations) so the
  LLM agent keeps receiving perception. Do **not** raise these exceptions from
  tool logic.
* **Infrastructure-facing** failures in the registry, event bus, config loader
  and runtime *do* raise. They use the typed hierarchy defined here so callers
  can catch them precisely and so they can be logged rather than swallowed.

All exceptions derive from :class:`VivariumError`, which makes it possible to
catch every Vivarium-originated infrastructure error with a single
``except VivariumError``.
"""

from __future__ import annotations


class VivariumError(Exception):
    """Base class for every Vivarium infrastructure error.

    Catch this to handle any error raised intentionally by Vivarium
    infrastructure code (as opposed to programming errors or third-party
    exceptions, which should be allowed to propagate).
    """


class WorldStateError(VivariumError):
    """Raised when a :class:`~world.world.WorldState` operation is invalid.

    Use for infrastructure-level world failures (for example an operation that
    violates an invariant the world must uphold). Ordinary query/mutation
    methods that return ``bool`` keep their boolean contract; raise this only
    where a failure genuinely indicates broken state rather than a rejected
    agent action.
    """


class EventBusError(VivariumError):
    """Raised when the :class:`~bus.event_bus.EventBus` cannot route an event.

    Replaces silent failures in publish/subscribe so routing problems surface
    instead of being dropped.
    """


class ToolError(VivariumError):
    """Raised for infrastructure failures while invoking a registered tool.

    Examples: an unknown tool name, or an unexpected exception raised by the
    tool implementation itself. This wraps the underlying cause (use
    ``raise ToolError(...) from exc``) and is logged by the registry. Tool
    *logic* failures (bad params, rule violations) are **not** this -- they are
    returned as result strings.
    """


class ConfigError(VivariumError):
    """Raised when configuration cannot be loaded or validated.

    Used by the config loader when ``world.yaml`` is missing, malformed, or
    fails schema validation, so a bad config fails loudly with a useful message
    instead of producing a half-built world.
    """

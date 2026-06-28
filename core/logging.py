"""Stdlib-``logging`` configuration helpers for Vivarium.

Library modules obtain a logger with :func:`get_logger` (the standard
module-level ``logger = get_logger(__name__)`` pattern) and never call
``print``. Applications/entry points call :func:`configure_logging` once at
start-up to attach a handler and set the level.

``rich`` is deliberately reserved for the future activity-feed renderer and is
**not** used for library logging (see ``CLAUDE.md`` Section 4).
"""

from __future__ import annotations

import logging

DEFAULT_LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
"""Default log line format used by :func:`configure_logging`."""

DEFAULT_DATE_FORMAT: str = "%Y-%m-%d %H:%M:%S"
"""Default timestamp format used by :func:`configure_logging`."""


def configure_logging(
    level: int | str = logging.INFO,
    *,
    fmt: str = DEFAULT_LOG_FORMAT,
    datefmt: str = DEFAULT_DATE_FORMAT,
) -> None:
    """Configure the root logger for a Vivarium run.

    Idempotent enough for application use: it (re)sets the root logger's level
    and ensures exactly one stream handler with the Vivarium format is attached,
    replacing any handlers a previous call added. Intended to be called once
    from an entry point, not from library code.

    Args:
        level: Logging level as a stdlib level constant (e.g. ``logging.INFO``)
            or its name (e.g. ``"INFO"``).
        fmt: ``logging`` format string for log records.
        datefmt: ``strftime`` format string for the record timestamp.

    Returns:
        None.

    Side effects:
        Mutates the root logger: sets its level and replaces its handlers with a
        single configured :class:`logging.StreamHandler`.
    """
    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.StreamHandler()
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))

    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger.

    Thin wrapper over :func:`logging.getLogger` so call sites depend on
    ``core.logging`` rather than reaching for ``logging`` directly, leaving room
    to enrich logger creation later without touching every module.

    Args:
        name: Logger name, conventionally the module's ``__name__``.

    Returns:
        The named :class:`logging.Logger`.
    """
    return logging.getLogger(name)

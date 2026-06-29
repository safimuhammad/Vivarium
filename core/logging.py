"""Stdlib-``logging`` configuration helpers for Vivarium.

Library modules obtain a logger with :func:`get_logger` (the standard
module-level ``logger = get_logger(__name__)`` pattern) and never call
``print``. Applications/entry points call :func:`configure_logging` once at
start-up to attach a handler and set the level.

Library logging stays plain stdlib ``logging``. A run that drives the live
``rich`` activity feed instead calls :func:`configure_rich_logging` once at
start-up, routing log records through a :class:`rich.logging.RichHandler` that
shares the feed's :class:`rich.console.Console` so log lines and the live view do
not garble each other (see ``CLAUDE.md`` Section 4).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rich.console import Console

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


def configure_rich_logging(console: Console, level: int | str = logging.INFO) -> None:
    """Route root-logger output through a ``rich`` handler sharing ``console``.

    Installs a single :class:`rich.logging.RichHandler` on the root logger (after
    removing any existing handlers) so that, during a run with the live activity
    feed, log records and the ``rich.Live`` view write to the *same* console
    without garbling each other. Intended to be called once from the runner entry
    point in place of :func:`configure_logging`.

    Args:
        console: The shared ``rich`` console the activity feed renders to
            (typically ``Console(stderr=True)``).
        level: Logging level as a stdlib level constant (e.g. ``logging.INFO``)
            or its name (e.g. ``"INFO"``).

    Returns:
        None.

    Side effects:
        Mutates the root logger: sets its level and replaces its handlers with a
        single :class:`rich.logging.RichHandler` bound to ``console``.
    """
    from rich.logging import RichHandler

    root = logging.getLogger()
    root.setLevel(level)

    handler = RichHandler(console=console, rich_tracebacks=True)
    handler.setLevel(level)

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

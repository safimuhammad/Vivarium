"""Smoke tests for :mod:`core.logging`."""

from __future__ import annotations

import logging

from core.logging import configure_logging, get_logger


def test_get_logger_returns_named_logger() -> None:
    """``get_logger`` returns a logger with the requested name."""
    logger = get_logger("vivarium.test")
    assert isinstance(logger, logging.Logger)
    assert logger.name == "vivarium.test"


def test_configure_logging_sets_level_and_single_handler() -> None:
    """``configure_logging`` sets the root level and installs one handler."""
    root = logging.getLogger()
    original_level = root.level
    original_handlers = root.handlers[:]
    try:
        configure_logging(logging.DEBUG)
        assert root.level == logging.DEBUG
        assert len(root.handlers) == 1
        # Idempotent: a second call does not stack handlers.
        configure_logging(logging.WARNING)
        assert root.level == logging.WARNING
        assert len(root.handlers) == 1
    finally:
        root.setLevel(original_level)
        root.handlers[:] = original_handlers

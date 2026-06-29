"""Smoke tests for the :mod:`core.exceptions` hierarchy."""

from __future__ import annotations

import pytest

from core.exceptions import (
    ConfigError,
    EventBusError,
    MemoryStoreError,
    ToolError,
    VivariumError,
    WorldStateError,
)

_SUBCLASSES = [WorldStateError, EventBusError, ToolError, ConfigError, MemoryStoreError]


@pytest.mark.parametrize("exc_type", _SUBCLASSES)
def test_subclasses_inherit_from_base(exc_type: type[VivariumError]) -> None:
    """Every concrete error is a ``VivariumError`` (and an ``Exception``)."""
    assert issubclass(exc_type, VivariumError)
    assert issubclass(exc_type, Exception)


@pytest.mark.parametrize("exc_type", _SUBCLASSES)
def test_base_catches_subclasses(exc_type: type[VivariumError]) -> None:
    """``except VivariumError`` catches each concrete subclass."""
    with pytest.raises(VivariumError):
        raise exc_type("boom")


def test_message_is_preserved() -> None:
    """The error message round-trips through ``str``."""
    err = ToolError("unknown tool: teleport")
    assert str(err) == "unknown tool: teleport"


def test_chaining_preserves_cause() -> None:
    """``raise ... from`` records the underlying cause."""
    cause = ValueError("bad value")
    try:
        raise ToolError("wrap") from cause
    except ToolError as exc:
        assert exc.__cause__ is cause

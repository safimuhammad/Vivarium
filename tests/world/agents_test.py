"""Tests for :mod:`world.agents` -- the :class:`AgentState` dataclass and enum.

Characterizes the agent domain model: enum membership/values (relied on by the
config loader's ``AgentStatus(value)`` lookups), ``slots=True`` (no per-instance
``__dict__``), and the intentional *mutability* of the hot-path dataclass (it is
deliberately NOT frozen -- see ``CLAUDE.md`` Section 3).
"""

from __future__ import annotations

import dataclasses

import pytest

from world.agents import AgentState, AgentStatus


def test_agent_status_values() -> None:
    """``AgentStatus`` members map to their lowercase string values."""
    assert AgentStatus.ALIVE.value == "alive"
    assert AgentStatus.PARALYZED.value == "paralyzed"
    assert AgentStatus.DEAD.value == "dead"


def test_agent_status_lookup_by_value() -> None:
    """``AgentStatus(value)`` resolves -- the config loader depends on this."""
    assert AgentStatus("alive") is AgentStatus.ALIVE
    assert AgentStatus("paralyzed") is AgentStatus.PARALYZED
    assert AgentStatus("dead") is AgentStatus.DEAD


def test_agent_state_fields_assigned() -> None:
    """All constructor fields are stored on the instance."""
    agent = AgentState(
        id="wanderer_001",
        name="Ada",
        persona="Curious.",
        current_position="alpha",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    assert agent.id == "wanderer_001"
    assert agent.name == "Ada"
    assert agent.persona == "Curious."
    assert agent.current_position == "alpha"
    assert agent.current_energy == 100.0
    assert agent.current_materials == 50.0
    assert agent.status is AgentStatus.ALIVE


def test_agent_state_is_a_dataclass() -> None:
    """``AgentState`` is a stdlib dataclass."""
    assert dataclasses.is_dataclass(AgentState)


def test_agent_state_uses_slots() -> None:
    """``slots=True`` -> instances expose ``__slots__`` and have no ``__dict__``."""
    agent = AgentState(
        id="wanderer_001",
        name="Ada",
        persona="Curious.",
        current_position="alpha",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    assert hasattr(AgentState, "__slots__")
    assert not hasattr(agent, "__dict__")


def test_agent_state_is_mutable_not_frozen() -> None:
    """Hot-path dataclass is intentionally mutable (NOT frozen)."""
    agent = AgentState(
        id="wanderer_001",
        name="Ada",
        persona="Curious.",
        current_position="alpha",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    agent.current_energy = 42.0
    agent.status = AgentStatus.PARALYZED
    assert agent.current_energy == 42.0
    assert agent.status is AgentStatus.PARALYZED


def test_agent_state_slots_rejects_unknown_attribute() -> None:
    """With slots, assigning an undeclared attribute raises ``AttributeError``."""
    agent = AgentState(
        id="wanderer_001",
        name="Ada",
        persona="Curious.",
        current_position="alpha",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    with pytest.raises(AttributeError):
        agent.undeclared = "nope"  # type: ignore[attr-defined]

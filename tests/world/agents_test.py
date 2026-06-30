"""Tests for :mod:`world.agents` -- the :class:`AgentState` dataclass and enum.

Characterizes the agent domain model: enum membership/values (relied on by the
config loader's ``AgentStatus(value)`` lookups), ``slots=True`` (no per-instance
``__dict__``), and the intentional *mutability* of the hot-path dataclass (it is
deliberately NOT frozen -- see ``CLAUDE.md`` Section 3).
"""

from __future__ import annotations

import dataclasses

import pytest

from core.constants import HOARDING_ENERGY_THRESHOLD, HOARDING_MATERIALS_THRESHOLD
from world.agents import AgentState, AgentStatus, describe_agent_brief, is_hoarding


def _agent(**overrides: object) -> AgentState:
    """Build an ALIVE agent in ``alpha`` with modest resources; override as needed."""
    fields: dict[str, object] = {
        "id": "wanderer_001",
        "name": "Ada",
        "persona": "Curious.",
        "current_position": "alpha",
        "current_energy": 100.0,
        "current_materials": 50.0,
        "status": AgentStatus.ALIVE,
    }
    fields.update(overrides)
    return AgentState(**fields)  # type: ignore[arg-type]


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


# ---- is_hoarding -----------------------------------------------------------


def test_is_hoarding_true_over_either_threshold() -> None:
    """An agent over the energy OR the materials threshold is hoarding."""
    assert is_hoarding(_agent(current_energy=HOARDING_ENERGY_THRESHOLD + 1.0)) is True
    assert is_hoarding(_agent(current_materials=HOARDING_MATERIALS_THRESHOLD + 1.0)) is True


def test_is_hoarding_true_at_threshold_boundary() -> None:
    """Exactly at a threshold counts as hoarding (inclusive, like the paralysis dial)."""
    assert is_hoarding(_agent(current_energy=HOARDING_ENERGY_THRESHOLD)) is True


def test_is_hoarding_false_under_both_thresholds() -> None:
    """An agent below both thresholds is not hoarding."""
    assert (
        is_hoarding(
            _agent(
                current_energy=HOARDING_ENERGY_THRESHOLD - 1.0,
                current_materials=HOARDING_MATERIALS_THRESHOLD - 1.0,
            )
        )
        is False
    )


# ---- describe_agent_brief --------------------------------------------------


def test_describe_agent_brief_plain_alive_agent_has_no_marker() -> None:
    """A modest, living agent is described with no status/hoarding marker."""
    text = describe_agent_brief(_agent())
    assert "Ada" in text and "[id: wanderer_001]" in text
    assert "(dead)" not in text and "(fallen)" not in text and "(hoarding)" not in text


def test_describe_agent_brief_marks_hoarder() -> None:
    """A being over a hoarding threshold is visibly marked so others can react to it."""
    text = describe_agent_brief(_agent(current_materials=HOARDING_MATERIALS_THRESHOLD + 50.0))
    assert "(hoarding)" in text


def test_describe_agent_brief_marks_dead_hoarder_with_both() -> None:
    """Status and hoarding markers coexist (a slain being still sitting on a hoard)."""
    text = describe_agent_brief(
        _agent(status=AgentStatus.DEAD, current_energy=HOARDING_ENERGY_THRESHOLD + 10.0)
    )
    assert "(dead)" in text and "(hoarding)" in text

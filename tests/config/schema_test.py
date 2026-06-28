"""Tests for :mod:`config.schema` -- the Pydantic v2 config-boundary models.

These pin the validation contract for ``world.yaml`` *before* it becomes domain
state: required fields, type coercion (YAML ints -> domain floats), the
``status`` string -> :class:`~world.agents.AgentStatus` enum conversion, and the
strict ``extra="forbid"`` policy so typos in the config fail loudly. They also
cover the ``to_region`` / ``to_agent_state`` conversions into the stdlib domain
dataclasses (validate at the boundary, then trust internally).
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from config.schema import AgentConfig, RegionConfig, WorldConfig
from world.agents import AgentState, AgentStatus
from world.regions import Region


def valid_region_data() -> dict[str, Any]:
    """Return a well-formed region mapping (with int values, as YAML yields)."""
    return {
        "name": "alpha",
        "description": "A modest meadow.",
        "connections": ["beta"],
        "energy_rate": 1,
        "materials_rate": 1,
        "current_energy": 100,
        "current_materials": 100,
        "max_energy": 500,
        "max_materials": 500,
    }


def valid_agent_data() -> dict[str, Any]:
    """Return a well-formed agent mapping (status as the YAML string)."""
    return {
        "id": "wanderer_001",
        "name": "Ada",
        "persona": "Curious and careful.",
        "current_position": "alpha",
        "current_energy": 100,
        "current_materials": 5,
        "status": "alive",
    }


# ---- RegionConfig ----


def test_region_config_validates() -> None:
    """A well-formed region mapping validates into a ``RegionConfig``."""
    cfg = RegionConfig.model_validate(valid_region_data())
    assert cfg.name == "alpha"
    assert cfg.connections == ["beta"]


def test_region_config_coerces_int_to_float() -> None:
    """YAML int values are coerced to floats on the numeric fields."""
    cfg = RegionConfig.model_validate(valid_region_data())
    assert isinstance(cfg.current_energy, float)
    assert cfg.current_energy == 100.0
    assert isinstance(cfg.energy_rate, float)


def test_region_config_forbids_extra_field() -> None:
    """An unknown region field is rejected (``extra='forbid'``)."""
    data = valid_region_data()
    data["altitude"] = 10
    with pytest.raises(ValidationError):
        RegionConfig.model_validate(data)


def test_region_config_missing_required_field() -> None:
    """A missing required region field raises a ``ValidationError``."""
    data = valid_region_data()
    del data["name"]
    with pytest.raises(ValidationError):
        RegionConfig.model_validate(data)


def test_region_config_wrong_type_field() -> None:
    """A non-numeric string for a numeric field raises a ``ValidationError``."""
    data = valid_region_data()
    data["energy_rate"] = "speedy"
    with pytest.raises(ValidationError):
        RegionConfig.model_validate(data)


def test_region_config_to_region() -> None:
    """``to_region`` yields a stdlib :class:`~world.regions.Region`."""
    region = RegionConfig.model_validate(valid_region_data()).to_region()
    assert isinstance(region, Region)
    assert region.name == "alpha"
    assert region.connections == ["beta"]
    assert region.max_energy == 500.0


# ---- AgentConfig ----


def test_agent_config_validates() -> None:
    """A well-formed agent mapping validates into an ``AgentConfig``."""
    cfg = AgentConfig.model_validate(valid_agent_data())
    assert cfg.id == "wanderer_001"


def test_agent_config_status_becomes_enum() -> None:
    """The ``status`` string is converted to an :class:`AgentStatus` member."""
    cfg = AgentConfig.model_validate(valid_agent_data())
    assert cfg.status is AgentStatus.ALIVE


def test_agent_config_unknown_status_rejected() -> None:
    """An unknown ``status`` value raises a ``ValidationError``."""
    data = valid_agent_data()
    data["status"] = "zombie"
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(data)


def test_agent_config_forbids_extra_field() -> None:
    """An unknown agent field is rejected (``extra='forbid'``)."""
    data = valid_agent_data()
    data["nickname"] = "Ace"
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(data)


def test_agent_config_missing_required_field() -> None:
    """A missing required agent field raises a ``ValidationError``."""
    data = valid_agent_data()
    del data["persona"]
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(data)


def test_agent_config_to_agent_state() -> None:
    """``to_agent_state`` yields an :class:`AgentState` with the enum status."""
    agent = AgentConfig.model_validate(valid_agent_data()).to_agent_state()
    assert isinstance(agent, AgentState)
    assert agent.id == "wanderer_001"
    assert agent.status is AgentStatus.ALIVE
    assert isinstance(agent.current_energy, float)


# ---- WorldConfig ----


def test_world_config_validates() -> None:
    """A mapping with ``regions`` and ``agents`` validates into a ``WorldConfig``."""
    cfg = WorldConfig.model_validate(
        {"regions": [valid_region_data()], "agents": [valid_agent_data()]}
    )
    assert len(cfg.regions) == 1
    assert len(cfg.agents) == 1


def test_world_config_requires_regions() -> None:
    """A missing ``regions`` key raises a ``ValidationError``."""
    with pytest.raises(ValidationError):
        WorldConfig.model_validate({"agents": [valid_agent_data()]})


def test_world_config_requires_agents() -> None:
    """A missing ``agents`` key raises a ``ValidationError``."""
    with pytest.raises(ValidationError):
        WorldConfig.model_validate({"regions": [valid_region_data()]})


def test_world_config_forbids_extra_top_level_key() -> None:
    """An unknown top-level key is rejected (``extra='forbid'``)."""
    with pytest.raises(ValidationError):
        WorldConfig.model_validate(
            {
                "regions": [valid_region_data()],
                "agents": [valid_agent_data()],
                "metadata": {"author": "safi"},
            }
        )

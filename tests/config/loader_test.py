"""Tests for :mod:`config.loader` -- ``world.yaml`` -> :class:`WorldState`.

Covers the happy path (real ``config/world.yaml`` plus small inline YAML),
optional seeding for reproducible worlds, and every failure path wrapped as a
:class:`~core.exceptions.ConfigError` with a useful message: missing file,
malformed YAML, empty/non-mapping YAML, missing ``regions``/``agents`` keys,
missing required fields, wrong types, unknown ``status`` enum values, and unknown
extra fields (strict ``extra='forbid'`` policy).
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from config.loader import load_config
from core.exceptions import ConfigError
from core.rng import make_rng
from world.agents import AgentStatus
from world.world import WorldState

REAL_CONFIG: Path = Path(__file__).resolve().parents[2] / "config" / "world.yaml"

VALID_YAML: str = textwrap.dedent(
    """
    regions:
      - name: "alpha"
        description: "A modest meadow."
        connections: ["beta"]
        energy_rate: 1.0
        materials_rate: 1.0
        current_energy: 100
        current_materials: 100
        max_energy: 500
        max_materials: 500
      - name: "beta"
        description: "A quiet hollow."
        connections: ["alpha"]
        energy_rate: 2.0
        materials_rate: 0.5
        current_energy: 200
        current_materials: 50
        max_energy: 500
        max_materials: 500
    agents:
      - id: "wanderer_001"
        name: "Ada"
        current_position: "alpha"
        current_energy: 100
        current_materials: 5
        status: "alive"
    """
)


def write_yaml(tmp_path: Path, content: str) -> Path:
    """Write ``content`` to a temp ``world.yaml`` and return its path."""
    path = tmp_path / "world.yaml"
    path.write_text(content, encoding="utf-8")
    return path


# ---- happy path ----


def test_load_real_world_yaml() -> None:
    """The repository's ``config/world.yaml`` loads into a populated world."""
    world = load_config(REAL_CONFIG)
    assert isinstance(world, WorldState)
    assert {r.name for r in world.get_all_regions()} == {
        "nirvana",
        "nirvana_east",
        "warm_springs",
        "nirvana_west",
    }
    assert len(world.get_all_agents()) == 4
    for agent in world.get_all_agents():
        assert isinstance(agent.status, AgentStatus)


def test_load_inline_valid_builds_world(tmp_path: Path) -> None:
    """A small inline config parses into the expected regions and agents."""
    world = load_config(write_yaml(tmp_path, VALID_YAML))
    assert isinstance(world, WorldState)
    assert {r.name for r in world.get_all_regions()} == {"alpha", "beta"}
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.name == "Ada"
    assert agent.current_position == "alpha"


def test_status_converted_to_enum(tmp_path: Path) -> None:
    """Agent ``status`` strings become :class:`AgentStatus` members."""
    world = load_config(write_yaml(tmp_path, VALID_YAML))
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.status is AgentStatus.ALIVE


def test_numeric_values_coerced_to_float(tmp_path: Path) -> None:
    """YAML int resource values arrive as floats on the domain dataclasses."""
    world = load_config(write_yaml(tmp_path, VALID_YAML))
    region = world.get_region("alpha")
    assert region is not None
    assert isinstance(region.current_energy, float)
    assert region.current_energy == 100.0
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert isinstance(agent.current_energy, float)


def test_accepts_str_path() -> None:
    """``load_config`` accepts a plain ``str`` path (backward compatible)."""
    world = load_config(str(REAL_CONFIG))
    assert isinstance(world, WorldState)


# ---- seeding / determinism ----


def test_seed_produces_reproducible_world(tmp_path: Path) -> None:
    """Same config + same seed loaded twice gives the same RNG stream."""
    path = write_yaml(tmp_path, VALID_YAML)
    world_a = load_config(path, seed=42)
    world_b = load_config(path, seed=42)
    seq_a = [world_a.rng.random() for _ in range(5)]
    seq_b = [world_b.rng.random() for _ in range(5)]
    assert seq_a == seq_b


def test_seed_matches_independent_rng(tmp_path: Path) -> None:
    """The seeded world's RNG matches a standalone ``make_rng(seed)`` stream."""
    world = load_config(write_yaml(tmp_path, VALID_YAML), seed=42)
    reference = make_rng(42)
    assert [world.rng.random() for _ in range(5)] == [reference.random() for _ in range(5)]


def test_different_seeds_diverge(tmp_path: Path) -> None:
    """Different seeds produce different RNG streams."""
    path = write_yaml(tmp_path, VALID_YAML)
    world_a = load_config(path, seed=1)
    world_b = load_config(path, seed=2)
    assert [world_a.rng.random() for _ in range(5)] != [world_b.rng.random() for _ in range(5)]


def test_load_without_seed_builds_world(tmp_path: Path) -> None:
    """Omitting the seed still produces a usable world with an RNG."""
    world = load_config(write_yaml(tmp_path, VALID_YAML))
    assert isinstance(world, WorldState)
    assert isinstance(world.rng.random(), float)


# ---- failure paths (all -> ConfigError) ----


def test_missing_file_raises_config_error(tmp_path: Path) -> None:
    """A nonexistent path raises :class:`ConfigError`."""
    with pytest.raises(ConfigError):
        load_config(tmp_path / "does_not_exist.yaml")


def test_malformed_yaml_raises_config_error(tmp_path: Path) -> None:
    """Syntactically invalid YAML raises :class:`ConfigError`."""
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, "regions: [unclosed\n  - bad"))


def test_empty_yaml_raises_config_error(tmp_path: Path) -> None:
    """An empty config file raises :class:`ConfigError`."""
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, ""))


def test_non_mapping_yaml_raises_config_error(tmp_path: Path) -> None:
    """A top-level YAML list (not a mapping) raises :class:`ConfigError`."""
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, "- just\n- a\n- list\n"))


def test_missing_regions_key_raises_config_error(tmp_path: Path) -> None:
    """A config lacking ``regions`` raises :class:`ConfigError` mentioning it."""
    content = textwrap.dedent(
        """
        agents:
          - id: "wanderer_001"
            name: "Ada"
            current_position: "alpha"
            current_energy: 100
            current_materials: 5
            status: "alive"
        """
    )
    with pytest.raises(ConfigError) as excinfo:
        load_config(write_yaml(tmp_path, content))
    assert "regions" in str(excinfo.value)


def test_missing_agents_key_raises_config_error(tmp_path: Path) -> None:
    """A config lacking ``agents`` raises :class:`ConfigError` mentioning it."""
    content = textwrap.dedent(
        """
        regions:
          - name: "alpha"
            description: "A meadow."
            connections: ["beta"]
            energy_rate: 1.0
            materials_rate: 1.0
            current_energy: 100
            current_materials: 100
            max_energy: 500
            max_materials: 500
        """
    )
    with pytest.raises(ConfigError) as excinfo:
        load_config(write_yaml(tmp_path, content))
    assert "agents" in str(excinfo.value)


def test_missing_required_field_raises_config_error(tmp_path: Path) -> None:
    """A region missing a required field raises :class:`ConfigError`."""
    content = textwrap.dedent(
        """
        regions:
          - description: "No name here."
            connections: ["beta"]
            energy_rate: 1.0
            materials_rate: 1.0
            current_energy: 100
            current_materials: 100
            max_energy: 500
            max_materials: 500
        agents: []
        """
    )
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, content))


def test_wrong_type_raises_config_error(tmp_path: Path) -> None:
    """A non-numeric ``energy_rate`` raises :class:`ConfigError`."""
    content = textwrap.dedent(
        """
        regions:
          - name: "alpha"
            description: "A meadow."
            connections: ["beta"]
            energy_rate: "speedy"
            materials_rate: 1.0
            current_energy: 100
            current_materials: 100
            max_energy: 500
            max_materials: 500
        agents: []
        """
    )
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, content))


def test_unknown_status_raises_config_error(tmp_path: Path) -> None:
    """An unknown agent ``status`` raises :class:`ConfigError`."""
    content = textwrap.dedent(
        """
        regions: []
        agents:
          - id: "wanderer_001"
            name: "Ada"
            current_position: "alpha"
            current_energy: 100
            current_materials: 5
            status: "zombie"
        """
    )
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, content))


def test_unknown_extra_field_raises_config_error(tmp_path: Path) -> None:
    """An unknown extra field on an agent raises :class:`ConfigError` (strict)."""
    content = textwrap.dedent(
        """
        regions: []
        agents:
          - id: "wanderer_001"
            name: "Ada"
            current_position: "alpha"
            current_energy: 100
            current_materials: 5
            status: "alive"
            nickname: "Ace"
        """
    )
    with pytest.raises(ConfigError):
        load_config(write_yaml(tmp_path, content))


def test_config_error_chains_cause(tmp_path: Path) -> None:
    """The raised :class:`ConfigError` chains the underlying cause."""
    with pytest.raises(ConfigError) as excinfo:
        load_config(write_yaml(tmp_path, "regions: [unclosed"))
    assert excinfo.value.__cause__ is not None

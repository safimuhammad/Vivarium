"""Tests for the ``RunConfig`` payload: what it accepts, refuses, and derives."""

from __future__ import annotations

from pathlib import Path

import pytest

from config.loader import load_world_config
from config.schema import WorldConfig
from core.constants import GENESIS_SEED, MATING_MAX_OFFSPRING, REFLECT_EVERY_N_BREATHS
from core.run_knobs import (
    ABUNDANCE_DEFAULT,
    BEING_COUNT_MAX,
    PROVIDER_DEFAULT,
    SEED_DEFAULT,
)
from core.run_settings import (
    GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS,
    OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS,
)
from server.run_config import (
    BeingConfig,
    RunConfig,
    RunConfigError,
    build_run_world,
    default_run_config,
    derive_memory_root,
    run_defaults_payload,
    validate_run_config,
    warnings_for,
)

CONFIG_PATH = "config/world.yaml"


@pytest.fixture(name="world_config")
def world_config_fixture() -> WorldConfig:
    return load_world_config(CONFIG_PATH)


def _region_names(world_config: WorldConfig) -> set[str]:
    return {region.name for region in world_config.regions}


def _payload(world_config: WorldConfig, **overrides: object) -> dict[str, object]:
    payload = default_run_config(world_config).to_payload()
    payload.update(overrides)
    return payload


def _messages(exc: RunConfigError) -> dict[str, str]:
    return {error.field: error.message for error in exc.errors}


# --- Defaults ---------------------------------------------------------------


def test_defaults_come_from_the_authored_world_file(world_config: WorldConfig) -> None:
    """The screen's defaults track ``world.yaml``, not a second copy of its numbers."""
    config = default_run_config(world_config)
    assert [being.name for being in config.beings] == ["Joe", "Mae", "Dick", "Allen"]
    assert [being.start_region for being in config.beings] == [
        "warm_springs",
        "warm_springs",
        "nirvana",
        "nirvana",
    ]
    assert config.abundance == ABUNDANCE_DEFAULT
    assert config.seed == SEED_DEFAULT
    assert config.provider == PROVIDER_DEFAULT
    assert config.reflect_every_n_breaths == REFLECT_EVERY_N_BREATHS
    assert config.max_offspring == MATING_MAX_OFFSPRING


def test_defaults_payload_carries_bounds_labels_and_the_locked_regions(
    world_config: WorldConfig,
) -> None:
    """The screen must hardcode nothing -- not a bound, not a label, not a region."""
    payload = run_defaults_payload(world_config)
    knobs = payload["knobs"]
    assert isinstance(knobs, dict)
    assert set(knobs) == {
        "beings",
        "abundance",
        "seed",
        "duration_seconds",
        "provider",
        "reflect_every_n_breaths",
        "max_offspring",
    }

    abundance = knobs["abundance"]
    assert isinstance(abundance, dict)
    assert abundance["min"] == 0.25
    assert abundance["max"] == 3.0
    assert abundance["min_label"] == "the land is dying"
    assert abundance["max_label"] == "the land provides"

    regions = payload["regions"]
    assert isinstance(regions, list)
    assert [region["name"] for region in regions] == [
        "nirvana",
        "nirvana_east",
        "warm_springs",
        "nirvana_west",
    ]
    # Section 5.3: regen is per tick while home upkeep is per second, so the rail
    # states the effective per-second figure rather than leaving the viewer to guess.
    assert regions[0]["effective_energy_per_second"] == pytest.approx(0.2 / 5.0)

    derived = payload["derived"]
    assert isinstance(derived, dict)
    assert derived["mating_proposal_timeout_seconds"] == {
        "gemini": GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS,
        "ollama": OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS,
    }


def test_persona_disclaimer_promises_only_what_the_code_does(
    world_config: WorldConfig,
) -> None:
    """``seed.md`` is never rewritten, so the copy must say the being *appends*."""
    knobs = run_defaults_payload(world_config)["knobs"]
    assert isinstance(knobs, dict)
    beings = knobs["beings"]
    assert isinstance(beings, dict)
    disclaimer = beings["fields"]["persona"]["help"]
    assert "Your words stay" in disclaimer
    assert "It can contradict you. It cannot delete you." in disclaimer
    assert "may write" in disclaimer  # revise_self is optional; never promise "will"


# --- Validation -------------------------------------------------------------


def test_valid_payload_round_trips(world_config: WorldConfig) -> None:
    config = validate_run_config(_payload(world_config), region_names=_region_names(world_config))
    assert config.to_payload() == default_run_config(world_config).to_payload()


def test_every_bad_field_is_reported_at_once(world_config: WorldConfig) -> None:
    """A viewer must not discover problems one submission at a time."""
    payload = _payload(
        world_config,
        abundance=9.0,
        seed=-1,
        reflect_every_n_breaths=0,
        max_offspring=99,
        duration_seconds=1.0,
    )
    beings = payload["beings"]
    assert isinstance(beings, list)
    beings[0]["energy"] = 1.0
    beings[1]["start_region"] = "atlantis"

    with pytest.raises(RunConfigError) as caught:
        validate_run_config(payload, region_names=_region_names(world_config))

    messages = _messages(caught.value)
    assert set(messages) == {
        "abundance",
        "seed",
        "reflect_every_n_breaths",
        "max_offspring",
        "duration_seconds",
        "beings.0.energy",
        "beings.1.start_region",
    }
    assert "between 0.25x and 3.0x" in messages["abundance"]
    assert "between 50 and 200" in messages["beings.0.energy"]
    assert "The four regions are locked" in messages["beings.1.start_region"]
    assert messages["max_offspring"] == "Children per being must be between 0 and 10."


def test_a_coupled_value_may_not_be_submitted(world_config: WorldConfig) -> None:
    """The derived values must not merely be ignored -- submitting one is an error."""
    payload = _payload(world_config, mating_proposal_timeout_seconds=5.0)
    with pytest.raises(RunConfigError) as caught:
        validate_run_config(payload, region_names=_region_names(world_config))
    message = _messages(caught.value)["mating_proposal_timeout_seconds"]
    assert "derived by the server, never submitted" in message


def test_regions_are_not_part_of_the_payload(world_config: WorldConfig) -> None:
    payload = _payload(world_config, regions=[{"name": "atlantis"}])
    with pytest.raises(RunConfigError) as caught:
        validate_run_config(payload, region_names=_region_names(world_config))
    assert "The four regions are locked" in _messages(caught.value)["regions"]


def test_roster_size_is_bounded(world_config: WorldConfig) -> None:
    default_being = default_run_config(world_config).beings[0].model_dump(mode="json")
    payload = _payload(world_config, beings=[dict(default_being)] * (BEING_COUNT_MAX + 1))
    with pytest.raises(RunConfigError) as caught:
        validate_run_config(payload, region_names=_region_names(world_config))
    assert "between 1 and 12 beings" in _messages(caught.value)["beings"]

    with pytest.raises(RunConfigError) as caught:
        validate_run_config(
            _payload(world_config, beings=[]), region_names=_region_names(world_config)
        )
    assert "between 1 and 12 beings" in _messages(caught.value)["beings"]


def test_blank_name_and_blank_persona_are_refused(world_config: WorldConfig) -> None:
    payload = _payload(
        world_config,
        beings=[{"name": "   ", "start_region": "nirvana", "persona": "  "}],
    )
    with pytest.raises(RunConfigError) as caught:
        validate_run_config(payload, region_names=_region_names(world_config))
    messages = _messages(caught.value)
    assert messages["beings.0.name"] == "Every being needs a name."
    assert "leave it out to use the shared words" in messages["beings.0.persona"]


def test_an_unbounded_run_is_legal(world_config: WorldConfig) -> None:
    config = validate_run_config(
        _payload(world_config, duration_seconds=None),
        region_names=_region_names(world_config),
    )
    assert config.duration_seconds is None


# --- Assembly ---------------------------------------------------------------


def test_abundance_scales_every_region_rate_and_nothing_else(
    world_config: WorldConfig,
) -> None:
    """One slider on the eight rates; the authored gradient and the pools survive."""
    config = default_run_config(world_config).model_copy(update={"abundance": 2.0})
    world = build_run_world(config, world_config)

    authored = {region.name: region for region in world_config.regions}
    for region in world.get_all_regions():
        source = authored[region.name]
        assert region.energy_rate == pytest.approx(source.energy_rate * 2.0)
        assert region.materials_rate == pytest.approx(source.materials_rate * 2.0)
        assert region.current_energy == source.current_energy
        assert region.max_energy == source.max_energy

    rates = {region.name: region.energy_rate for region in world.get_all_regions()}
    assert rates["warm_springs"] > rates["nirvana"] > rates["nirvana_west"]


def test_being_ids_are_derived_not_configured(world_config: WorldConfig) -> None:
    """Ids hash to a sprite and name a memory directory, so a viewer cannot set them."""
    config = default_run_config(world_config)
    world = build_run_world(config, world_config)
    assert [agent.id for agent in world.get_all_agents()] == [
        "wanderer_001",
        "wanderer_002",
        "wanderer_003",
        "wanderer_004",
    ]


def test_a_being_without_a_persona_is_born_from_the_shared_seed(
    world_config: WorldConfig,
) -> None:
    world = build_run_world(default_run_config(world_config), world_config)
    assert all(agent.persona == GENESIS_SEED for agent in world.get_all_agents())


def test_a_written_persona_becomes_the_beings_birth_nature(
    world_config: WorldConfig,
) -> None:
    config = RunConfig(
        beings=[
            BeingConfig(name="Sol", start_region="nirvana", persona="I keep what I find."),
            BeingConfig(name="Vera", start_region="nirvana"),
        ]
    )
    world = build_run_world(config, world_config)
    agents = world.get_all_agents()
    assert agents[0].persona == "I keep what I find."
    assert agents[1].persona == GENESIS_SEED


def test_the_world_carries_the_derived_mating_timeout(world_config: WorldConfig) -> None:
    """The lifetime tracks the decider's cadence; it is never a submitted number."""
    hosted = build_run_world(
        default_run_config(world_config).model_copy(update={"provider": "gemini"}),
        world_config,
    )
    assert hosted.run_settings.mating_proposal_timeout_seconds == (
        GEMINI_MATING_PROPOSAL_TIMEOUT_SECONDS
    )

    local = build_run_world(
        default_run_config(world_config).model_copy(update={"provider": "ollama"}),
        world_config,
    )
    assert local.run_settings.mating_proposal_timeout_seconds == (
        OLLAMA_MATING_PROPOSAL_TIMEOUT_FLOOR_SECONDS
    )


def test_the_world_carries_the_configured_ceiling_and_cadence(
    world_config: WorldConfig,
) -> None:
    config = default_run_config(world_config).model_copy(
        update={"max_offspring": 2, "reflect_every_n_breaths": 24}
    )
    world = build_run_world(config, world_config)
    assert world.run_settings.mating_max_offspring == 2
    assert world.run_settings.reflect_every_n_breaths == 24


# --- Derived memory root ----------------------------------------------------


def test_each_run_gets_its_own_memory_root(tmp_path: Path) -> None:
    """A shared root silently discards a written persona: ``seed.md`` is write-once."""
    first = derive_memory_root(tmp_path)
    second = derive_memory_root(tmp_path)
    assert first != second
    assert first.parent == tmp_path
    assert second.parent == tmp_path


# --- Warnings ---------------------------------------------------------------


def test_beings_alone_in_separate_regions_are_warned_about_not_refused(
    world_config: WorldConfig,
) -> None:
    config = RunConfig(
        beings=[
            BeingConfig(name="A", start_region="nirvana"),
            BeingConfig(name="B", start_region="nirvana_east"),
            BeingConfig(name="C", start_region="warm_springs"),
            BeingConfig(name="D", start_region="nirvana_west"),
        ]
    )
    world = build_run_world(config, world_config)
    warnings = warnings_for(config, regions=list(world.get_all_regions()))
    assert any("begins alone" in warning for warning in warnings)


def test_the_default_world_is_not_warned_about_isolation(world_config: WorldConfig) -> None:
    config = default_run_config(world_config)
    world = build_run_world(config, world_config)
    warnings = warnings_for(config, regions=list(world.get_all_regions()))
    assert not any("begins alone" in warning for warning in warnings)

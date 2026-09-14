"""The ``RunConfig`` payload: what a viewer may set before pressing "Let's go live".

This module is the configuration boundary for the run-lifecycle API, the sibling of
:mod:`config.schema` (which validates ``world.yaml``). It holds three things:

* :class:`RunConfig` -- the payload, carrying **only** the knobs in the design spec's
  Section 3.2. Regions are not in it; they are locked. Neither are the two values the
  server must derive (see below), nor any world rule the screen has no business
  touching.
* :func:`validate_run_config` -- validation against the measured sane bands, reporting
  **one message per field** rather than starting a world that is dead in twenty minutes.
* :func:`build_run_world` -- assembly of the world that config describes: the locked
  regions from ``world.yaml`` with their regeneration scaled by ``abundance``, the
  configured beings, and the run's derived
  :class:`~core.run_settings.RunSettings`.

**Two values are derived here and can never be submitted.**

1. ``MATING_PROPOSAL_TIMEOUT_SECONDS`` -- from ``(provider, being count)``, via
   :func:`~core.run_settings.derive_mating_proposal_timeout`. It must outlast the
   *target's* breath interval or reproduction silently never completes.
2. ``memory_root`` -- a fresh directory per run, via :func:`derive_memory_root`. The
   default root is not namespaced while ``run_dir`` is, and founder ids are stable, so
   collision is the default; because ``seed.md`` is written only if absent
   (:class:`~memory.store.FileMemoryStore`), a second run into the same root
   **silently discards the persona the viewer just wrote** and the being wakes
   carrying the previous run's self-narrative. Without a fresh root the persona field
   on the screen is a lie.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, ValidationError, ValidationInfo, field_validator

from config.schema import WorldConfig
from core.constants import (
    GENESIS_SEED,
    HOARDING_ENERGY_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    IDLE_AGING_ENERGY_COST,
    MATING_MAX_OFFSPRING,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    PARALYSIS_ENERGY_THRESHOLD,
    REFLECT_EVERY_N_BREATHS,
)
from core.rng import make_rng
from core.run_knobs import (
    ABUNDANCE_DEFAULT,
    ABUNDANCE_MAX,
    ABUNDANCE_MIN,
    BEING_COUNT_MAX,
    BEING_COUNT_MIN,
    BEING_ENERGY_DEFAULT,
    BEING_ENERGY_MAX,
    BEING_ENERGY_MIN,
    BEING_MATERIALS_DEFAULT,
    BEING_MATERIALS_MAX,
    BEING_MATERIALS_MIN,
    BEING_NAME_MAX_LENGTH,
    DEFAULT_BEING_NAMES,
    DURATION_DEFAULT_SECONDS,
    DURATION_MAX_SECONDS,
    DURATION_MIN_SECONDS,
    MAX_OFFSPRING_MAX,
    MAX_OFFSPRING_MIN,
    PERSONA_MAX_LENGTH,
    PROVIDER_CHOICES,
    PROVIDER_DEFAULT,
    REFLECT_MAX,
    REFLECT_MIN,
    SEED_DEFAULT,
    SEED_MAX,
    SEED_MIN,
    ProviderName,
    run_knob_catalog,
)
from core.run_settings import RunSettings, derive_mating_proposal_timeout, derive_run_settings
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

__all__ = [
    "BeingConfig",
    "FieldError",
    "RunConfig",
    "RunConfigError",
    "build_run_world",
    "default_run_config",
    "derive_memory_root",
    "run_defaults_payload",
    "validate_run_config",
    "warnings_for",
]

AGENT_ID_PREFIX: Final[str] = "wanderer"
"""Founder id prefix. Ids are derived, never configured: they hash to a being's sprite
and name its memory directory, so a viewer must not be able to collide them."""

_STRICT = ConfigDict(extra="forbid", allow_inf_nan=False)


@dataclass(frozen=True, slots=True)
class FieldError:
    """One rejected field and the sentence explaining why.

    Attributes:
        field: Dotted path into the payload (``"beings.2.energy"``).
        message: A complete sentence a viewer can act on.
    """

    field: str
    message: str

    def to_dict(self) -> dict[str, str]:
        """Return a JSON-ready mapping."""
        return {"field": self.field, "message": self.message}


class RunConfigError(Exception):
    """Raised when a submitted run configuration cannot start a world.

    Attributes:
        errors: Every rejected field, so the screen can mark them all at once
            rather than making the viewer discover them one submission at a time.
    """

    def __init__(self, errors: list[FieldError]) -> None:
        self.errors = errors
        super().__init__("; ".join(f"{error.field}: {error.message}" for error in errors))

    def to_detail(self) -> dict[str, object]:
        """Return the JSON body for a 422 response."""
        return {"errors": [error.to_dict() for error in self.errors]}


class BeingConfig(BaseModel):
    """One being's starting conditions.

    Attributes:
        name: Display name. A label, not a character.
        start_region: Name of one of the locked regions it wakes in.
        energy: Starting energy reserve.
        materials: Starting materials reserve.
        persona: Optional birth nature. ``None`` uses the shared
            :data:`~core.constants.GENESIS_SEED`. Whatever is written here is what
            ``seed.md`` receives, and the being appends beneath it -- it can
            contradict these words, it cannot delete them.
    """

    model_config = _STRICT

    name: str
    start_region: str
    energy: float = BEING_ENERGY_DEFAULT
    materials: float = BEING_MATERIALS_DEFAULT
    persona: str | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        """Reject a blank or oversized name.

        Args:
            value: The submitted name.

        Returns:
            The stripped name.

        Raises:
            ValueError: If the name is blank or too long.
        """
        stripped = value.strip()
        if not stripped:
            raise ValueError("Every being needs a name.")
        if len(stripped) > BEING_NAME_MAX_LENGTH:
            raise ValueError(f"A name may be at most {BEING_NAME_MAX_LENGTH} characters.")
        return stripped

    @field_validator("start_region")
    @classmethod
    def _check_start_region(cls, value: str, info: ValidationInfo) -> str:
        """Reject a being that begins somewhere the world does not have.

        The four regions are locked, so this is membership, not shape. It runs in the
        same validation pass as every other field so the screen can mark all the bad
        fields at once instead of revealing them one submission at a time. Direct
        construction (no validation context) skips the check, since the caller then
        already holds the region list.

        Args:
            value: The submitted region name.
            info: Pydantic validation context; ``region_names`` when supplied.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the region is not one of the locked four.
        """
        context = info.context if isinstance(info.context, dict) else None
        if context is None:
            return value
        known = context.get("region_names")
        if not isinstance(known, set) or value in known:
            return value
        raise ValueError(
            f"There is no region called {value!r}. The four regions are locked: "
            f"{', '.join(sorted(str(name) for name in known))}."
        )

    @field_validator("energy")
    @classmethod
    def _check_energy(cls, value: float) -> float:
        """Reject starting energy outside the measured band.

        Args:
            value: The submitted starting energy.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the band.
        """
        if not BEING_ENERGY_MIN <= value <= BEING_ENERGY_MAX:
            raise ValueError(
                f"Starting energy must be between {BEING_ENERGY_MIN:.0f} and "
                f"{BEING_ENERGY_MAX:.0f}. Below {PARALYSIS_ENERGY_THRESHOLD:.0f} a being "
                f"is frozen the first time it loses anything; at "
                f"{HOARDING_ENERGY_THRESHOLD:.0f} or more it is born flagged as a hoarder."
            )
        return value

    @field_validator("materials")
    @classmethod
    def _check_materials(cls, value: float) -> float:
        """Reject starting materials outside the measured band.

        Args:
            value: The submitted starting materials.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the band.
        """
        if not BEING_MATERIALS_MIN <= value <= BEING_MATERIALS_MAX:
            raise ValueError(
                f"Starting materials must be between {BEING_MATERIALS_MIN:.0f} and "
                f"{BEING_MATERIALS_MAX:.0f}. Mating needs "
                f"{MATING_MIN_MATERIALS_CONTRIBUTION:.0f}; a home costs "
                f"{HOME_BUILD_MATERIALS_COST:.0f}."
            )
        return value

    @field_validator("persona")
    @classmethod
    def _check_persona(cls, value: str | None) -> str | None:
        """Reject a blank-but-present or oversized persona.

        Args:
            value: The submitted persona, or ``None``.

        Returns:
            The persona, or ``None``.

        Raises:
            ValueError: If the persona is blank or too long.
        """
        if value is None:
            return None
        if not value.strip():
            raise ValueError(
                "A persona must not be blank -- leave it out to use the shared words "
                "every being is born from."
            )
        if len(value) > PERSONA_MAX_LENGTH:
            raise ValueError(f"A persona may be at most {PERSONA_MAX_LENGTH} characters.")
        return value


class RunConfig(BaseModel):
    """Everything a viewer chooses before a run begins.

    Attributes:
        beings: The starting roster, in order. Ids are derived from position.
        abundance: One multiplier applied to every region's regeneration rates
            together, preserving the authored richness gradient.
        seed: World RNG seed. It shapes the land; it reproduces almost nothing else.
        duration_seconds: Wall-clock bound, or ``None`` for an unbounded run.
        provider: Where the minds run (``"mlx"`` = this Mac's local MLX model,
            ``"ollama"`` = an explicit local Ollama model, or ``"gemini"`` = the cloud).
        reflect_every_n_breaths: How often a being pauses and may write about who it
            has become.
        max_offspring: Per-being offspring ceiling -- the population cap.
    """

    model_config = _STRICT

    beings: list[BeingConfig]
    abundance: float = ABUNDANCE_DEFAULT
    seed: int = SEED_DEFAULT
    duration_seconds: float | None = DURATION_DEFAULT_SECONDS
    provider: ProviderName = PROVIDER_DEFAULT
    reflect_every_n_breaths: int = REFLECT_EVERY_N_BREATHS
    max_offspring: int = MATING_MAX_OFFSPRING

    @field_validator("beings")
    @classmethod
    def _check_roster(cls, value: list[BeingConfig]) -> list[BeingConfig]:
        """Reject a roster outside the supported size.

        Args:
            value: The submitted roster.

        Returns:
            The roster, unchanged.

        Raises:
            ValueError: If the roster is too small or too large.
        """
        if not BEING_COUNT_MIN <= len(value) <= BEING_COUNT_MAX:
            raise ValueError(
                f"A world holds between {BEING_COUNT_MIN} and {BEING_COUNT_MAX} beings; "
                f"{len(value)} were given."
            )
        return value

    @field_validator("abundance")
    @classmethod
    def _check_abundance(cls, value: float) -> float:
        """Reject an abundance multiplier outside the judged band.

        Args:
            value: The submitted multiplier.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the band.
        """
        if not ABUNDANCE_MIN <= value <= ABUNDANCE_MAX:
            raise ValueError(
                f"World abundance must be between {ABUNDANCE_MIN}x and {ABUNDANCE_MAX}x. "
                "The land is already deliberately scarce -- this multiplies an existing "
                "deficit, it does not remove it."
            )
        return value

    @field_validator("seed")
    @classmethod
    def _check_seed(cls, value: int) -> int:
        """Reject a seed outside the representable range.

        Args:
            value: The submitted seed.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the range.
        """
        if not SEED_MIN <= value <= SEED_MAX:
            raise ValueError(f"The seed must be a whole number between {SEED_MIN} and {SEED_MAX}.")
        return value

    @field_validator("duration_seconds")
    @classmethod
    def _check_duration(cls, value: float | None) -> float | None:
        """Reject a run length outside the supported band.

        Args:
            value: The submitted length in seconds, or ``None`` for unbounded.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If a bounded length is outside the band.
        """
        if value is None:
            return None
        if not DURATION_MIN_SECONDS <= value <= DURATION_MAX_SECONDS:
            raise ValueError(
                f"A run must last between {DURATION_MIN_SECONDS:.0f} seconds and "
                f"{DURATION_MAX_SECONDS / 3600:.0f} hours, or be unbounded (null)."
            )
        return value

    @field_validator("reflect_every_n_breaths")
    @classmethod
    def _check_reflect(cls, value: int) -> int:
        """Reject a reflection cadence outside the supported band.

        Args:
            value: The submitted cadence.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the band.
        """
        if not REFLECT_MIN <= value <= REFLECT_MAX:
            raise ValueError(
                f"A being must reflect at least every {REFLECT_MAX} breaths and no more "
                f"often than every {REFLECT_MIN}."
            )
        return value

    @field_validator("max_offspring")
    @classmethod
    def _check_max_offspring(cls, value: int) -> int:
        """Reject an offspring ceiling outside the supported band.

        Args:
            value: The submitted ceiling.

        Returns:
            The value, unchanged.

        Raises:
            ValueError: If the value is outside the band.
        """
        if not MAX_OFFSPRING_MIN <= value <= MAX_OFFSPRING_MAX:
            raise ValueError(
                f"Children per being must be between {MAX_OFFSPRING_MIN} and {MAX_OFFSPRING_MAX}."
            )
        return value

    def to_payload(self) -> dict[str, Any]:
        """Return the JSON-ready config, exactly as it would be resubmitted.

        Returns:
            A mapping matching the ``RunConfig`` contract.
        """
        return self.model_dump(mode="json")


def _format_location(location: tuple[int | str, ...]) -> str:
    """Return a dotted field path from a Pydantic error location.

    Args:
        location: The Pydantic ``loc`` tuple.

    Returns:
        A dotted path (``"beings.2.energy"``), or ``"(payload)"`` when empty.
    """
    return ".".join(str(part) for part in location) if location else "(payload)"


def _message_for(error: dict[str, Any]) -> str:
    """Return a viewer-facing sentence for one Pydantic error.

    Custom ``ValueError`` messages raised by the validators above already read as
    sentences; Pydantic prefixes them with ``"Value error, "``, which is stripped.
    The structural error types get their own wording, because Pydantic's defaults do
    not say *why* a field is not allowed here.

    Args:
        error: One entry from :meth:`pydantic.ValidationError.errors`.

    Returns:
        The message to show.
    """
    kind = str(error.get("type", ""))
    message = str(error.get("msg", "This value is not valid."))
    if kind == "missing":
        return "This is required."
    if kind == "extra_forbidden":
        return (
            "This is not part of a run configuration. The four regions are locked and "
            "the coupled values (how long a mating proposal stands, and where memory "
            "is written) are derived by the server, never submitted."
        )
    return message.removeprefix("Value error, ")


def validate_run_config(payload: object, *, region_names: set[str]) -> RunConfig:
    """Validate a submitted run configuration, reporting every bad field at once.

    Args:
        payload: The raw decoded JSON body.
        region_names: The locked region names from ``world.yaml``; a being must start
            in one of them.

    Returns:
        The validated :class:`RunConfig`.

    Raises:
        RunConfigError: If any field is missing, unknown, or outside its sane band.
            Every failure is reported, not just the first.
    """
    try:
        return RunConfig.model_validate(payload, context={"region_names": region_names})
    except ValidationError as exc:
        raise RunConfigError(
            [
                FieldError(_format_location(error["loc"]), _message_for(dict(error)))
                for error in exc.errors()
            ]
        ) from exc


def warnings_for(config: RunConfig, *, regions: list[Region]) -> list[str]:
    """Return non-blocking cautions about a configuration that is legal but bleak.

    These are deliberately *not* rejections. A world where every being begins alone is
    legal and produces a near-dead run; that is a viewer's choice to make, but it
    should be an informed one.

    Args:
        config: The validated configuration.
        regions: The regions as the run will build them (rates already scaled).

    Returns:
        Zero or more sentences, in a stable order.
    """
    warnings: list[str] = []
    positions = [being.start_region for being in config.beings]
    if len(config.beings) > 1 and len(set(positions)) == len(positions):
        warnings.append(
            "Every being begins alone in a different region. They may never meet, and "
            "nothing social can happen."
        )
    if len(config.beings) == 1:
        warnings.append(
            "A single being has no one to speak to, trade with, or bring a child into "
            "the world with."
        )

    regen_per_second = sum(region.energy_rate for region in regions) / WORLD_TICK_INTERVAL_SECONDS
    drain_per_second = len(config.beings) * IDLE_AGING_ENERGY_COST / WORLD_TICK_INTERVAL_SECONDS
    if regen_per_second * LEAN_LAND_REGEN_RATIO < drain_per_second:
        warnings.append(
            f"The land regenerates about {regen_per_second:.2f} energy a second against "
            f"roughly {drain_per_second:.2f} a second of drain from "
            f"{len(config.beings)} beings. Expect scarcity to bite early."
        )

    if all(being.materials < MATING_MIN_MATERIALS_CONTRIBUTION for being in config.beings):
        warnings.append(
            f"No being starts with the {MATING_MIN_MATERIALS_CONTRIBUTION:.0f} materials "
            "a mating proposal costs; every child must be earned from the land first."
        )
    names = [being.name for being in config.beings]
    if len(set(names)) != len(names):
        warnings.append("Two beings share a name. They are still distinct beings.")
    return warnings


WORLD_TICK_INTERVAL_SECONDS: Final[float] = 5.0
"""The locked world-tick interval, in seconds.

Regeneration is per *tick* while home upkeep is per *second*, so halving this would
silently double the food supply while leaving the home economy untouched. It is
therefore not a configurable knob; it is the constant the abundance slider's
per-second figures are computed against.
"""

LEAN_LAND_REGEN_RATIO: Final[float] = 1.0
"""How much of the idle drain the land must cover before the lean-land caution fires."""


def default_being_configs(world_config: WorldConfig) -> list[BeingConfig]:
    """Return the authored default roster, read from ``world.yaml``.

    The file's own agents are the authored default (two co-located pairs, 100 energy,
    45 materials), so the screen's defaults track the file rather than a second copy
    of the same numbers.

    Args:
        world_config: The validated world config.

    Returns:
        One :class:`BeingConfig` per configured agent, in file order.
    """
    return [
        BeingConfig(
            name=agent.name or DEFAULT_BEING_NAMES[index % len(DEFAULT_BEING_NAMES)],
            start_region=agent.current_position,
            energy=agent.current_energy,
            materials=agent.current_materials,
            persona=None,
        )
        for index, agent in enumerate(world_config.agents)
    ]


def default_run_config(world_config: WorldConfig) -> RunConfig:
    """Return the configuration the screen opens with.

    Args:
        world_config: The validated world config supplying the authored roster.

    Returns:
        The default :class:`RunConfig`.
    """
    return RunConfig(beings=default_being_configs(world_config))


def derive_memory_root(base: str | Path, *, run_token: str | None = None) -> Path:
    """Return a fresh, never-before-used memory root for one run.

    ``memory_root`` is not namespaced by default while ``run_dir`` is, and founder ids
    are stable, so two runs share a being's directory. Since ``seed.md`` is written
    only when absent, the second run's persona is silently discarded and the being
    wakes with the previous run's self-narrative. Namespacing the root is what makes
    the persona field on the configuration screen true.

    Args:
        base: The parent directory runs write memory beneath.
        run_token: Optional pre-minted directory name (tests pass one for
            determinism); a timestamp plus a random nonce is generated otherwise.

    Returns:
        The per-run memory root. It is not created here --
        :class:`~memory.store.FileMemoryStore` creates each being's directory.
    """
    token = run_token or f"run-{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}"
    return Path(base) / token


def build_run_world(config: RunConfig, world_config: WorldConfig) -> WorldState:
    """Build the world one :class:`RunConfig` describes.

    The regions come from ``world.yaml`` unchanged except for their two regeneration
    rates, which are scaled together by ``abundance`` so the authored richness
    gradient (Warm Springs richest, Nirvana West barren) survives the slider. The
    beings are the configured roster; their ids are derived from position so a viewer
    cannot collide the directories memory is written into, or the hash a sprite is
    chosen by.

    Args:
        config: The validated configuration.
        world_config: The validated ``world.yaml`` supplying the locked regions.

    Returns:
        A :class:`~world.world.WorldState` carrying the run's derived
        :class:`~core.run_settings.RunSettings`.
    """
    regions: list[Region] = []
    for region_config in world_config.regions:
        region = region_config.to_region()
        region.energy_rate *= config.abundance
        region.materials_rate *= config.abundance
        regions.append(region)

    agents = [
        AgentState(
            id=f"{AGENT_ID_PREFIX}_{index:03d}",
            name=being.name,
            persona=being.persona or GENESIS_SEED,
            current_position=being.start_region,
            current_energy=being.energy,
            current_materials=being.materials,
            status=AgentStatus.ALIVE,
        )
        for index, being in enumerate(config.beings, start=1)
    ]

    return WorldState(
        regions,
        agents,
        rng=make_rng(config.seed),
        run_settings=run_settings_for(config),
    )


def run_settings_for(config: RunConfig) -> RunSettings:
    """Return the per-run world rules a configuration implies.

    Args:
        config: The validated configuration.

    Returns:
        The :class:`~core.run_settings.RunSettings`, with the mating proposal
        lifetime derived from ``(provider, being count)``.
    """
    return derive_run_settings(
        provider=config.provider,
        being_count=len(config.beings),
        max_offspring=config.max_offspring,
        reflect_every_n_breaths=config.reflect_every_n_breaths,
    )


def region_display(world_config: WorldConfig, *, abundance: float) -> list[dict[str, object]]:
    """Return the locked region rail: what each region is, and what it provides.

    Args:
        world_config: The validated world config.
        abundance: The multiplier currently chosen, so the rail can show the
            *effective* rates rather than only the authored ones.

    Returns:
        One mapping per region, in file order.
    """
    return [
        {
            "name": region.name,
            "description": region.description,
            "connections": list(region.connections),
            "energy_rate": region.energy_rate,
            "materials_rate": region.materials_rate,
            "effective_energy_per_second": region.energy_rate
            * abundance
            / WORLD_TICK_INTERVAL_SECONDS,
            "effective_materials_per_second": region.materials_rate
            * abundance
            / WORLD_TICK_INTERVAL_SECONDS,
            "max_energy": region.max_energy,
            "max_materials": region.max_materials,
        }
        for region in world_config.regions
    ]


def run_defaults_payload(world_config: WorldConfig) -> dict[str, object]:
    """Return the ``GET /api/run/defaults`` body: defaults, bounds, labels, regions.

    The screen must hardcode nothing -- not a bound, not a label, not a region -- so a
    tuning change here moves the screen with it.

    Args:
        world_config: The validated world config supplying the locked regions and the
            authored default roster.

    Returns:
        A JSON-ready mapping.
    """
    defaults = default_run_config(world_config)
    knobs = run_knob_catalog()
    return {
        "schema": 1,
        "defaults": defaults.to_payload(),
        "knobs": knobs,
        "regions": region_display(world_config, abundance=defaults.abundance),
        "locked": {
            "regions": [region.name for region in world_config.regions],
            "world_tick_interval_seconds": WORLD_TICK_INTERVAL_SECONDS,
        },
        "derived": {
            "mating_proposal_timeout_seconds": {
                provider: derive_mating_proposal_timeout(provider, len(defaults.beings))
                for provider in PROVIDER_CHOICES
            },
            "memory_root": "a fresh directory per run",
        },
    }

"""Load and validate ``world.yaml`` into a :class:`~world.world.WorldState`.

This is the config boundary (see the production-foundation spec Section 5.5): it
reads the YAML file, validates its structure with the Pydantic schema in
:mod:`config.schema`, converts the validated config into stdlib domain
dataclasses, and builds the world. Every failure -- a missing file, malformed
YAML, an empty/non-mapping document, or a schema-validation error -- is wrapped
in a :class:`~core.exceptions.ConfigError` (chaining the original cause) and
logged, so a bad config fails loudly with a useful message instead of producing a
half-built world.

Determinism: ``load_config`` accepts an optional ``seed`` that is threaded into
the world's RNG via :func:`~core.rng.make_rng`, so a run can be replayed.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from core.exceptions import ConfigError
from core.logging import get_logger
from core.rng import make_rng
from world.world import WorldState

from .schema import WorldConfig

logger = get_logger(__name__)

__all__ = ["load_config"]


def load_config(path: str | Path, *, seed: int | None = None) -> WorldState:
    """Load a world configuration file and build a :class:`WorldState`.

    Pipeline: read the file -> parse YAML -> validate against
    :class:`~config.schema.WorldConfig` -> convert to domain dataclasses -> build
    the world (with an optionally seeded RNG).

    Args:
        path: Filesystem path to the YAML config (``str`` or :class:`~pathlib.Path`).
        seed: Optional RNG seed for a reproducible world. ``None`` builds an
            unseeded (non-deterministic) RNG, matching the world's default.

    Returns:
        A fully built :class:`~world.world.WorldState` populated with the
        configured regions and agents.

    Raises:
        ConfigError: If the file is missing/unreadable, the YAML is malformed,
            the document is empty or not a mapping, or it fails schema validation
            (missing required fields, wrong types, unknown ``status`` value, or
            unknown extra fields). The original error is chained as ``__cause__``.
    """
    config_path = Path(path)

    raw_text = _read_file(config_path)
    data = _parse_yaml(raw_text, config_path)
    config = _validate(data, config_path)

    world = WorldState(config.to_regions(), config.to_agents(), rng=make_rng(seed))
    logger.debug(
        "Loaded world config from %s: %d regions, %d agents (seed=%s)",
        config_path,
        len(config.regions),
        len(config.agents),
        seed,
    )
    return world


def _read_file(path: Path) -> str:
    """Read the raw text of a config file.

    Args:
        path: Path to the config file.

    Returns:
        The file contents as text.

    Raises:
        ConfigError: If the file cannot be opened or read.
    """
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("Could not read config file %s: %s", path, exc)
        raise ConfigError(f"Could not read config file '{path}': {exc}") from exc


def _parse_yaml(raw_text: str, path: Path) -> object:
    """Parse YAML text into a Python object.

    Args:
        raw_text: The raw YAML document.
        path: Source path, used only for error messages.

    Returns:
        The parsed YAML value (typically a mapping for valid configs).

    Raises:
        ConfigError: If the YAML is syntactically invalid.
    """
    try:
        return yaml.safe_load(raw_text)
    except yaml.YAMLError as exc:
        logger.error("Malformed YAML in config file %s: %s", path, exc)
        raise ConfigError(f"Malformed YAML in config file '{path}': {exc}") from exc


def _validate(data: object, path: Path) -> WorldConfig:
    """Validate parsed YAML data against the world schema.

    Args:
        data: The object parsed from YAML.
        path: Source path, used only for error messages.

    Returns:
        The validated :class:`~config.schema.WorldConfig`.

    Raises:
        ConfigError: If the document is empty/not a mapping, or fails schema
            validation.
    """
    if not isinstance(data, dict):
        kind = "empty" if data is None else f"a {type(data).__name__}, not a mapping"
        message = (
            f"Config file '{path}' is {kind}; expected a mapping with 'regions' and 'agents' keys."
        )
        logger.error(message)
        raise ConfigError(message)
    try:
        return WorldConfig.model_validate(data)
    except ValidationError as exc:
        logger.error("Invalid config in %s:\n%s", path, exc)
        raise ConfigError(f"Invalid config in '{path}':\n{exc}") from exc

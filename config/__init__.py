"""Configuration boundary for Vivarium.

Public surface:

* :func:`~config.loader.load_config` -- read, validate and convert ``world.yaml``
  into a :class:`~world.world.WorldState`.
* :class:`~config.schema.WorldConfig` / :class:`~config.schema.RegionConfig` /
  :class:`~config.schema.AgentConfig` -- the Pydantic v2 validation models.
"""

from __future__ import annotations

from .loader import load_config
from .schema import AgentConfig, RegionConfig, WorldConfig

__all__ = ["AgentConfig", "RegionConfig", "WorldConfig", "load_config"]

"""The ``tools`` package: the action layer of Vivarium.

An agent never mutates the world or messages other agents directly. Instead it
selects a *tool*, which the :class:`~tools.registry.ToolRegistry` invokes; the
tool validates, mutates :class:`~world.world.WorldState`, publishes an
:class:`~bus.events.Event`, and returns a natural-language result string for the
agent's LLM. Built-in tools live under :mod:`tools.builtin`.
"""

from __future__ import annotations

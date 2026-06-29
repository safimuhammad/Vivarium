"""Executable entry points for Vivarium runs (the ``press play`` surface).

This package holds the assembled application: :mod:`scripts.run` wires the world,
event bus, tools, decider, and breathing agents into a single runnable
multi-agent simulation with a live ``rich`` activity feed and one shutdown path.
Library packages (``world``/``bus``/``tools``/``agents``/...) stay importable on
their own; only this package depends on all of them at once.
"""

from __future__ import annotations

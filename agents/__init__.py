"""The ``agents`` package: the agent breathing loop and its cognition seam.

Re-exports the public surface so callers (e.g. the Sprint-6 runner) can build a
real agent with one import::

    from agents import Agent, make_default_decider
"""

from __future__ import annotations

from agents.decider import Decider, Decision, OllamaDecider, ToolCall, make_default_decider
from agents.prompt import build_system_prompt
from agents.runtime import Agent

__all__ = [
    "Agent",
    "Decider",
    "Decision",
    "OllamaDecider",
    "ToolCall",
    "build_system_prompt",
    "make_default_decider",
]

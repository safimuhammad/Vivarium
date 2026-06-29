"""The ``recall`` action: an agent-driven search of its own memory overflow.

Unlike the resident memory block (always in context, rebuilt at reflection), the
overflow beyond :data:`~core.constants.MEMORY_RESIDENT_CAP` is reached on demand
through this tool. ``recall`` is offered in the agent's action menu but is *not* a
registry tool: registry tools have the closure signature ``(world, event_bus,
agent_id, **params)`` and no handle to the memory store, so -- exactly like the
reflection tools -- the :class:`~agents.runtime.Agent` owns it and special-cases
it in :meth:`~agents.runtime.Agent.execute`, routing it to
:meth:`~memory.store.MemoryStore.recall`.

This module is pure data/string construction: the Ollama function schema the model
sees and a renderer turning the recalled memories back into an in-world perception
line. It performs no I/O and calls no model (design DD9: no meta/simulation
language reaches the agent).
"""

from __future__ import annotations

from typing import Any

from memory.models import MemoryItem

RECALL_TOOL_NAME: str = "recall"
"""The action name the model emits and the runtime special-cases."""

RECALL_TOOL_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": RECALL_TOOL_NAME,
        "description": (
            "Search your memory for something specific you may have set aside -- a "
            "name, a place, a promise, a past encounter -- and bring it back to mind."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What you are trying to remember.",
                },
            },
            "required": ["query"],
        },
    },
}
"""Ollama function schema for ``recall`` (added to the action menu by the Agent)."""


def render_recall(memories: list[MemoryItem]) -> str:
    """Render the result of a ``recall`` search as an in-world perception line.

    This is the agent-facing voice of a recall: the string fed back to the model as
    the ``tool`` result, in the same living-being register as the rest of perception
    (no meta/simulation language -- design DD9; see also ``CLAUDE.md`` Section 3,
    "tools return natural-language result strings").

    Args:
        memories: The recalled memories, already ordered most-relevant-first by
            :meth:`~memory.store.MemoryStore.recall`. May be empty (nothing matched
            the query, or the agent carries no memory yet).

    Returns:
        A single multi-line string describing what the agent brings back to mind;
        the empty case reads differently from the populated case.
    """
    if not memories:
        return "You search your memory, but nothing surfaces."
    lines = ["You search your memory, and these things return to you:"]
    lines.extend(f"- {memory.content}" for memory in memories)
    return "\n".join(lines)

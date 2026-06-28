"""The reflection step: an isolated turn where an agent records what to carry forward.

The qwen3:8b spike showed a small model will not journal while acting (it always
picks an action), but reflects well when reflection is the *only* thing offered.
So the write path is a dedicated step with ONLY the memory tools and an in-world
"pause and reflect on your life" prompt -- never "manage your memory" (design DD9:
agents stay unaware they are in a simulation).

This module is pure data/string construction; it performs no I/O and calls no
model. The breathing loop (:mod:`agents.runtime`) drives it: it builds the
isolated messages, calls the decider with :data:`REFLECTION_TOOL_SCHEMAS`, and
applies the resulting ``remember`` / ``revise_self`` calls to the memory store.
"""

from __future__ import annotations

from typing import Any

REFLECTION_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "Record a durable, biographically important memory about yourself or "
                "others -- a grudge, a bond, a lesson, a goal -- worth carrying forward "
                "even when it is not relevant right now."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The memory, in your own words.",
                    },
                    "importance": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                        "description": "How significant this is to who you are.",
                    },
                },
                "required": ["content", "importance"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "revise_self",
            "description": "Rewrite your sense of who you are and how you have changed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "identity": {
                        "type": "string",
                        "description": "Your updated self-narrative.",
                    },
                },
                "required": ["identity"],
            },
        },
    },
]
"""Ollama function schemas offered during reflection -- ONLY the memory tools."""

_REFLECTIVE_PROMPT = (
    "Pause and reflect on your life so far. If anything here is worth carrying "
    "forward -- a grudge, a bond, a lesson, a goal -- record it, and update who "
    "you are if you have changed."
)


def render_recap(history: list[dict[str, Any]], turns: int) -> str:
    """Render the last ``turns`` non-system turns of ``history`` as a compact recap.

    Args:
        history: The agent's lifecycle history (system/user/assistant/tool turns).
        turns: How many of the most recent non-system turns to include.

    Returns:
        A newline-joined ``[role] content`` recap, or a neutral fallback sentence
        when there is nothing yet to recap.
    """
    body = [message for message in history if message.get("role") != "system"]
    recent = body[-turns:] if turns > 0 else []
    lines = [
        f"[{message.get('role')}] {str(message.get('content') or '').strip()}"
        for message in recent
    ]
    return "\n".join(lines) if lines else "Nothing of note has happened yet."


def build_reflection_messages(identity: str, recap: str) -> list[dict[str, Any]]:
    """Build the isolated two-turn message list for a reflection call.

    Args:
        identity: The agent's current identity text (system turn).
        recap: The recent-life recap from :func:`render_recap`.

    Returns:
        A ``[system, user]`` message list -- never two consecutive ``user`` turns.
    """
    return [
        {"role": "system", "content": identity},
        {
            "role": "user",
            "content": (
                f"Here is what has recently happened in your life:\n{recap}\n\n"
                f"{_REFLECTIVE_PROMPT}"
            ),
        },
    ]

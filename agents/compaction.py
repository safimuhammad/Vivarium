"""Transcript compaction: keep ``lifecycle_history`` bounded so an agent runs forever.

Sprint 5.1 capped the *memory*; this caps the *working transcript*. The model's
context window counts prompt + generation together, so an unbounded history would
eventually crowd out room to generate and the backend would silently truncate from
the front -- dropping the system prompt / memory block (the agent would lose its
identity). To prevent that, the oldest live turns are folded into a single in-world
"looking back" running recap and the rest dropped, keeping the recent turns verbatim.

This module is pure data/string construction: token estimation and recap-message
construction. It performs no I/O and calls no model. The breathing loop
(:mod:`agents.runtime`) drives it -- it decides *when* to compact (token budget),
evicts turns mechanically, and asks the decider to author the recap text.

The estimator deliberately over-counts (whole-structure JSON length / a low
chars-per-token divisor) so it errs toward compacting early -- the never-overflow
guarantee prefers a wasted compaction to a blown window.
"""

from __future__ import annotations

import json
import math
from typing import Any

from agents.reflection import render_recap
from core import constants

RECAP_ACK: str = "I hold the thread of all this; it is the story of my days."
"""The agent's own (assistant-voice) acknowledgement of its running recap, placed
right after the recap ``user`` turn so the pair never creates two consecutive
``user`` turns."""

_COMPACTION_SYSTEM = (
    "You are remembering your own recent past, holding on to what matters as time moves on."
)

_RECAP_INSTRUCTION = (
    "In your own voice, recount your life so far in a handful of full paragraphs -- the "
    "places you have moved through, the others you have met and how they treated you, what "
    "you have gained and lost, the choices that shaped you, and what you have come to "
    "understand. Be unhurried and concrete: say what happened and why it still matters, so "
    "that none of who you have become is lost."
)
"""The recap-authoring instruction. Asks for a fuller, multi-paragraph memoir (not a
terse line): the recap is the agent's whole long-term self-narrative, resident every
breath, so it should carry people, places, conflicts, and lessons -- not just a vibe.
Length is bounded downstream by ``COMPACTION_RECAP_RESERVE_TOKENS``; this prompt sets
how much the model *chooses* to write within that ceiling. Stays in-world (DD9: no
'summarize'/'compact'/simulation language)."""


def estimate_tokens(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> int:
    """Estimate the prompt token count for ``messages`` + ``tools`` (conservative).

    Counts the FULL serialized structure -- every text-bearing field of every message
    (``content``, ``thinking``, tool-call ``arguments``, tool results, role markers)
    plus the tool schemas -- because all of them reach the real prompt. Whole-struct
    JSON length over a low :data:`~core.constants.CHARS_PER_TOKEN` divisor over-counts
    slightly, which is the safe direction for the never-overflow guarantee.

    Args:
        messages: The chat history whose prompt size to estimate.
        tools: The tool schemas offered alongside (they count toward the prompt too).

    Returns:
        The estimated token count (rounded up).
    """
    chars = len(json.dumps(messages, ensure_ascii=False, default=str))
    chars += len(json.dumps(tools, ensure_ascii=False, default=str))
    return math.ceil(chars / constants.CHARS_PER_TOKEN)


def build_compaction_messages(
    prior_recap: str | None, evicted: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Build the isolated two-turn context for authoring the running recap.

    The agent is asked, in-world (DD9: no "summarize"/"compact"/simulation language),
    to recount its recent past, folding the previous recap (its life so far) together
    with the turns now being evicted. The result becomes the new cumulative recap.

    Args:
        prior_recap: The existing running recap, or ``None``/empty on the first
            compaction (then no "before this" section appears -- never the literal
            ``"None"``).
        evicted: The verbatim turns being folded away (rendered as recent events).

    Returns:
        A ``[system, user]`` message list -- never two consecutive ``user`` turns.
    """
    recent = render_recap(evicted, len(evicted))
    parts: list[str] = []
    if prior_recap and prior_recap.strip():
        parts.append(f"Your life up to now:\n{prior_recap.strip()}\n")
    parts.append(f"More recently:\n{recent}\n")
    parts.append(_RECAP_INSTRUCTION)
    return [
        {"role": "system", "content": _COMPACTION_SYSTEM},
        {"role": "user", "content": "\n".join(parts)},
    ]


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate ``text`` to roughly ``max_tokens`` (keeping the head), or return it as-is.

    The floor-overflow last resort: when even a fully-evicted transcript will not fit,
    the recap (and, ultimately, the in-context memory block) is hard-truncated so the
    prompt is *always* made to fit. Keeps the head and appends an elision marker.

    Args:
        text: The text to bound.
        max_tokens: The token budget for it.

    Returns:
        ``text`` unchanged if already within budget, else its head plus a marker.
    """
    marker = " […]"
    max_chars = int(max_tokens * constants.CHARS_PER_TOKEN)
    if len(text) <= max_chars:
        return text
    head = max(0, max_chars - len(marker))
    return text[:head] + marker

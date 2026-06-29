"""Tests for :mod:`agents.compaction` -- token estimation + recap construction."""

from __future__ import annotations

from typing import Any

from agents.compaction import (
    RECAP_ACK,
    build_compaction_messages,
    estimate_tokens,
    truncate_to_tokens,
)
from core import constants


def _msg(role: str, content: str, **extra: Any) -> dict[str, Any]:
    return {"role": role, "content": content, **extra}


# --- estimate_tokens --------------------------------------------------------


def test_estimate_tokens_is_zero_for_empty() -> None:
    assert estimate_tokens([], []) >= 0
    assert estimate_tokens([], []) < 10  # essentially nothing


def test_estimate_tokens_grows_with_content() -> None:
    small = estimate_tokens([_msg("user", "hi")], [])
    big = estimate_tokens([_msg("user", "word " * 1000)], [])
    assert big > small


def test_estimate_tokens_counts_thinking_field() -> None:
    """An assistant turn's hidden `thinking` MUST be counted (C1) -- it is not in
    `content`, and missing it under-counts ~500-1000 tok/breath -> overflow."""
    without = estimate_tokens([_msg("assistant", "ok")], [])
    with_thinking = estimate_tokens([_msg("assistant", "ok", thinking="x" * 4000)], [])
    assert with_thinking > without + 500  # the 4000 chars of thinking are counted


def test_estimate_tokens_counts_tools() -> None:
    msgs = [_msg("user", "hi")]
    bare = estimate_tokens(msgs, [])
    with_tools = estimate_tokens(msgs, [{"type": "function", "function": {"name": "x" * 4000}}])
    assert with_tools > bare + 500  # tool schemas count toward the real prompt


def test_estimate_tokens_uses_chars_per_token_divisor() -> None:
    # ~ len(json)/CHARS_PER_TOKEN; assert it is in the right ballpark, not exact.
    text = "a" * 3500
    est = estimate_tokens([_msg("user", text)], [])
    assert 3500 / constants.CHARS_PER_TOKEN <= est <= 3500 / constants.CHARS_PER_TOKEN + 50


# --- build_compaction_messages ----------------------------------------------


def test_build_compaction_messages_shape() -> None:
    evicted = [_msg("user", "I walked east"), _msg("assistant", "The grove was quiet")]
    messages = build_compaction_messages(None, evicted)
    assert [m["role"] for m in messages] == ["system", "user"]  # isolated, no two-user
    assert "I walked east" in messages[1]["content"]


def test_build_compaction_messages_none_prior_recap_has_no_literal_none() -> None:
    """First compaction: prior_recap is None -> never the literal 'None' (L1)."""
    messages = build_compaction_messages(None, [_msg("user", "something happened")])
    assert "None" not in messages[1]["content"]


def test_build_compaction_messages_folds_prior_recap() -> None:
    messages = build_compaction_messages("Long ago I left home.", [_msg("user", "now this")])
    assert "Long ago I left home." in messages[1]["content"]  # cumulative recap


def test_build_compaction_messages_has_no_meta_language() -> None:
    messages = build_compaction_messages("prior", [_msg("user", "x")])
    blob = " ".join(m["content"].lower() for m in messages)
    for meta in ("summarize", "summary", "compact", "simulation", "context window", "token"):
        assert meta not in blob  # DD9: the agent stays unaware


# --- truncate_to_tokens -----------------------------------------------------


def test_truncate_to_tokens_under_budget_unchanged() -> None:
    text = "short"
    assert truncate_to_tokens(text, 100) == text


def test_truncate_to_tokens_over_budget_shrinks() -> None:
    text = "x" * 10_000
    out = truncate_to_tokens(text, 10)
    assert len(out) < len(text)
    assert estimate_tokens([_msg("user", out)], []) <= 10 + 20  # within budget + marker slack


# --- RECAP_ACK --------------------------------------------------------------


def test_recap_ack_is_nonempty_in_world() -> None:
    assert RECAP_ACK.strip()
    for meta in ("summary", "compact", "token", "simulation"):
        assert meta not in RECAP_ACK.lower()

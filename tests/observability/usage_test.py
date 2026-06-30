"""Tests for :mod:`observability.usage` -- token-usage records, the JSONL sink,
the per-model price table, and the dollar-cost helper.

Cost is an *operator* concern (not a world event), so usage lives in its own sink
alongside the event log and is never routed to an agent inbox. These tests pin the
record shape, the sink's append behaviour, and the cost formula -- the formula is
asserted against the live price table (not hardcoded rates) so editing a placeholder
price does not break the suite.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from observability.usage import (
    MODEL_PRICES,
    InMemoryUsageLog,
    JsonlUsageLog,
    UsageRecord,
    cost_usd,
)

# ---- cost_usd --------------------------------------------------------------


def test_cost_usd_uses_the_price_table_formula() -> None:
    """Cost is input*in_rate + output*out_rate, per million tokens, from the table."""
    model = "gemini-3.1-flash-lite"
    price = MODEL_PRICES[model]
    expected = price.input_per_1m * 2 + price.output_per_1m * 3  # 2M in, 3M out
    assert cost_usd(model, 2_000_000, 3_000_000) == pytest.approx(expected)


def test_cost_usd_unknown_model_is_zero() -> None:
    """An unpriced model costs 0.0 (rather than raising) so a run never crashes on cost."""
    assert cost_usd("some-unlisted-model", 1_000_000, 1_000_000) == 0.0


def test_cost_usd_local_model_is_free() -> None:
    """A local model in the table is priced at 0.0 (no API spend)."""
    assert cost_usd("qwen3:8b", 5_000_000, 5_000_000) == 0.0


# ---- UsageRecord -----------------------------------------------------------


def test_usage_record_fields() -> None:
    """A usage record carries the fields needed to attribute and price a call."""
    rec = UsageRecord(
        timestamp=1.0,
        agent_id="wanderer_001",
        model="gemini-3.1-flash-lite",
        kind="breath",
        prompt_tokens=100,
        completion_tokens=20,
    )
    assert rec.agent_id == "wanderer_001" and rec.kind == "breath"
    assert rec.prompt_tokens == 100 and rec.completion_tokens == 20


# ---- InMemoryUsageLog ------------------------------------------------------


def test_in_memory_usage_log_collects_records() -> None:
    """The in-memory sink keeps records in call order for inspection in tests."""
    log = InMemoryUsageLog()
    log.record(UsageRecord(1.0, "a", "m", "breath", 10, 1))
    log.record(UsageRecord(2.0, "b", "m", "reflection", 20, 2))
    assert [r.agent_id for r in log.records] == ["a", "b"]


# ---- JsonlUsageLog ---------------------------------------------------------


def test_jsonl_usage_log_appends_one_json_line_per_record(tmp_path: Path) -> None:
    """The durable sink writes one JSON object per line, parents created on construction."""
    path = tmp_path / "nested" / "usage.jsonl"
    log = JsonlUsageLog(path)
    log.record(UsageRecord(1.0, "wanderer_001", "gemini-3.1-flash-lite", "breath", 100, 20))
    log.record(UsageRecord(2.0, "wanderer_002", "gemini-3.1-flash-lite", "reflection", 50, 5))

    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["agent_id"] == "wanderer_001"
    assert first["prompt_tokens"] == 100 and first["completion_tokens"] == 20
    assert first["kind"] == "breath" and first["model"] == "gemini-3.1-flash-lite"

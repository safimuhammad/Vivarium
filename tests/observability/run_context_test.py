"""Tests for live-run metadata exposed by :mod:`observability.run_context`."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from core.constants import (
    HOARDING_ENERGY_THRESHOLD,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_COOLDOWN_SECONDS,
    PARALYSIS_ENERGY_THRESHOLD,
    RUINS_PERSIST_SECONDS,
)
from observability.run_context import build_run_context, frontend_constants


def test_frontend_constants_match_world_rules() -> None:
    constants = frontend_constants()
    assert constants == {
        "paralysis_energy_threshold": PARALYSIS_ENERGY_THRESHOLD,
        "home_build_materials_cost": HOME_BUILD_MATERIALS_COST,
        "home_upkeep_materials_per_second": HOME_UPKEEP_MATERIALS_PER_SECOND,
        "hoarding_energy_threshold": HOARDING_ENERGY_THRESHOLD,
        "hoarding_materials_threshold": HOARDING_MATERIALS_THRESHOLD,
        "mating_cooldown_seconds": MATING_COOLDOWN_SECONDS,
        "ruins_persist_seconds": RUINS_PERSIST_SECONDS,
    }


def test_build_run_context_hashes_config_and_serializes_metadata(tmp_path: Path) -> None:
    config_path = tmp_path / "world.yaml"
    config_text = "regions: []\nagents: []\n"
    config_path.write_text(config_text, encoding="utf-8")
    expected_hash = hashlib.sha256(config_text.encode("utf-8")).hexdigest()

    context = build_run_context(
        config_path=config_path,
        seed=12,
        model="mock-model",
        provider="ollama",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        context_window=10_000,
        clock=lambda: 123.456,
    )

    assert re.fullmatch(
        rf"seed-12-123456-{expected_hash[:8]}-[0-9a-f]{{12}}",
        context.run_id,
    )
    assert context.seed == 12
    assert context.started_at == 123.456
    assert context.config_hash == expected_hash
    assert context.memory_root == tmp_path / "mem"
    expected_run_dir = tmp_path / "runs" / context.run_id
    assert context.run_dir == expected_run_dir
    assert context.event_log_path == expected_run_dir / "events.jsonl"
    assert context.usage_log_path == expected_run_dir / "usage.jsonl"
    assert context.snapshot_log_path == expected_run_dir / "snapshots.jsonl"
    assert context.context_window == 10_000
    assert context.status == "ready"
    assert context.timing == {}

    context.set_timing(
        pace=0.25,
        duration=60.0,
        world_tick_interval=2.0,
        refresh_interval=0.5,
    )
    context.mark_running()
    metadata = context.to_metadata(world_time=9.5, event_cursor=4)
    assert metadata["schema"] == 1
    assert metadata["run_id"] == context.run_id
    assert metadata["seed"] == 12
    assert metadata["status"] == "running"
    assert metadata["event_cursor"] == 4
    assert metadata["world_time"] == 9.5
    assert metadata["config_hash"] == expected_hash
    assert metadata["constants"] == frontend_constants()
    assert metadata["provider"] == "ollama"
    assert metadata["model"] == "mock-model"
    assert metadata["context_window"] == 10_000
    assert metadata["timing"] == {
        "pace": 0.25,
        "duration": 60.0,
        "world_tick_interval": 2.0,
        "refresh_interval": 0.5,
    }
    assert metadata["artifacts"] == {
        "events": str(expected_run_dir / "events.jsonl"),
        "usage": str(expected_run_dir / "usage.jsonl"),
        "snapshots": str(expected_run_dir / "snapshots.jsonl"),
        "memory_root": str(tmp_path / "mem"),
    }

    context.mark_stopped()
    assert context.to_metadata(world_time=9.5, event_cursor=4)["status"] == "stopped"


def test_same_seed_runs_have_isolated_artifact_namespaces(tmp_path: Path) -> None:
    config_path = tmp_path / "world.yaml"
    config_path.write_text("regions: []\nagents: []\n", encoding="utf-8")

    first = build_run_context(
        config_path=config_path,
        seed=7,
        model="mock-model",
        provider="ollama",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=lambda: 100.001,
    )
    second = build_run_context(
        config_path=config_path,
        seed=7,
        model="mock-model",
        provider="ollama",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=lambda: 100.001,
    )

    assert first.run_id != second.run_id
    assert first.run_dir != second.run_dir
    assert first.event_log_path != second.event_log_path
    assert first.snapshot_log_path != second.snapshot_log_path
    assert first.usage_log_path != second.usage_log_path
    assert first.event_log_path.name == second.event_log_path.name == "events.jsonl"
    assert first.snapshot_log_path.name == second.snapshot_log_path.name == "snapshots.jsonl"
    assert first.usage_log_path.name == second.usage_log_path.name == "usage.jsonl"
    assert first.memory_root == second.memory_root == tmp_path / "mem"

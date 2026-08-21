#!/usr/bin/env python3
"""Build or non-destructively check deterministic Mock Chronicle JSON fixtures."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.fixtures.chronicles.producer import build_manifests, render_catalog  # noqa: E402

DEFAULT_OUTPUT = ROOT / "tests/frontend-app/fixtures/chronicles/data"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare expected bytes without creating, rewriting, or deleting any file",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--only",
        type=str,
        default=None,
        help=(
            "comma-separated canonical Chronicle ids (e.g. 'C18') to build in "
            "isolation. Writes/checks only that id's own fixture file plus an "
            "ADDITIVE merge into catalog.json (existing entries for every other "
            "id are read from disk and carried through byte-for-byte-equivalent, "
            "never regenerated) -- the safe path for adding one new Chronicle "
            "without touching any other checked-in fixture."
        ),
    )
    return parser


def _check(output: Path, rendered: dict[str, bytes], *, restrict: bool) -> int:
    """Compare ``rendered`` against ``output`` without writing anything.

    Args:
        output: Directory holding the checked-in fixture files.
        rendered: Canonical filename -> expected bytes for this run.
        restrict: When ``True`` (an ``--only`` build), only the files named in
            ``rendered`` are compared -- files present on disk but absent from
            ``rendered`` (every OTHER Chronicle's fixture) are not drift. When
            ``False`` (a full build), the directory listing and ``rendered`` must
            match exactly, as before.

    Returns:
        ``0`` if current, ``1`` if any rendered file is missing or differs.
    """
    actual_names = {path.name for path in output.glob("*.json")} if output.is_dir() else set()
    expected_names = set(rendered)
    if restrict:
        drift = sorted(expected_names - actual_names)
    else:
        drift = sorted(actual_names ^ expected_names)
    for name in sorted(actual_names & expected_names):
        if (output / name).read_bytes() != rendered[name]:
            drift.append(name)
    if drift:
        print("Mock Chronicle fixture drift: " + ", ".join(sorted(set(drift))), file=sys.stderr)
        return 1
    print(f"Mock Chronicle fixtures are current ({len(rendered)} files).")
    return 0


def _write(output: Path, rendered: dict[str, bytes]) -> int:
    output.mkdir(parents=True, exist_ok=True)
    for name, payload in rendered.items():
        (output / name).write_bytes(payload)
    print(f"Wrote {len(rendered)} deterministic Mock Chronicle fixture files to {output}.")
    return 0


def _merge_catalog_entries(
    existing: dict[str, Any] | None, new_entries: list[dict[str, Any]]
) -> dict[str, Any]:
    """Additively merge ``new_entries`` into an on-disk ``catalog.json`` payload.

    Every entry already present in ``existing`` (keyed by Chronicle id) is carried
    through byte-for-byte-equivalent; only ids present in ``new_entries`` are
    inserted or replaced. This is what makes an ``--only`` build additive rather
    than destructive: C00-C17's catalog rows are read back verbatim, never
    regenerated.

    Args:
        existing: The parsed on-disk ``catalog.json``, or ``None`` if it does not
            yet exist.
        new_entries: Catalog rows for the ids being (re)built this run.

    Returns:
        A full ``{"schema": 1, "chronicles": [...]}`` payload, ids in numeric order.
    """
    by_id: dict[str, dict[str, Any]] = {
        entry["id"]: entry for entry in (existing or {}).get("chronicles", [])
    }
    for entry in new_entries:
        by_id[entry["id"]] = entry
    ordered_ids = sorted(by_id, key=lambda chronicle_id: int(chronicle_id[1:]))
    return {"schema": 1, "chronicles": [by_id[chronicle_id] for chronicle_id in ordered_ids]}


def main() -> int:
    """Build the requested manifests and either check or write their canonical bytes."""
    args = _parser().parse_args()
    only = [chunk.strip() for chunk in args.only.split(",") if chunk.strip()] if args.only else None
    rendered = render_catalog(build_manifests(only=only))
    if only is not None:
        catalog_path = args.output / "catalog.json"
        existing_catalog = json.loads(catalog_path.read_bytes()) if catalog_path.is_file() else None
        new_entries = json.loads(rendered["catalog.json"])["chronicles"]
        merged = _merge_catalog_entries(existing_catalog, new_entries)
        rendered["catalog.json"] = (json.dumps(merged, indent=2, sort_keys=True) + "\n").encode()
    return (
        _check(args.output, rendered, restrict=only is not None)
        if args.check
        else _write(args.output, rendered)
    )


if __name__ == "__main__":
    raise SystemExit(main())

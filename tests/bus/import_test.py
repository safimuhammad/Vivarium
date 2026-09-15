"""Import-order coverage independent of pytest's already-loaded agent runtime."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_event_bus_imports_in_a_clean_interpreter() -> None:
    """A direct bus import must not depend on importing agents first."""
    result = subprocess.run(
        [sys.executable, "-c", "from bus.event_bus import EventBus; assert EventBus"],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr

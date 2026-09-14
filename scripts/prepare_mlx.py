"""Download the local Qwen checkpoint without starting inference or a world.

This explicit preparation step is the only MLX path that accesses the model hub.
The live decider loads an existing local snapshot and never downloads a model or
falls back to a hosted provider.
"""

from __future__ import annotations

import argparse
import platform
from pathlib import Path

from scripts.run import DEFAULT_MLX_MODEL


def main() -> None:
    """Prepare a public MLX checkpoint in the standard Hugging Face cache."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", default=DEFAULT_MLX_MODEL, help="Public MLX checkpoint to download."
    )
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("MLX inference requires an Apple-Silicon Mac.")

    from huggingface_hub import snapshot_download

    snapshot = Path(
        snapshot_download(
            repo_id=args.model,
            token=False,
        )
    )
    print(f"Prepared {args.model}")
    print(f"Local snapshot: {snapshot}")
    print("No model inference or simulation was started. Vivarium can now load this model offline.")


if __name__ == "__main__":
    main()

"""Token-usage observability: per-decision usage records, a JSONL sink, and cost.

Token cost is an **operator** concern, not part of the world the agents inhabit, so
it deliberately lives *outside* the :class:`~bus.event_bus.EventBus`: usage is never
wrapped in an :class:`~bus.events.Event` or routed to an agent inbox (that would break
the "agents are unaware they are in a simulation" premise). Instead the breathing loop
records a :class:`UsageRecord` per decision into one of these sinks -- a sibling of the
event log -- and a post-hoc reader (e.g. the chronicle) sums and prices them.

This module defines:

* :class:`UsageRecord` -- one decision's token usage (input + output), attributed to an
  agent, a model, and a kind (``breath`` / ``reflection``).
* :class:`UsageLog` -- the structural protocol a sink satisfies.
* :class:`InMemoryUsageLog` -- a list-backed sink for tests/inspection.
* :class:`JsonlUsageLog` -- an append-only JSON-Lines sink (one record per line).
* :class:`ModelPrice` / :data:`MODEL_PRICES` -- a per-model price table (USD per 1M
  tokens, input and output priced separately).
* :func:`cost_usd` -- price a token count for a model (unknown/local models cost 0).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class UsageRecord:
    """One decision's token usage, ready to attribute and price.

    Attributes:
        timestamp: World-clock time (seconds) the decision completed.
        agent_id: Id of the agent whose breath/reflection made the call.
        model: Model name that served the call (keys :data:`MODEL_PRICES`).
        kind: ``"breath"`` (a main decision) or ``"reflection"`` (the memory step).
        prompt_tokens: Input tokens billed for this call.
        completion_tokens: Output (generated) tokens billed for this call.
    """

    timestamp: float
    agent_id: str
    model: str
    kind: str
    prompt_tokens: int
    completion_tokens: int


class UsageLog(Protocol):
    """Structural protocol for an append-only token-usage sink."""

    def record(self, usage: UsageRecord) -> None:
        """Append ``usage`` to the log.

        Args:
            usage: The usage record to append.
        """
        ...


class InMemoryUsageLog:
    """A :class:`UsageLog` that keeps records in a list (for tests/inspection)."""

    def __init__(self) -> None:
        """Initialise an empty in-memory usage log."""
        self._records: list[UsageRecord] = []

    def record(self, usage: UsageRecord) -> None:
        """Append ``usage`` to the in-memory list, preserving call order.

        Args:
            usage: The usage record to append.
        """
        self._records.append(usage)

    @property
    def records(self) -> list[UsageRecord]:
        """Return the recorded usage, oldest first (a shallow copy)."""
        return list(self._records)


class JsonlUsageLog:
    """A :class:`UsageLog` that appends one JSON object per line to a file.

    Mirrors :class:`~observability.event_log.JsonlEventLog`: the parent directory is
    created on construction, and each :meth:`record` opens the file, appends a single
    line, and closes it (so a crash loses at most the final partial line).

    Attributes:
        path: Filesystem path of the JSONL file being written.
    """

    def __init__(self, path: str | Path) -> None:
        """Initialise the sink, ensuring the parent directory exists.

        Args:
            path: Destination file path; its parent directory is created if missing.

        Side effects:
            Creates the parent directory of ``path`` if it does not exist.
        """
        self.path: Path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, usage: UsageRecord) -> None:
        """Append ``usage`` to the file as a single JSON line.

        Args:
            usage: The usage record to serialise and append.

        Side effects:
            Appends one newline-terminated JSON line to the file at :attr:`path`.
        """
        line = json.dumps(asdict(usage), default=str)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(f"{line}\n")


@dataclass(frozen=True, slots=True)
class ModelPrice:
    """USD price per 1,000,000 tokens for a model (input and output priced apart).

    Attributes:
        input_per_1m: USD per 1M input (prompt) tokens.
        output_per_1m: USD per 1M output (completion) tokens.
    """

    input_per_1m: float
    output_per_1m: float


#: Per-model price table (USD per 1M tokens). **Placeholder rates -- edit to match the
#: provider's current pricing.** Local models (served by Ollama) cost nothing. A model
#: absent from this table is treated as free by :func:`cost_usd` (so a new/unpriced
#: model never crashes a run; add it here to start counting its cost).
MODEL_PRICES: dict[str, ModelPrice] = {
    # Hosted (Google Gen AI). TODO: confirm against current Gemini pricing.
    "gemini-3.1-flash-lite": ModelPrice(input_per_1m=0.10, output_per_1m=0.40),
    # Local (Ollama) -- no API spend.
    "qwen3:8b": ModelPrice(input_per_1m=0.0, output_per_1m=0.0),
}


def cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Return the USD cost of a token count for ``model`` (0.0 if unpriced/local).

    Args:
        model: Model name to price (looked up in :data:`MODEL_PRICES`).
        prompt_tokens: Input tokens to charge at the model's input rate.
        completion_tokens: Output tokens to charge at the model's output rate.

    Returns:
        The cost in USD; ``0.0`` for a local model (rate 0) or one absent from the
        price table.
    """
    price = MODEL_PRICES.get(model)
    if price is None:
        return 0.0
    return (
        prompt_tokens / 1_000_000 * price.input_per_1m
        + completion_tokens / 1_000_000 * price.output_per_1m
    )

"""Render a run's append-only event log into a human-readable narrative chronicle.

Perception is the product (``CLAUDE.md`` Section 1): a run is experienced by *reading*
what unfolded. This tool turns a ``run_<seed>.jsonl`` event log into a Markdown
"chronicle" -- a chronological story of who woke, who they chose to become, who moved
where, who spoke, shared, starved, revived, mated, was born, fought, and fell -- plus a
token-cost ledger read from the sibling ``usage_<seed>.jsonl``.

It is a pure projection of the log (no re-simulation): the live world is mutated in
place, but the ordered event stream is enough to reconstruct the tale. Region context is
*replayed* (events do not all carry a region), and each being's self-authored identity is
read from ``<run_dir>/memory/<id>/identity.md`` so the cast reflects who they *became*,
not any seed.

Usage::

    python scripts/chronicle.py <run_dir>/run_<seed>.jsonl <out>.md
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from observability.usage import cost_usd

#: Founder id -> display name (the four starting beings from ``config/world.yaml``).
FOUNDER_NAMES: dict[str, str] = {
    "wanderer_001": "Joe",
    "wanderer_002": "Mae",
    "wanderer_003": "Dick",
    "wanderer_004": "Allen",
}
#: Founder id -> the region it wakes in.
FOUNDER_START: dict[str, str] = {
    "wanderer_001": "warm_springs",
    "wanderer_002": "warm_springs",
    "wanderer_003": "nirvana",
    "wanderer_004": "nirvana",
}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    """Return the JSON objects on each non-blank line of ``path`` (empty if missing)."""
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _message(row: dict[str, Any]) -> str:
    """Return an event's ``payload.message`` (empty string if absent)."""
    return (row.get("payload") or {}).get("message", "") or ""


def _build_names(rows: list[dict[str, Any]]) -> dict[str, str]:
    """Map agent id -> name: founders plus offspring parsed from their birth events."""
    names = dict(FOUNDER_NAMES)
    for row in rows:
        if row["type"] == "agent_born":
            match = re.search(r"Agent ID:([^|]+)\|Agent Name:([^,]+)", _message(row))
            if match:
                names[match.group(1).strip()] = match.group(2).strip()
    return names


def _load_identities(run_path: Path) -> dict[str, str]:
    """Map agent id -> self-authored identity text from ``memory/<id>/identity.md``.

    This is the truth of the cast -- who each being made of itself -- not any seed.
    """
    identities: dict[str, str] = {}
    mem_dir = run_path.parent / "memory"
    if not mem_dir.is_dir():
        return identities
    for agent_dir in mem_dir.iterdir():
        identity_file = agent_dir / "identity.md"
        if identity_file.exists() and (text := identity_file.read_text(encoding="utf-8").strip()):
            identities[agent_dir.name] = " ".join(text.split())
    return identities


class Chronicle:
    """Accumulates the chronicle as it replays the event log once, in order.

    Replays each being's region into :attr:`pos` so every beat can be tagged with where
    it happened (the event stream alone does not carry region on every event).

    Attributes:
        rows: The ordered event log.
        names: Agent id -> display name.
        identities: Agent id -> self-authored identity text.
        usage: The token-usage records (sibling ``usage_*.jsonl``).
        pos: Agent id -> current region, updated as the log is replayed.
        lines: The accumulating Markdown output lines.
    """

    def __init__(self, run_path: Path) -> None:
        """Load the log, names, identities, and usage for the run at ``run_path``."""
        self.rows = _load_jsonl(run_path)
        if not self.rows:
            raise ValueError(f"no events in {run_path}")
        self.t0: float = self.rows[0]["timestamp"]
        self.names = _build_names(self.rows)
        self.identities = _load_identities(run_path)
        self.usage: list[dict[str, Any]] = []
        for usage_file in sorted(run_path.parent.glob("usage_*.jsonl")):
            self.usage += _load_jsonl(usage_file)
        self.pos: dict[str, str | None] = dict(FOUNDER_START)
        self.lines: list[str] = []

    # ---- small helpers ----------------------------------------------------

    def who(self, agent_id: str) -> str:
        """Display name for an id (falls back to the raw id)."""
        return self.names.get(agent_id, agent_id)

    def clock(self, timestamp: float) -> str:
        """``MM:SS`` elapsed since the run started."""
        seconds = int(timestamp - self.t0)
        return f"{seconds // 60:02d}:{seconds % 60:02d}"

    def where(self, agent_id: str) -> str:
        """Current (replayed) region of an agent, or ``?`` if unknown/departed."""
        return self.pos.get(agent_id) or "?"

    def w(self, line: str = "") -> None:
        """Append one output line."""
        self.lines.append(line)

    # ---- sections ---------------------------------------------------------

    def render(self) -> str:
        """Render the whole chronicle and return it as a single string."""
        self._header()
        self._cast()
        self.w("---")
        self.w()
        self.w("## The journey")
        self.w()
        for row in self.rows:
            self._beat(row)
        self._ledger()
        self._ending()
        return "\n".join(self.lines) + "\n"

    def _header(self) -> None:
        counts = Counter(row["type"] for row in self.rows)
        elapsed = int(self.rows[-1]["timestamp"] - self.t0)
        self.w("# Vivarium — Chronicle of a Gemini Run")
        self.w()
        self.w(
            "> An unscripted run of the world. Beings were placed in it, the rules were "
            "set, and play was pressed. No goals, no script — only what unfolded."
        )
        self.w()
        self.w("**Mind:** `gemini-3.1-flash-lite` (hosted, agents breathing concurrently)  ")
        self.w(
            f"**Observed:** {elapsed // 60}m {elapsed % 60}s · **Events:** {len(self.rows)} · "
            f"**Born:** {counts.get('agent_born', 0)} · **Slain:** {counts.get('agent_died', 0)}"
        )
        self.w()
        self.w(
            "**How to read the places:** every beat is tagged `[region]`. Perception is "
            "local — a being sees a fight, a death, or hears speech *only in its own "
            "region*; one who is away learns of a death only by returning to find the "
            "body. The 🚶 lines follow who is where; ⚡/🪨 lines show who draws energy and "
            "materials from which land."
        )
        self.w()

    def _cast(self) -> None:
        self.w("## The cast")
        self.w()
        self.w(
            "No personalities were authored for these beings — each woke from the same "
            "neutral genesis seed and *chose* who to become. Below is who each one made of "
            "itself, in its own words (its self-authored identity), or how it began if it "
            "had not yet found them."
        )
        self.w()
        offspring = [r["source"] for r in self.rows if r["type"] == "agent_born"]
        for agent_id in list(FOUNDER_START) + offspring:
            origin = (
                f"woke in {FOUNDER_START[agent_id]}"
                if agent_id in FOUNDER_START
                else "born into the world"
            )
            if identity := self.identities.get(agent_id):
                self.w(
                    f"- **{self.who(agent_id)}** *({origin})* — in their own words: *“{identity}”*"
                )
            else:
                self.w(
                    f"- **{self.who(agent_id)}** *({origin})* — had not yet put words to "
                    "who they are."
                )
            self.w()

    def _beat(self, row: dict[str, Any]) -> None:
        kind = row["type"]
        timestamp = self.clock(row["timestamp"])
        source = row["source"]
        match kind:
            case "simulation_started":
                self.w(f"`{timestamp}` — **The world wakes.**")
                self.w()
            case "agent_entered_region":
                dest = re.search(r"entered the region (\w+)", _message(row))
                origin = re.search(r"Migrated from (\w+)", _message(row))
                destination = dest.group(1) if dest else "?"
                came_from = origin.group(1) if origin else self.where(source)
                self.pos[source] = destination
                self.w(
                    f"`{timestamp}` — 🚶 **{self.who(source)}** moves from *{came_from}* "
                    f"to *{destination}*."
                )
                self.w()
            case "agent_left_region":
                return  # the paired "entered" beat already records the move
            case "resource_changed":
                self._harvest_beat(timestamp, source, row)
            case "agent_started_hoarding":
                place = row.get("region") or self.where(source)
                self.w(
                    f"`{timestamp}` — 💰 **{self.who(source)}** begins to hoard *[{place}]* "
                    "— a growing store others can now see."
                )
                self.w()
            case "agent_paralyzed":
                match = re.match(r"(\S+) has collapsed", _message(row))
                name = match.group(1) if match else "Someone"
                place = row.get("region") or "?"
                self.w(
                    f"`{timestamp}` — 💫 **{name}** collapses, starved — too weak to "
                    f"move *[{place}]*."
                )
                self.w()
            case "agent_recovered":
                place = self.where(source)
                self.w(
                    f"`{timestamp}` — 🤝 **{self.who(source)}** revives "
                    f"**{self.who(row.get('target', ''))}** *[{place}]* — sharing energy to "
                    "bring the fallen back from the edge."
                )
                self.w()
            case "resource_transferred":
                place = self.where(source)
                self.w(
                    f"`{timestamp}` — 🎁 **{self.who(source)}** shares resources with "
                    f"**{self.who(row.get('target', ''))}** *[{place}]*."
                )
                self.w()
            case "speak":
                self._speak_beat(timestamp, source, row)
            case "mating_initiated":
                place = self.where(source)
                self.w(
                    f"`{timestamp}` — 💞 **{self.who(source)}** offers a child to "
                    f"**{self.who(row.get('target', ''))}** *[{place}]*:"
                )
                self.w(f"> {_message(row)}")
                self.w()
            case "mating_rejected":
                offerer = row.get("target")
                suffix = f" from **{self.who(offerer)}**" if offerer else ""
                self.w(
                    f"`{timestamp}` — 💔 **{self.who(source)}** turns down a mating offer"
                    f"{suffix} *[{self.where(source)}]*."
                )
                self.w()
            case "agent_born":
                parent = re.search(r"Mated by Agent ID:(\w+)", _message(row))
                region = self.pos.get(parent.group(1), "warm_springs") if parent else "warm_springs"
                self.pos[source] = region
                self.w(f"`{timestamp}` — 🌱 **A child is born: {self.who(source)}** *[{region}]*.")
                self.w()
            case "attack":
                self._attack_beat(timestamp, source, row)
            case "agent_died":
                self._death_beat(timestamp, source, row)

    def _harvest_beat(self, timestamp: str, source: str, row: dict[str, Any]) -> None:
        match = re.search(
            r"Harvested ([0-9.]+) of ResourceTypes\.(\w+) from Region (\w+)", _message(row)
        )
        if not match:
            return
        kind = match.group(2).lower()
        icon = "⚡" if kind == "energy" else "🪨"
        self.w(
            f"`{timestamp}` — {icon} **{self.who(source)}** draws {float(match.group(1)):.0f} "
            f"{kind} from the land of *{match.group(3)}*."
        )
        self.w()

    def _speak_beat(self, timestamp: str, source: str, row: dict[str, Any]) -> None:
        target = row.get("target")
        place = self.where(source)
        if row.get("scope") == "targeted" and target:
            self.w(
                f"`{timestamp}` — **{self.who(source)}** whispers to "
                f"**{self.who(target)}** *[{place}]*:"
            )
        else:
            self.w(f"`{timestamp}` — **{self.who(source)}** speaks aloud *[{place}]*:")
        self.w(f"> {_message(row)}")
        self.w()

    def _attack_beat(self, timestamp: str, source: str, row: dict[str, Any]) -> None:
        remaining = re.search(r"Energy Remaining:([0-9.]+)", _message(row))
        victim = self.who(row["target"]) if row.get("target") else "someone"
        place = self.where(source)
        tail = f" — {victim} left with {remaining.group(1)} energy" if remaining else ""
        self.w(f"`{timestamp}` — ⚔️ **{self.who(source)}** strikes **{victim}** *[{place}]*{tail}.")
        self.w()

    def _death_beat(self, timestamp: str, source: str, row: dict[str, Any]) -> None:
        payload = row.get("payload") or {}
        killer = self.who(payload.get("killer", ""))
        place = self.where(source)
        self.pos[source] = None
        looted_energy, looted_materials = (
            payload.get("looted_energy"),
            payload.get("looted_materials"),
        )
        loot = ""
        if looted_energy or looted_materials:
            loot = (
                f" **{killer}** takes {looted_energy or 0:.0f} energy and "
                f"{looted_materials or 0:.0f} materials as loot."
            )
        self.w(
            f"`{timestamp}` — †  **{self.who(source)} was slain by {killer}** *[{place}]* "
            f"— perceived by those present.{loot}"
        )
        self.w()

    def _ledger(self) -> None:
        self.w("---")
        self.w()
        self.w("## The ledger — what the thinking cost")
        self.w()
        if not self.usage:
            self.w(
                "*No token-usage record for this run (it predates cost tracking). Future "
                "runs write a `usage_<seed>.jsonl` the ledger reads to total tokens and "
                "estimate the spend.*"
            )
            self.w()
            return
        per_agent: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        total_in = total_out = 0
        total_cost = 0.0
        for record in self.usage:
            name = self.who(record["agent_id"])
            per_agent[name][0] += record["prompt_tokens"]
            per_agent[name][1] += record["completion_tokens"]
            total_in += record["prompt_tokens"]
            total_out += record["completion_tokens"]
            total_cost += cost_usd(
                record["model"], record["prompt_tokens"], record["completion_tokens"]
            )
        model = self.usage[0]["model"]
        self.w(
            f"**{total_in + total_out:,} tokens** across {len(self.usage):,} decisions "
            f"({total_in:,} in / {total_out:,} out) on `{model}` — **est. ${total_cost:,.4f}**."
        )
        self.w()
        self.w("| Being | Tokens in | Tokens out | Est. $ |")
        self.w("|---|--:|--:|--:|")
        for name, (tin, tout) in sorted(per_agent.items(), key=lambda kv: -(kv[1][0] + kv[1][1])):
            self.w(f"| {name} | {tin:,} | {tout:,} | ${cost_usd(model, tin, tout):,.4f} |")
        self.w()
        self.w(
            "*Prices are the placeholder rates in `observability/usage.py` — edit them to "
            "match current provider pricing; the figure rescales automatically.*"
        )
        self.w()

    def _ending(self) -> None:
        counts = Counter(row["type"] for row in self.rows)
        births, deaths = counts.get("agent_born", 0), counts.get("agent_died", 0)
        offspring = {r["source"] for r in self.rows if r["type"] == "agent_born"}
        all_ids = set(FOUNDER_START) | offspring
        dead_ids = {r["source"] for r in self.rows if r["type"] == "agent_died"}
        survivors = sorted(all_ids - dead_ids, key=self.who)
        self.w("---")
        self.w()
        self.w("## How it ended")
        self.w()
        self.w(
            f"- **Beings that ever lived:** {len(all_ids)} "
            f"({len(FOUNDER_START)} founders + {births} born)"
        )
        slain = ", ".join(sorted(self.who(i) for i in dead_ids))
        self.w(f"- **Slain:** {len(dead_ids)}" + (f" — {slain}" if dead_ids else " — none fell"))
        living = ", ".join(self.who(i) for i in survivors) or "no one"
        self.w(f"- **Left breathing at the end:** {len(survivors)} — {living}")
        self.w()
        if len(survivors) <= 1:
            self.w(
                "The world fell toward **collapse**: a near-extinction. A living world, "
                "briefly — then quiet."
            )
        elif deaths == 0 and births > 0:
            self.w(
                f"The world **held**: not a single being fell, and {births} new "
                f"{'lives were' if births != 1 else 'life was'} brought into it. A growing, "
                "living thing — neither collapsing into death nor (yet) exploding."
            )
        self.w()
        self.w(
            "*Generated from the run's append-only event log. Every word spoken, every "
            "move, every harvest, every birth, and every death is here, tagged with the "
            "region where it happened.*"
        )


def main() -> None:
    """CLI entry: read a run's event log and write its Markdown chronicle."""
    parser = argparse.ArgumentParser(description="Render a run's event log into a chronicle.")
    parser.add_argument("run_log", type=Path, help="Path to run_<seed>.jsonl")
    parser.add_argument("out", type=Path, help="Path to write the Markdown chronicle")
    args = parser.parse_args()
    chronicle = Chronicle(args.run_log).render()
    args.out.write_text(chronicle, encoding="utf-8")
    print(f"wrote {args.out} ({chronicle.count(chr(10))} lines)")


if __name__ == "__main__":
    main()

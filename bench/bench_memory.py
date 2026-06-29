"""End-to-end memory-performance benchmark for the Sprint-5 memory subsystem.

Measures what memory *costs* and how well it *retrieves*, so the optimization pass
(plan Task 13) has hard numbers to tune the ``core.constants`` dials against:

  1. append latency        -- ms per append_memory vs store size N
  2. retrieve latency      -- ms per retrieve(k) vs N  (the per-breath memory tax)
  3. scorer pure cost      -- us per score_memories vs N (ranking isolated from I/O)
  4. embedding latency     -- ms per embed at batch 1/8/32 (MiniLM, real backend)
  5. footprint             -- jsonl bytes/memory, chroma dir bytes, process RSS
  6. retrieval quality     -- does the salience scorer surface a high-importance
                              grudge that pure relevance / pure recency miss?
  7. resident-block build  -- ms per resident_block under vs over the cap (the
                              per-breath retrieval cost; ~free under cap)  [5.1]
  8. recall latency/quality-- ms per recall(query) vs N, and whether recall surfaces
                              a planted overflow memory by exact text / paraphrase  [5.1]
  9. overflow correctness  -- HIGH always resident, block size == cap, a dropped
                              low-importance memory still reachable via recall  [5.1]

Run (deterministic machinery, fast):   python -m bench.bench_memory --backend fake
Run (real MiniLM + Chroma, realistic): python -m bench.bench_memory --backend chroma
Larger:                                python -m bench.bench_memory --scale 10000

The ``chroma`` backend downloads all-MiniLM-L6-v2 (~80MB) on first use. This is a
script, so console output via print is intentional (bench/ is excluded from the
library no-print rule and from coverage).
"""

from __future__ import annotations

import argparse
import shutil
import statistics
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from resource import RUSAGE_SELF, getrusage

from core import constants
from memory.embedding import EmbeddingFunction, FakeEmbeddingFunction, default_embedding_function
from memory.models import Importance, MemoryItem
from memory.scoring import score_memories
from memory.store import FileMemoryStore
from memory.vector_store import ChromaVectorStore, FakeVectorStore, VectorStore

DEFAULT_SCALES: tuple[int, ...] = (100, 1000)
RETRIEVE_SAMPLES: int = 25
TOPICS: int = 17


@dataclass
class Section:
    """One benchmark section's rendered table (title + markdown lines)."""

    title: str
    lines: list[str] = field(default_factory=list)


def _rss_mb() -> float:
    """Return peak resident set size in MiB (ru_maxrss is bytes on macOS, KiB on Linux)."""
    raw = getrusage(RUSAGE_SELF).ru_maxrss
    return raw / (1024 * 1024) if sys.platform == "darwin" else raw / 1024


def _dir_size(path: Path) -> int:
    """Return total bytes of all files under ``path`` (0 if absent)."""
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _ms(seconds: float) -> float:
    return seconds * 1000.0


def _make_backend(backend: str, root: Path) -> tuple[VectorStore, EmbeddingFunction]:
    """Build a (vector_store, embedding_function) pair for the chosen backend."""
    if backend == "chroma":
        embedder = default_embedding_function()
        store: VectorStore = ChromaVectorStore("bench", embedder, path=root / "chroma")
        return store, embedder
    embedder = FakeEmbeddingFunction()
    return FakeVectorStore(embedder), embedder


def _make_store(backend: str, root: Path) -> FileMemoryStore:
    vector_store, _ = _make_backend(backend, root)
    return FileMemoryStore(
        "bench_agent",
        root,
        persona="A benchmark wanderer.",
        vector_store=vector_store,
        clock=lambda: 0.0,
    )


def _content(i: int) -> str:
    return f"On day {i} I reflected on topic {i % TOPICS}: trust, food, and the road ahead."


def bench_latency_and_footprint(backend: str, scales: tuple[int, ...]) -> Section:
    """Measure append/retrieve latency and footprint at each scale (one fresh store each)."""
    section = Section(f"Latency & footprint -- backend=`{backend}`")
    section.lines.append(
        "| N | append ms (median/p95) | retrieve ms (median/p95) "
        "| jsonl B/mem | chroma dir KiB | RSS MiB |"
    )
    section.lines.append("|--:|--:|--:|--:|--:|--:|")
    for n in scales:
        root = Path(tempfile.mkdtemp(prefix="vivbench_"))
        try:
            store = _make_store(backend, root)
            store.append_memory("warmup -- loads the model outside timing", Importance.LOW, 0)

            appends = []
            for i in range(n):
                start = time.perf_counter()
                store.append_memory(_content(i), Importance.MEDIUM, i)
                appends.append(_ms(time.perf_counter() - start))

            retrieves = []
            for q in range(RETRIEVE_SAMPLES):
                start = time.perf_counter()
                store.retrieve(f"thoughts on topic {q % TOPICS}", n, constants.RETRIEVAL_K)
                retrieves.append(_ms(time.perf_counter() - start))

            jsonl_bytes = (root / "bench_agent" / "memory.jsonl").stat().st_size
            chroma_kib = _dir_size(root / "chroma") // 1024
            section.lines.append(
                f"| {n} | {_p(appends)} | {_p(retrieves)} "
                f"| {jsonl_bytes // max(1, n)} | {chroma_kib} | {_rss_mb():.0f} |"
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)
    return section


def bench_scorer_pure(scales: tuple[int, ...]) -> Section:
    """Measure the pure scorer cost (no I/O) at each scale."""
    section = Section("Scorer pure cost (no I/O)")
    section.lines.append("| N | score_memories us (median) |")
    section.lines.append("|--:|--:|")
    for n in scales:
        items = [MemoryItem(f"a-{i}", _content(i), Importance.MEDIUM, i, 0.0) for i in range(n)]
        distances = {item.id: (i % 10) / 10.0 for i, item in enumerate(items)}
        timings = []
        for _ in range(50):
            start = time.perf_counter()
            score_memories(
                items,
                distances,
                n,
                constants.RETRIEVAL_K,
                w_recency=constants.W_RECENCY,
                w_importance=constants.W_IMPORTANCE,
                w_relevance=constants.W_RELEVANCE,
                recency_decay=constants.RECENCY_DECAY,
                importance_weights=constants.IMPORTANCE_WEIGHTS,
            )
            timings.append((time.perf_counter() - start) * 1_000_000)
        section.lines.append(f"| {n} | {statistics.median(timings):.0f} |")
    return section


def bench_embedding(backend: str) -> Section:
    """Measure embedding latency at batch sizes 1, 8, 32 for the chosen backend."""
    section = Section(f"Embedding latency -- backend=`{backend}`")
    section.lines.append("| batch | ms total | ms/item |")
    section.lines.append("|--:|--:|--:|")
    root = Path(tempfile.mkdtemp(prefix="vivbench_ef_"))
    try:
        _, embedder = _make_backend(backend, root)
        embedder(["warmup"])  # load model outside timing
        for batch in (1, 8, 32):
            texts = [f"a sentence about topic {i}" for i in range(batch)]
            timings = []
            for _ in range(10):
                start = time.perf_counter()
                embedder(texts)
                timings.append(_ms(time.perf_counter() - start))
            total = statistics.median(timings)
            section.lines.append(f"| {batch} | {total:.2f} | {total / batch:.2f} |")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return section


def bench_restart(scales: tuple[int, ...]) -> Section:
    """Measure warm-reopen time (vectors already persisted) vs the re-embed it avoids.

    The "run forever / crash recovery" path: reopening a populated persistent store
    must not re-embed every memory. We time the reopen and contrast it with the
    embedding work it skips (~N single embeds).
    """
    section = Section("Restart cost (backend=`chroma`): warm reopen skips re-embedding")
    section.lines.append("| N | warm reopen ms | re-embed avoided ms (~N x single-embed) |")
    section.lines.append("|--:|--:|--:|")
    single_embed = _single_embed_ms()
    for n in scales:
        root = Path(tempfile.mkdtemp(prefix="vivbench_restart_"))
        try:
            store = _make_store("chroma", root)
            for i in range(n):
                store.append_memory(_content(i), Importance.MEDIUM, i)
            start = time.perf_counter()
            _make_store("chroma", root)  # reopen same path -> vectors present -> skip
            warm = _ms(time.perf_counter() - start)
            section.lines.append(f"| {n} | {warm:.1f} | {n * single_embed:.0f} |")
        finally:
            shutil.rmtree(root, ignore_errors=True)
    return section


def _single_embed_ms() -> float:
    """Median ms for one real single-text embed (used to estimate avoided work)."""
    root = Path(tempfile.mkdtemp(prefix="vivbench_se_"))
    try:
        _, embedder = _make_backend("chroma", root)
        embedder(["warmup"])
        timings = [
            _ms(_timed(lambda: embedder(["a sentence about the road and trust"]))) for _ in range(5)
        ]
        return statistics.median(timings)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _timed(fn: Callable[[], object]) -> float:
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def bench_quality(backend: str) -> Section:
    """Compare the full scorer vs relevance-only vs recency-only on the grudge case.

    A high-importance grudge that is *not* lexically similar to the current moment
    should still surface; pure relevance (RAG) misses it. We report whether the
    grudge lands in the top-k for each ranker.
    """
    section = Section(f"Retrieval quality -- the grudge case -- backend=`{backend}`")
    root = Path(tempfile.mkdtemp(prefix="vivbench_q_"))
    try:
        store = _make_store(backend, root)
        gold = "Kai attacked me without warning and stole everything I had."
        store.append_memory(gold, Importance.HIGH, 0)  # old + important, dissimilar to query
        for i in range(8):  # recent, similar-ish chitchat, low importance
            store.append_memory(
                f"We chatted about sharing food and travelling together, day {i + 1}.",
                Importance.LOW,
                i + 1,
            )
        query = "Kai offers to share food and travel together right now."
        current = 12

        full = _ids(store.retrieve(query, current, constants.RETRIEVAL_K))
        rel = _ids(_retrieve_relevance_only(store, query))
        rec = _ids(_retrieve_recency_only(store))

        def hit(ids: list[str]) -> str:
            return "yes" if any(i.endswith("-0") for i in ids) else "no"

        section.lines.append("| ranker | grudge in top-k? |")
        section.lines.append("|--|--|")
        section.lines.append(f"| full (recency x importance x relevance) | {hit(full)} |")
        section.lines.append(f"| relevance-only (pure RAG) | {hit(rel)} |")
        section.lines.append(f"| recency-only | {hit(rec)} |")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return section


def bench_resident_block(backend: str, scales: tuple[int, ...]) -> Section:
    """Measure resident_block build latency under vs over the cap (Sprint 5.1).

    The whole point of the resident block: under the cap it returns the entire
    memory with NO embedding (near-free per breath), and only pays the query-embed +
    distance scan once memory overflows the cap. This section makes that contrast
    visible -- the cheap regime is what lets memory stay resident every breath.
    """
    cap = constants.MEMORY_RESIDENT_CAP
    section = Section(f"Resident-block build latency (retrieval) -- backend=`{backend}`, cap={cap}")
    section.lines.append("| N | regime | resident_block ms (median/p95) | block size |")
    section.lines.append("|--:|--|--:|--:|")
    for n in scales:
        root = Path(tempfile.mkdtemp(prefix="vivbench_rb_"))
        try:
            store = _make_store(backend, root)
            store.append_memory("warmup -- loads the model outside timing", Importance.LOW, 0)
            for i in range(n):
                store.append_memory(_content(i), Importance.MEDIUM, i)
            timings = []
            block: list[MemoryItem] = []
            for q in range(RETRIEVE_SAMPLES):
                start = time.perf_counter()
                block = store.resident_block(f"thoughts on topic {q % TOPICS}", n)
                timings.append(_ms(time.perf_counter() - start))
            regime = "under cap (whole memory, no embed)" if n <= cap else "over cap (embed + scan)"
            section.lines.append(f"| {n} | {regime} | {_p(timings)} | {len(block)} |")
        finally:
            shutil.rmtree(root, ignore_errors=True)
    return section


def bench_recall_latency(backend: str, scales: tuple[int, ...]) -> Section:
    """Measure recall(query) latency vs N (the on-demand overflow-access cost)."""
    section = Section(f"Recall latency -- backend=`{backend}`")
    section.lines.append("| N | recall ms (median/p95) |")
    section.lines.append("|--:|--:|")
    for n in scales:
        root = Path(tempfile.mkdtemp(prefix="vivbench_rc_"))
        try:
            store = _make_store(backend, root)
            store.append_memory("warmup -- loads the model outside timing", Importance.LOW, 0)
            for i in range(n):
                store.append_memory(_content(i), Importance.MEDIUM, i)
            timings = []
            for q in range(RETRIEVE_SAMPLES):
                start = time.perf_counter()
                store.recall(f"thoughts on topic {q % TOPICS}", n, constants.RECALL_K)
                timings.append(_ms(time.perf_counter() - start))
            section.lines.append(f"| {n} | {_p(timings)} |")
        finally:
            shutil.rmtree(root, ignore_errors=True)
    return section


def bench_recall_quality(backend: str) -> Section:
    """Can recall surface a planted overflow memory by exact text and by paraphrase?

    Exact-text recall should always land it (distance ~0). Paraphrase recall is the
    real test of semantic search -- it lands on the MiniLM backend but not on the
    fake (sha256) embedder, which has no semantics; the table makes that explicit.
    """
    section = Section(f"Recall quality -- backend=`{backend}`")
    root = Path(tempfile.mkdtemp(prefix="vivbench_rq_"))
    try:
        store = _make_store(backend, root)
        planted = "The copper key is buried beneath the third grey stone by the old mill."
        store.append_memory(planted, Importance.LOW, 0)  # old, low, will be deep overflow
        for i in range(20):
            store.append_memory(_content(i), Importance.LOW, i + 1)
        current = 30
        exact = store.recall(planted, current, constants.RECALL_K)
        para = store.recall(
            "where did I hide the key near the old mill?", current, constants.RECALL_K
        )

        def in_topk(items: list[MemoryItem]) -> str:
            return "yes" if any(m.content == planted for m in items) else "no"

        def ranked_first(items: list[MemoryItem]) -> str:
            return "yes" if items and items[0].content == planted else "no"

        section.lines.append("| query | planted in top-k? | ranked #1? |")
        section.lines.append("|--|--|--|")
        section.lines.append(f"| exact text | {in_topk(exact)} | {ranked_first(exact)} |")
        section.lines.append(f"| paraphrase | {in_topk(para)} | {ranked_first(para)} |")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return section


def bench_overflow_correctness(backend: str) -> Section:
    """Verify the over-cap guarantees at the REAL cap (N grown past MEMORY_RESIDENT_CAP).

    With memory past the cap: every HIGH-importance memory stays resident, the block
    is exactly the cap size, and a distinctive low-importance memory that the block
    drops is still reachable via recall. Tested at the production cap (no temporary
    override) so the result reflects exactly what agents run with.
    """
    section = Section(f"Overflow correctness -- backend=`{backend}`")
    cap = constants.MEMORY_RESIDENT_CAP
    root = Path(tempfile.mkdtemp(prefix="vivbench_of_"))
    try:
        store = _make_store(backend, root)
        vow = "I swore a vow never to abandon my kin, whatever it costs me."
        key = "The copper key is buried beneath the third grey stone by the old mill."
        store.append_memory(vow, Importance.HIGH, 0)  # must stay resident forever
        store.append_memory(key, Importance.LOW, 1)  # distinctive overflow memory
        n = cap + 60  # comfortably over the cap
        for i in range(n):
            store.append_memory(_content(i), Importance.MEDIUM, i + 2)
        current = n + 2
        block = store.resident_block("the ordinary business of an ordinary day", current)
        contents = [m.content for m in block]
        recalled = store.recall(key, current, constants.RECALL_K)  # exact -> robust on any backend

        def yn(ok: bool) -> str:
            return "yes" if ok else "no"

        high_resident = any("vow never to abandon" in c for c in contents)
        size_ok = len(block) == cap
        key_overflowed = not any("copper key" in c for c in contents)
        key_recalled = any("copper key" in m.content for m in recalled)

        section.lines.append(f"| check (N={current}, cap={cap}) | result |")
        section.lines.append("|--|--|")
        section.lines.append(f"| HIGH-importance memory always resident | {yn(high_resident)} |")
        section.lines.append(f"| block size == cap | {yn(size_ok)} ({len(block)}=={cap}) |")
        section.lines.append(
            f"| distinctive low-importance memory overflowed (not resident) | {yn(key_overflowed)}|"
        )
        section.lines.append(f"| ... yet reachable via recall | {yn(key_recalled)} |")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return section


def _retrieve_relevance_only(store: FileMemoryStore, query: str) -> list[MemoryItem]:
    items = store._items
    return score_memories(
        items,
        store._vector_store.distances(query, [m.id for m in items]),
        0,
        constants.RETRIEVAL_K,
        w_recency=0.0,
        w_importance=0.0,
        w_relevance=1.0,
        recency_decay=constants.RECENCY_DECAY,
        importance_weights=constants.IMPORTANCE_WEIGHTS,
    )


def _retrieve_recency_only(store: FileMemoryStore) -> list[MemoryItem]:
    return score_memories(
        store._items,
        {},
        100,
        constants.RETRIEVAL_K,
        w_recency=1.0,
        w_importance=0.0,
        w_relevance=0.0,
        recency_decay=constants.RECENCY_DECAY,
        importance_weights=constants.IMPORTANCE_WEIGHTS,
    )


def _ids(items: list[MemoryItem]) -> list[str]:
    return [item.id for item in items]


def _p(values: list[float]) -> str:
    """Format median / p95 of a millisecond sample."""
    ordered = sorted(values)
    median = statistics.median(ordered)
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
    return f"{median:.2f} / {p95:.2f}"


def run(backend: str, scales: tuple[int, ...]) -> list[Section]:
    """Run every benchmark section and return them in report order."""
    sections = [
        bench_latency_and_footprint(backend, scales),
        bench_scorer_pure(scales),
        bench_embedding(backend),
        bench_quality(backend),
        # Sprint 5.1: the resident-block redesign -- retrieval / recall / overflow.
        bench_resident_block(backend, scales),
        bench_recall_latency(backend, scales),
        bench_recall_quality(backend),
        bench_overflow_correctness(backend),
    ]
    if backend == "chroma":  # restart cost is only meaningful for the persistent store
        sections.append(bench_restart(scales))
    return sections


def render(sections: list[Section], backend: str, scales: tuple[int, ...], elapsed: float) -> str:
    """Render the sections as a single markdown report block."""
    out = [
        f"## Run -- backend=`{backend}`, scales={list(scales)} ({elapsed:.1f}s total)",
        "",
        f"Dials: RETRIEVAL_K={constants.RETRIEVAL_K}, RECENCY_DECAY={constants.RECENCY_DECAY}, "
        f"REFLECT_EVERY_N_BREATHS={constants.REFLECT_EVERY_N_BREATHS}, "
        f"weights=(r={constants.W_RECENCY}, i={constants.W_IMPORTANCE}, v={constants.W_RELEVANCE})",
        f"Resident-block dials: MEMORY_RESIDENT_CAP={constants.MEMORY_RESIDENT_CAP}, "
        f"RECALL_K={constants.RECALL_K}, recall weights=(r={constants.RECALL_W_RECENCY}, "
        f"i={constants.RECALL_W_IMPORTANCE}, v={constants.RECALL_W_RELEVANCE})",
        "",
    ]
    for section in sections:
        out.append(f"### {section.title}")
        out.extend(section.lines)
        out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Vivarium memory benchmark")
    parser.add_argument("--backend", choices=("chroma", "fake"), default="chroma")
    parser.add_argument("--scale", type=int, default=None, help="max store size to test")
    parser.add_argument("--out", type=Path, default=None, help="append report to markdown")
    args = parser.parse_args(argv)

    if args.scale is None:
        scales = DEFAULT_SCALES
    else:
        scales = (*(s for s in DEFAULT_SCALES if s < args.scale), args.scale)

    start = time.perf_counter()
    sections = run(args.backend, scales)
    report = render(sections, args.backend, scales, time.perf_counter() - start)

    print(report)
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("a", encoding="utf-8") as handle:
            handle.write("\n" + report)
        print(f"\n[appended to {args.out}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

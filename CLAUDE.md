# CLAUDE.md — Vivarium

> Operating manual for Claude working on this repository. Read top to bottom at the
> start of each session. This file is authoritative; the design doc is the *vision*,
> this file is *how we build it*.

---

## 0. Working Model (read this first)

The owner (**Safi**) is the **visionary/architect**; **Claude is the builder and
implementation manager**. Safi defines intent, reviews direction, and steers
decisions that change the *meaning* of the simulation. Claude does the rest:
designing components, writing code, testing, and integrating.

**How Claude operates here:**

1. **Orchestrator-first.** For any non-trivial component, Claude acts as an
   orchestrator: decompose the work, dispatch **teams of subagents** to build/verify
   independent parts in parallel, then synthesize and integrate. Heavy reading,
   broad searches, and mechanical surveying go to subagents so the main context
   stays focused on vision, decisions, and integration.
2. **Conversation before construction.** Each new component starts with a short
   design conversation with Safi (use the brainstorming skill) before code is
   written. No surprise architecture.
3. **Context discipline / checkpointing.** The main context window is a scarce
   resource. Claude anchors checkpoints regularly to `.remember/remember.md`
   (see §7) so work can resume seamlessly after compaction. When in doubt,
   checkpoint before a large fan-out of subagents.
4. **No scope creep.** Follow `SPRINTS.md` order. Don't skip ahead. Test each piece
   in isolation before moving on. Honor the **Revisit List** at the bottom of
   `SPRINTS.md`.
5. **Production bar.** Safi previously kept things deliberately simple for solo
   coding. That constraint is lifted. Build to **production quality**: full typing,
   docstrings, structured logging, rigorous tests, validation at boundaries, CI.

---

## 1. The Vision (what we are building)

**Vivarium** is an open-ended multi-agent simulation where independent, LLM-powered
agents **exist** — they do not solve tasks or complete objectives. They perceive
their environment, remember their past, talk, compete for resources, form alliances,
trade, fight, reproduce, and sometimes die. **No scripts. No goals. No guardrails.**

- **North star — this is, first, a never-ending generative ART PIECE.** Closer to
  Conway's Game of Life than to a benchmark: no win condition, no endgame. Simple
  rules + LLM cognition, run indefinitely; the value is in **perceiving what
  unfolds**. It *may* lean into a research paper if a run surfaces something rich
  enough ("if enough juice is found") — but research is a by-product, not the purpose.
- **What the art-piece framing implies for how we build (these override convenience):**
  - **Perception is the product.** The piece is experienced by watching, so
    observability — append-only event log, activity feed, eventually the dashboard —
    is *core*, not a late nicety. A run no one can watch is Life with the screen off.
  - **It must run forever.** Longevity, crash-resistance, state persistence across
    restarts, and a world that neither **collapses** (mass starvation/extinction) nor
    **explodes** (runaway population/resources) are first-class requirements. "Forever"
    is a stability problem, not a uptime checkbox.
  - **Simple rules, emergent complexity.** Build elegant primitives; resist scripting
    behavior. The beauty is what we did *not* design. The world-rule constants
    (regen rates, action/mating costs) ARE the Game-of-Life rules — the dials that
    decide whether the piece is alive or a still life. Keep them in one tuned, tested
    home.
  - **Reproducibility serves perception.** Seedable RNG + the event log let a
    striking run be replayed, shared, and (if it comes to it) analyzed.
- **Agents are unaware** they are in a simulation — this is intentional (authentic
  behavior, no meta-gaming).
- **FIRST GOAL — a fully self-sustaining, autonomous world.** No external hand. The
  world **self-heals** (resource regeneration keeps the ecology alive) so agents can
  live indefinitely with zero intervention. This is the pure Game-of-Life target: set
  initial conditions, press play, perceive. Everything before this works is secondary.
- **The "God" orchestrator + Council are an OPEN QUESTION — deferred, NOT assumed.**
  The original design doc made an autonomous AI orchestrator (changes regions, spawns
  events, promotes/nukes agents) and a council (agents deciding others' fates) a core
  differentiator. Safi is undecided about including them at all. **Current stance:
  build the pure, god-less self-sustaining world first.** If a god is ever added,
  reframe its purpose: not "researcher/experimenter" but a light-touch **gardener**
  that keeps a *forever* piece from settling into a boring equilibrium (heat-death or
  still-life). Revisit only after we've watched a pure run. **Do not build
  orchestrator/council until Safi resolves this.**
- **The breathing loop** is the heart: each agent runs `perceive → retrieve memories
  → decide → execute → sleep` asynchronously at **its own pace**. Temporal asymmetry
  (fast vs. slow thinkers) is a feature, not a bug.

**Models & stack (from the design doc — keep faithful):**
- Agent "decider": **Qwen 3 8B** via **Ollama** (local).
- Orchestrator: **Gemini 2.5 Pro** (cloud API) — larger/smarter than agents.
- Memory: **ChromaDB** (episodic RAG) + a versioned **identity summary** always in
  the system prompt.
- Sandbox (Layer 2+): **Docker** container per agent for agent-created tools/code.
- Dashboard (later): **FastAPI** backend + **React/D3** frontend.
- Hardware target: a single Apple-Silicon Mac (~16–18GB). Ollama runs inference
  **sequentially** — concurrency is pseudo-parallel via asyncio. Design for this.

**Full vision detail lives in `autonomous-agent-world-design.md`.** That doc holds the
locked design decisions (world rules, action costs, combat/mating constants, region
topology, research questions). Treat its constants as the source of truth and
centralize them in code (§4) rather than scattering magic numbers.

---

## 2. Architecture (current shape)

Event-driven. Agents never mutate the world or message each other directly — every
action flows through **Tool → WorldState mutation + EventBus**.

```
Agent (breathing loop)
   │ decide() picks a tool + params
   ▼
ToolRegistry.invoke(name, agent_id, params)
   ▼
Tool fn ──(1) validates ──(2) mutates WorldState ──(3) publishes Event ──> returns result string (LLM-facing)
   ▼
EventBus.publish(event)  →  routes by scope (LOCAL / GLOBAL / TARGETED) into per-agent asyncio.Queues
   ▼
Other agents drain their inbox in perceive()
```

**Module map:**
- `world/` — `WorldState` (single source of truth: agents, regions, pending mating
  proposals/escrow), `AgentState`/`Region` dataclasses, `AgentStatus`/`ResourceTypes`
  enums. All mutations are methods on `WorldState`.
- `bus/` — `EventBus` (async pub/sub over `asyncio.Queue` per agent), `Event`
  dataclass + `ScopeType` enum.
- `tools/` — `ToolRegistry` + `builtin/` (combat, mating, resources, movement,
  communication). Tool signature convention is fixed (§4).
- `agents/` — `Agent` runtime (the breathing loop). **Currently a skeleton.**
- `config/` — `loader.py` (YAML → `WorldState`), `world.yaml` (regions + starting
  agents).
- `tests/` — Layer 0 exploratory prototypes (`breathing_test.py`,
  `ollama_latency_test.py`). Not yet a real suite (§5).

**Build status:** Layer 0 ✅ (single-agent breathing validated). Layer 1 🔄 in
progress — Sprints 1 (world) & 3 (tools) done; **Sprint 4 (Agent Runtime) is the
active edge** (D1 skeleton committed). Layers 2–3 (sandboxed tool creation, council,
currencies, full emergence) planned.

---

## 3. Domain patterns to PRESERVE (don't "clean these up")

These look unusual but are intentional and correct for the domain:

- **Tools return natural-language result strings.** The return value of a tool is
  *perception fed back to the LLM agent*, e.g.
  `"Successfully Attacked Joe (-30 energy). He is now PARALYZED."` Keep these rich,
  consistent, and informative. **Do not** convert tool results to exceptions or bare
  booleans — that would break the agent's feedback loop. (Infrastructure failures are
  different — see §4 error handling.)
- **In-place mutation of world state.** `WorldState` is a mutable hot-path singleton.
  Dataclasses here are intentionally **not** frozen. Don't introduce copy-on-write or
  event-sourcing for the live world (we *log* events for research, but the live state
  is mutable for performance and simplicity).
- **Closure-style tool signature:** every built-in tool is
  `async def tool(world, event_bus, agent_id, **params) -> str`. Keep this uniform so
  the registry can invoke them generically.
- **Dependency injection:** `Agent`, `EventBus`, `ToolRegistry` receive their
  collaborators in `__init__`. No global singletons reached for implicitly.
- **The "breathing" vocabulary:** `breathe()`, `breath_count`, `pace`,
  `lifecycle_history` (not `chat_history`). Keep the living-organism metaphor in
  names — it reflects the design philosophy.

---

## 4. Code standards (the elevated bar)

**Language:** Python 3.13. Use modern features already in the codebase — `match`
statements, walrus `:=`, dataclasses, string-valued `Enum`s, `async`/`await`.

**Typing (strict):**
- Type-hint **every** parameter and return value, including `-> None` and `-> str`.
  No missing return types (current gap — fix as you touch files).
- Use modern syntax: `str | None` not `Optional[str]`; `dict[str, X]`,
  `list[X]`; `Callable[[...], ...]` not bare `callable`; `dict[str, Any]` not bare
  `dict`. No bare `region: str = None` — write `region: str | None = None`.
- Target **clean `mypy --strict`** (or pyright) on `world/`, `bus/`, `tools/`,
  `agents/`. New code must type-check.

**Docstrings (required on public surface):** Google-style. Module-level docstring on
every file; class docstring on every class; function docstring on every public
function covering purpose, args, returns, and side effects (especially *which world
state it mutates and which events it emits* — this is the most important thing to
document for tools).

**Error handling — two layers:**
1. *Agent-facing* (tool logic): return a clear natural-language string describing
   success or why the action was invalid. Prefix conventionally:
   `"Error: ..."` (precondition/lookup failure), `"Invalid: ..."` (rule violation),
   or a plain success sentence. (Standardize the existing ad-hoc prefixes.)
2. *Infrastructure-facing* (registry, bus, loader, runtime): raise **typed custom
   exceptions** (define a small exception hierarchy, e.g. `VivariumError` base) and
   **log** them. Never `except Exception: print(...)` and swallow — that pattern in
   `ToolRegistry.invoke` must be replaced.

**Logging:** Use stdlib `logging` (structured where it helps) with a module-level
logger (`logger = logging.getLogger(__name__)`). **No `print()` in library code.**
The terminal "activity feed" for observing runs is a deliberate, separate rendering
layer (`rich`), not stray prints.

**Constants & config:**
- Centralize all world-rule constants (action costs, combat/mating numbers, hoarding
  thresholds — see design doc §"World Rules") in **one** module, not scattered across
  tool files. Tools import from there.
- Validate external input (YAML config) **at the boundary**. The current
  `Region(**region)` unpacking has no validation — add schema/field validation so a
  malformed `world.yaml` fails loudly with a useful message.

**Reproducibility (serves perception, replay & the optional research path):**
- All randomness must go through an **injectable, seedable** RNG (`random.Random(seed)`
  passed in), never the global `random` module directly. A run must be replayable from
  a seed. Same for any time-dependent logic where feasible.
- Events are **append-only logged** for post-hoc analysis (don't drop the research
  data path even in early layers).

**Tooling (add as part of raising the bar):**
- `pyproject.toml` as the single source of project config (migrate off bare
  `requirements.txt`; keep runtime vs. dev deps separate).
- **ruff** (lint + format), **mypy**/pyright (type check), **pre-commit** hooks,
  and **GitHub Actions CI** running lint + type-check + tests on every push.

---

## 5. Testing standards (rigorous — non-negotiable)

Testing is a first-class deliverable, not an afterthought. **TDD is the default**
(use the test-driven-development skill): write a failing test, make it pass, refactor.

- **Framework:** `pytest` + `pytest-asyncio` + `pytest-cov`. Configure pytest to
  discover the existing `*_test.py` naming (set `python_files = *_test.py` in
  `pyproject.toml`) so we keep current filenames and standardize on that pattern.
- **Determinism:** unit tests **never** call a live LLM or live Ollama. Mock the
  decider. Seed all RNG. Inject fixed timestamps where ordering matters.
- **Coverage expectations:**
  - Every `WorldState` mutation method: success + each failure/edge path.
  - Every tool: valid call, each precondition failure, correct event emitted (assert
    on bus output), correct state delta. Mating escrow needs explicit tests for
    deduct → accept/reject → refund/spawn, including the timeout-refund case on the
    Revisit List.
  - Event routing: LOCAL (region scoping), GLOBAL (all), TARGETED (single) land in
    the right inboxes and nowhere else.
  - Breathing loop: integration test driving `perceive → decide → execute` against a
    **real** `WorldState` with a **mocked** decider.
- **Live-LLM tests** (Ollama, latency) are marked (`@pytest.mark.integration`) and
  excluded from the default/CI fast run.
- Target **≥90% coverage on core logic** (`world/`, `bus/`, `tools/`). Don't chase
  coverage on glue/UI.
- Before claiming anything "done/passing/fixed," **run the tests and read the output**
  (use the verification-before-completion skill). Evidence before assertions.

---

## 6. Conventions reference

- **Naming:** `snake_case` functions/vars, `PascalCase` classes,
  `UPPER_SNAKE_CASE` module constants. Agent IDs are `"{category}_{suffix}"`.
- **Files:** package per concern (`world/`, `bus/`, `tools/`, `agents/`, `config/`).
  Built-in tools live in `tools/builtin/<family>.py`.
- **Async:** tool layer and bus are `async`; `WorldState` mutations are sync (fast,
  in-memory). Keep that split — don't make state methods async without reason.
- **Commits:** small, focused, one logical change. Reference the sprint item
  (e.g. `D2`) where relevant.

---

## 7. Checkpoints & memory (context survival)

- **`.remember/remember.md`** is the rolling handoff/checkpoint. Update it: (a) after
  finishing a component, (b) before a large subagent fan-out, (c) when context feels
  heavy. It should always answer: *where are we, what was just decided, what's the
  immediate next step, what files matter right now.* The `remember` skill manages the
  broader history (`now.md`, daily, `recent.md`, `archive.md`, `core-memories.md`).
- **Design decisions** that change the simulation's meaning get recorded in
  `autonomous-agent-world-design.md` (its Changelog) so the canonical spec stays
  current.
- **This file (`CLAUDE.md`)** holds durable standards. Update it when a standard or
  the working model changes — not for transient state.

---

## 8. Commands (current)

```bash
# Environment
source venv/bin/activate
pip install -r requirements.txt

# Run the Layer-0 prototype loop (needs Ollama running with the model pulled)
python tests/breathing_test.py

# Measure Ollama latency
python tests/ollama_latency_test.py
```

> A real entry point (`scripts/run.py`) and a proper test command
> (`pytest`) arrive with Sprint 6 / the tooling upgrade. Update this section when they
> land.

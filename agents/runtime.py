"""The :class:`Agent` -- a single living being's breathing loop.

An agent *exists*: it does not solve a task. Each breath it
``perceive -> decide -> execute -> refresh_status`` against the *real*
:class:`~world.world.WorldState`, :class:`~bus.event_bus.EventBus` and
:class:`~tools.registry.ToolRegistry`, thinking through an injected
:class:`~agents.decider.Decider` (design DD1) -- a mock in tests, Ollama in
production. The loop never learns it is in a simulation (see ``CLAUDE.md``
Sections 1 and 3): perception is rendered as plain sensory narrative and the
system prompt carries only persona + tool affordances (design DD9).

Two invariants matter for the chat backend the decider talks to:

* **History atomicity.** A breath appends exactly a ``user`` perception, then an
  ``assistant`` turn, then one ``tool`` result per requested call. If ``decide``
  fails, the perception turn is rolled back so the history never holds two
  consecutive ``user`` turns (which breaks chat models).
* **Tool-call id pairing.** Every ``assistant`` tool call and its ``tool`` result
  share an id (provider-supplied, or deterministically synthesised), so the
  backend can pair a result to its call.

Liveness is read live from the agent's
:class:`~world.agents.AgentStatus`: the loop acts only while ``ALIVE``. Paralysis
is **recoverable**, not terminal -- on an ``ALIVE -> PARALYZED`` transition the
agent emits a system ``agent_paralyzed`` event (the agent holds the bus; the world
does not, per design DD4) but the loop keeps breathing (drain-only) so another
agent can feed and revive it (Sprint 6). Only ``DEAD`` stops the loop.
"""

from __future__ import annotations

import asyncio
from typing import Any

from agents.compaction import (
    RECAP_ACK,
    build_compaction_messages,
    estimate_tokens,
    truncate_to_tokens,
)
from agents.decider import Decider, Decision, ToolCall
from agents.prompt import build_system_prompt
from agents.recall import RECALL_TOOL_NAME, RECALL_TOOL_SCHEMA, render_recall
from agents.reflection import REFLECTION_TOOL_SCHEMAS, build_reflection_messages, render_recap
from agents.tool_schemas import schemas_for
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    ATTACK_ENERGY_COST,
    COMPACTION_HARD_SAFETY_TOKENS,
    COMPACTION_KEEP_RECENT_TURNS,
    COMPACTION_RECAP_RESERVE_TOKENS,
    COMPACTION_TARGET_TOKENS,
    COMPACTION_TRIGGER_TOKENS,
    DECIDE_BACKOFF_SECONDS,
    PARALYSIS_ENERGY_THRESHOLD,
    PROMPT_BUDGET_TOKENS,
    RECALL_K,
    REFLECT_EVERY_N_BREATHS,
    REFLECT_RECAP_TURNS,
)
from core.exceptions import EventBusError, ToolError
from core.logging import get_logger
from memory.models import Importance, MemoryItem
from memory.store import NULL_MEMORY, MemoryStore
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState

logger = get_logger(__name__)

# DECIDE_BACKOFF_SECONDS is re-exported from core.constants (its one tuned home);
# imported here because the breathing loop applies it and tests reference it.
__all__ = ["DECIDE_BACKOFF_SECONDS", "Agent"]

#: The agent's own (assistant-voice) acknowledgement of its resident memory block.
#: It sits at ``lifecycle_history[2]`` so the block (a ``user`` turn at ``[1]``) is
#: followed by an assistant turn -- preserving the "never two consecutive user
#: turns" invariant the chat backend requires. Byte-stable, so it never evicts the
#: KV cache between reflections.
RESIDENT_BLOCK_ACK: str = "These are the memories I carry; they are part of who I am."


class Agent:
    """A single agent's breathing loop over the shared world.

    The agent owns no world state of its own: it reads the world live (so its view
    never goes stale as the world mutates) and effects every change through tools.
    It keeps only its conversational :attr:`lifecycle_history`, a
    :attr:`breath_count`, and small loop-control flags.

    Attributes:
        agent_id: Id of the agent this loop drives (must exist in the world).
        world: The live :class:`~world.world.WorldState` (read-only from here).
        event_bus: The bus this agent perceives from and emits to.
        tool_registry: The registry through which decisions are executed.
        decider: The injected cognition seam (design DD1).
        pace: Seconds to sleep between breaths in :meth:`run` (0.0 in tests).
        lifecycle_history: The chat-style turn history (system/user/assistant/tool)
            -- the living-organism analogue of a chat history (see ``CLAUDE.md``
            Section 3).
        breath_count: Number of breaths taken (incremented once per breath).
    """

    def __init__(
        self,
        agent_id: str,
        world: WorldState,
        event_bus: EventBus,
        tool_registry: ToolRegistry,
        decider: Decider,
        pace: float = 0.0,
        memory: MemoryStore | None = None,
    ) -> None:
        """Initialise the agent and seed its system prompt.

        Subscribes the agent to the bus (the bus guards unknown ids, so this is a
        safe no-op if the agent does not exist) and seeds
        :attr:`lifecycle_history` with the system prompt.

        Args:
            agent_id: Id of the agent to drive.
            world: The live world state.
            event_bus: The event bus to perceive from and emit to.
            tool_registry: The tool registry decisions are executed through.
            decider: The injected decider (mock in tests, Ollama in production).
            pace: Inter-breath sleep in seconds for :meth:`run`; defaults to 0.0.
            memory: The injected memory store (Sprint 5). Defaults to the inert
                :data:`~memory.store.NULL_MEMORY`, so an agent runs identically
                with or without durable memory.
        """
        self.agent_id: str = agent_id
        self.world: WorldState = world
        self.event_bus: EventBus = event_bus
        self.tool_registry: ToolRegistry = tool_registry
        self.decider: Decider = decider
        self.pace: float = pace
        self.memory: MemoryStore = memory if memory is not None else NULL_MEMORY

        # Renamed from "chat_history": these are the turns of a living being.
        self.lifecycle_history: list[dict[str, Any]] = []
        self.breath_count: int = 0
        self._stopped: bool = False
        self._last_decide_failed: bool = False
        self._resident_block_installed: bool = False
        self._recap_installed: bool = False
        self._last_prompt_tokens: int = 0  # actual prompt size of the last decide (safety net)

        self.event_bus.subscribe(self.agent_id)
        self._load_system_prompt()

    # ---- liveness ---------------------------------------------------------

    @property
    def alive(self) -> bool:
        """Whether the agent currently exists and is ``ALIVE`` (able to act).

        Read live from the world so it reflects mutations (e.g. paralysis) the
        moment they happen.

        Returns:
            ``True`` only if the agent exists and its status is ``ALIVE``.
        """
        return self._status() is AgentStatus.ALIVE

    def _status(self) -> AgentStatus | None:
        """Return the agent's current status, or ``None`` if it no longer exists."""
        agent_state = self.world.get_agent(self.agent_id)
        return agent_state.status if agent_state is not None else None

    def _tool_names(self) -> list[str]:
        """Return the names of the tools available to this agent (registry order)."""
        return self.tool_registry.list_tools()

    def _action_schemas(self) -> list[dict[str, Any]]:
        """Return the tool schemas offered to the decider for an action.

        The registry tools, plus the agent-owned ``recall`` tool when (and only
        when) the agent has a real memory store -- a memory-less agent cannot search
        a memory it does not have. The set is stable for an agent's lifetime (it
        never flips as memory grows), so the model's KV cache stays warm.

        Returns:
            The action tool schemas, registry tools first then ``recall`` if offered.
        """
        schemas = schemas_for(self._tool_names())
        if self.memory is not NULL_MEMORY:
            schemas.append(RECALL_TOOL_SCHEMA)
        return schemas

    # ---- setup ------------------------------------------------------------

    def _load_system_prompt(self) -> None:
        """Seed :attr:`lifecycle_history` with the system prompt and resident block.

        The system prompt is persona + tool affordances only (design DD9); no goals,
        strategy, or simulation language. Immediately after it, the resident memory
        block is installed at ``[1]`` (a ``user`` turn) and its acknowledgement at
        ``[2]`` (an ``assistant`` turn) -- but only for an agent with real memory
        (see :meth:`_set_resident_block`).
        """
        self.lifecycle_history.append({"role": "system", "content": self._system_prompt()})
        self._set_resident_block("")  # no perception yet at birth; query is irrelevant under cap

    def _system_prompt(self) -> str:
        """Compose the system prompt from the agent's identity + tool affordances.

        The persona is the agent's self-authored identity
        (:meth:`~memory.store.MemoryStore.load_identity`) when present, falling
        back to its static :attr:`~world.agents.AgentState.persona`, and finally to
        an empty string if the agent no longer exists (graceful degradation).
        Recomputed whenever the identity changes (after ``revise_self``); otherwise
        byte-stable across breaths to keep the model's KV cache warm.

        Returns:
            The assembled system-prompt string.
        """
        agent_state = self.world.get_agent(self.agent_id)
        identity = self.memory.load_identity()
        persona = identity or (agent_state.persona if agent_state is not None else "")
        return build_system_prompt(persona, self._tool_names())

    # ---- the four steps of a breath --------------------------------------

    async def perceive(self) -> None:
        """Drain the inbox and compose one ``user`` perception turn.

        Reads the agent's own state and its region directly from the world (rather
        than via ``look_around``, to avoid double-reporting) and renders the drained
        events as plain narrative ordered by timestamp. Appends a single ``user``
        message to :attr:`lifecycle_history`. No meta/simulation language is used.

        Perception is a *pure sensory stream*: memory no longer rides along here
        (Sprint 5.1). The agent's memories live in the always-resident block at
        ``lifecycle_history[1]`` (rebuilt only at reflection), so each breath's
        perception is just what the senses report -- appended at the tail, leaving
        the system prompt and the resident block byte-stable for the KV cache.

        Returns:
            None.
        """
        events = self.event_bus.get_events(self.agent_id)
        events.sort(key=lambda event: event.timestamp)
        perception = self._render_perception(events)
        self.lifecycle_history.append({"role": "user", "content": perception})

    async def decide(self) -> Decision | None:
        """Ask the decider for a decision and append the ``assistant`` turn.

        Builds the messages (the full :attr:`lifecycle_history`) and the tool
        schemas, then calls the decider. On success an ``assistant`` message
        (content / thinking / tool calls) is appended and the decision returned.

        Atomicity: if the decider raises, the just-appended perception ``user``
        turn is rolled back (so history never holds two consecutive ``user`` turns)
        and ``None`` is returned -- the breath ends gracefully.

        Returns:
            The :class:`~agents.decider.Decision`, or ``None`` if the decider
            failed (the failure is logged).
        """
        try:
            decision = await self.decider.decide(self.lifecycle_history, self._action_schemas())
        except Exception:
            logger.exception("Decider failed for agent %r; ending breath gracefully", self.agent_id)
            self._rollback_perception()
            return None
        self.lifecycle_history.append(self._assistant_message(decision))
        return decision

    async def execute(self, tool_calls: list[ToolCall]) -> None:
        """Invoke each requested tool and append a paired ``tool`` result turn.

        For each call: an id is paired to the matching assistant tool call, params
        are coerced (enum marshaling, design DD6), and the tool is invoked. A
        :class:`~core.exceptions.ToolError` (unknown tool / bad invocation) is
        caught, logged, and fed back as a ``tool`` message so the loop never
        crashes and the assistant turn never dangles without its results.

        Abort-on-paralyse (Sprint 6 T5): if an earlier call in the same breath
        leaves the agent no longer ``ALIVE`` (e.g. a ``speak`` that drops it to the
        paralysis threshold), the remaining calls are **not** invoked -- each still
        gets a paired ``tool`` turn (so the assistant turn never dangles) reporting
        that the agent could not act.

        Args:
            tool_calls: The tool calls from the decision (possibly empty).

        Returns:
            None.
        """
        for index, tool_call in enumerate(tool_calls):
            call_id = self._call_id(tool_call, index)
            if self._status() is not AgentStatus.ALIVE:
                result = f"You could not act ({tool_call.name!r}): you are no longer able to."
            elif tool_call.name == RECALL_TOOL_NAME:
                try:
                    result = self._recall(tool_call.params)
                except Exception:
                    # In production recall hits a real vector store that can raise;
                    # feed the failure back as a paired tool turn so the assistant
                    # turn never dangles (mirrors the ToolError path below).
                    logger.exception("recall failed for agent %r", self.agent_id)
                    result = "Nothing surfaced; your memory could not be searched just now."
            else:
                params = self._coerce_params(tool_call.params)
                try:
                    result = await self.tool_registry.invoke(tool_call.name, self.agent_id, params)
                except ToolError as error:
                    logger.warning(
                        "Tool %r failed for agent %r: %s", tool_call.name, self.agent_id, error
                    )
                    result = (
                        f"Nothing happened; the action {tool_call.name!r} could not be performed."
                    )
            self.lifecycle_history.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "tool_name": tool_call.name,
                    "content": result,
                }
            )

    async def refresh_status(self, previous_status: AgentStatus | None) -> None:
        """React to a status change caused by this breath's mutations.

        Compares the status captured before the breath to the freshly re-read
        status. On an ``ALIVE -> PARALYZED`` transition the agent emits a system
        ``agent_paralyzed`` event (the world cannot -- it has no bus, design DD4)
        so nearby beings perceive the collapse. Paralysis is **recoverable**, not
        terminal: the loop keeps breathing (drain-only) so another agent can feed
        and revive it (Sprint 6). Only ``DEAD`` stops the loop.

        Args:
            previous_status: The agent's status at the start of the breath
                (``None`` if the agent did not exist then).

        Returns:
            None.
        """
        agent_state = self.world.get_agent(self.agent_id)
        current_status = agent_state.status if agent_state is not None else None
        if (
            previous_status is AgentStatus.ALIVE
            and current_status is AgentStatus.PARALYZED
            and agent_state is not None
        ):
            await self._announce_paralysis(agent_state)
        elif current_status is AgentStatus.DEAD:
            self._stopped = True

    # ---- reflection (the memory write path) ------------------------------

    async def reflect(self) -> None:
        """Run one isolated reflection step: author memories / revise identity.

        Builds a two-turn context (current identity + a recent-life recap) offering
        ONLY the reflection tools, asks the decider, and applies any ``remember`` /
        ``revise_self`` calls to the memory store. A reflection that authors nothing
        is normal (the spike's Probe-A path) -- it is skipped, never raised. A
        failing decider is likewise swallowed so reflection can never crash a breath.

        Side effects:
            May append a memory (``remember``) and/or rewrite the identity and
            rebuild the system turn (``revise_self``) via :attr:`memory`. Always
            refreshes the resident memory block afterwards, so a newly-remembered
            memory becomes resident for the next breath. Reflection re-prefills the
            KV cache anyway, so rebuilding the block here is effectively free.

        Returns:
            None.
        """
        recap = render_recap(self._live_turns(), REFLECT_RECAP_TURNS)
        messages = build_reflection_messages(self.memory.load_identity(), recap)
        try:
            decision = await self.decider.decide(messages, REFLECTION_TOOL_SCHEMAS)
        except Exception:
            logger.exception("Reflection decider failed for agent %r", self.agent_id)
            return
        for call in decision.tool_calls:
            match call.name:
                case "remember":
                    self._apply_remember(call.params)
                case "revise_self":
                    self._apply_revise_self(call.params)
                case _:
                    logger.debug(
                        "Ignoring unexpected reflection tool %r for agent %r",
                        call.name,
                        self.agent_id,
                    )
        self._set_resident_block(recap)  # refresh the block with this reflection's view

    def _apply_remember(self, params: dict[str, Any]) -> None:
        """Persist a ``remember`` call's memory; ignore an empty/blank one.

        Args:
            params: The tool-call params (``content`` and ``importance``); an
                unknown ``importance`` falls back to ``MEDIUM``.
        """
        content = params.get("content")
        if not isinstance(content, str) or not content.strip():
            return
        try:
            importance = Importance.from_str(str(params.get("importance", "medium")))
        except ValueError:
            importance = Importance.MEDIUM
        self.memory.append_memory(content.strip(), importance, self.breath_count)

    def _apply_revise_self(self, params: dict[str, Any]) -> None:
        """Rewrite identity from a ``revise_self`` call and rebuild the system turn.

        Args:
            params: The tool-call params (``identity``); a blank value is ignored.
        """
        identity = params.get("identity")
        if not isinstance(identity, str) or not identity.strip():
            return
        self.memory.write_identity(identity.strip())
        self.lifecycle_history[0] = {"role": "system", "content": self._system_prompt()}

    def _prefix_len(self) -> int:
        """Number of leading scaffolding turns before the live verbatim region.

        The prefix is the system turn plus the optional resident-memory pair
        (``[1]``/``[2]``) plus the optional running-recap pair. The verbatim turns
        (perception/decision/tool) always begin at this index.
        """
        return (
            1
            + (2 if self._resident_block_installed else 0)
            + (2 if self._recap_installed else 0)
        )

    def _recap_index(self) -> int:
        """Index where the recap pair lives (or would be inserted): after system+block."""
        return 1 + (2 if self._resident_block_installed else 0)

    def _live_turns(self) -> list[dict[str, Any]]:
        """Return the live conversational turns, excluding ALL scaffolding.

        The system turn, the resident-memory pair, and the running-recap pair are
        fixed scaffolding, not lived events. Excluding them keeps the reflection recap
        focused on what actually happened -- and, crucially, stops reflection from
        reading the running recap back to itself as if it were a fresh experience.

        Returns:
            ``lifecycle_history`` with the leading scaffolding turns dropped.
        """
        return self.lifecycle_history[self._prefix_len() :]

    def _set_resident_block(self, query: str) -> None:
        """Install or refresh the resident memory block at ``[1]`` / ``[2]``.

        For an agent with real memory, the whole memory (up to
        :data:`~core.constants.MEMORY_RESIDENT_CAP`) is kept resident as a ``user``
        turn at ``[1]``, followed by the agent's :data:`RESIDENT_BLOCK_ACK` at
        ``[2]`` (so the block never creates two consecutive ``user`` turns). On the
        first call (at birth) the pair is inserted right after the system prompt; on
        later calls (at reflection) it is replaced in place. A
        :data:`~memory.store.NULL_MEMORY` agent has no block at all -- this is a
        no-op -- so memory-less agents keep an unchanged ``[system, ...live]`` shape.

        Args:
            query: The perception/recap used to rank the over-cap fill by relevance
                (ignored when the whole memory fits under the cap).
        """
        if self.memory is NULL_MEMORY:
            return
        memories = self.memory.resident_block(query, self.breath_count)
        block = {"role": "user", "content": self._render_resident_block(memories)}
        ack = {"role": "assistant", "content": RESIDENT_BLOCK_ACK}
        if self._resident_block_installed:
            self.lifecycle_history[1] = block
            self.lifecycle_history[2] = ack
        else:
            self.lifecycle_history[1:1] = [block, ack]  # insert right after the system turn
            self._resident_block_installed = True

    def _render_resident_block(self, memories: list[MemoryItem]) -> str:
        """Render the resident memory block as an in-world 'all you carry' turn.

        Args:
            memories: The resident memories (chronological; from
                :meth:`~memory.store.MemoryStore.resident_block`).

        Returns:
            A multi-line block naming what the agent carries (no meta language). When
            the memory has overflowed the resident cap, a closing line nudges the
            agent to ``recall`` deeper memories on demand.
        """
        if not memories:
            return "You carry little yet; your life has only just begun."
        lines = ["All that you carry within you, the sum of who you have become:"]
        lines.extend(f"- {memory.content}" for memory in memories)
        if self.memory.memory_count() > len(memories):
            lines.append(
                "Older memories lie deeper than these; search your memory to bring one back."
            )
        return "\n".join(lines)

    def _recall(self, params: dict[str, Any]) -> str:
        """Run a ``recall`` action: search memory overflow and render the result.

        The agent owns this (not the registry) because only it holds the memory
        store. A missing or blank ``query`` is tolerated -- it searches with an empty
        query (the store handles it) so a malformed call still yields a perception
        rather than a dangling assistant tool call.

        Args:
            params: The tool-call params; ``query`` is the search text.

        Returns:
            The rendered recall result (an in-world ``tool`` perception string).
        """
        query = params.get("query")
        query = query.strip() if isinstance(query, str) else ""
        memories = self.memory.recall(query, self.breath_count, RECALL_K)
        return render_recall(memories)

    # ---- transcript compaction (Sprint 5.5) ------------------------------

    async def _ensure_context_budget(self, target: int) -> None:
        """Keep the assembled prompt within budget; the never-overflow guarantee.

        Runs before each ``decide`` (and opportunistically at reflection). If the
        estimated prompt exceeds ``target`` -- or the last REAL prompt exceeded the
        hard-safety threshold (the self-correcting net against estimator drift) --
        the transcript is compacted. A floor-overflow net then guarantees the prompt
        is under :data:`~core.constants.PROMPT_BUDGET_TOKENS` no matter what.

        Args:
            target: The token target to compact down to (lower at reflection,
                higher between reflections).

        Returns:
            None.
        """
        try:
            tools = self._action_schemas()
        except Exception:
            # A misconfigured tool (no schema) cannot be sized; skip the best-effort
            # budget check -- decide() will surface and roll back the real failure.
            logger.exception(
                "Cannot build action schemas for the budget check for agent %r", self.agent_id
            )
            return
        over_estimate = estimate_tokens(self.lifecycle_history, tools) > target
        over_actual = self._last_prompt_tokens > COMPACTION_HARD_SAFETY_TOKENS
        if over_estimate or over_actual:
            try:
                await self.compact()
            except Exception:
                # compact() is best-effort; the floor net below still bounds the prompt
                # mechanically, so a failure here must never skip enforcement.
                logger.exception("compact() failed for agent %r; enforcing budget", self.agent_id)
        self._enforce_prompt_budget(tools)

    async def compact(self) -> None:
        """Fold the oldest verbatim turns into the running recap; keep the rest.

        Eviction is **mechanical and unconditional, done before any model call**: the
        oldest whole breath-groups are dropped immediately so the transcript is bound
        regardless of the decider. Only *then* is the decider asked (with NO tools, so
        it returns narrative not a tool call) to author the new cumulative recap from
        the previous recap plus the evicted turns; on any failure the prior recap is
        kept. The result is installed as the recap pair at ``[recap_index]``.

        Side effects:
            Mutates :attr:`lifecycle_history` (drops evicted turns, installs/replaces
            the recap pair). One isolated decider call (best-effort).

        Returns:
            None.
        """
        prefix = self._prefix_len()
        verbatim = self.lifecycle_history[prefix:]
        cut = self._eviction_cut(verbatim)
        if cut <= 0 or cut >= len(verbatim):
            # Nothing safe to evict, or the cut would drop the most-recent perception
            # too (would leave the agent acting blind). The floor net handles the rest.
            return
        prior_recap = self._current_recap_text()
        evicted = verbatim[:cut]
        del self.lifecycle_history[prefix : prefix + cut]  # unconditional trim
        recap_text = await self._author_recap(prior_recap, evicted)
        self._set_recap(recap_text)

    def _eviction_cut(self, verbatim: list[dict[str, Any]]) -> int:
        """Choose how many of the OLDEST verbatim turns to evict.

        Keeps the most-recent turns that fit a verbatim budget (target minus the
        measured scaffolding minus a recap reserve), but never fewer than
        :data:`~core.constants.COMPACTION_KEEP_RECENT_TURNS`. The cut is snapped
        forward to a ``user`` turn so the kept tail begins on a perception and whole
        breath-groups (assistant tool calls with their paired ``tool`` results) are
        never split.

        Args:
            verbatim: The live turns after the scaffolding prefix.

        Returns:
            The number of leading turns to evict (0 if none).
        """
        prefix_no_recap = 1 + (2 if self._resident_block_installed else 0)
        scaffold = self.lifecycle_history[:prefix_no_recap]
        scaffold_tokens = estimate_tokens(scaffold, self._action_schemas())
        verbatim_budget = max(
            0, COMPACTION_TARGET_TOKENS - scaffold_tokens - COMPACTION_RECAP_RESERVE_TOKENS
        )
        # Keep the largest recent suffix within budget, floored at KEEP_RECENT.
        kept = 0
        total = 0
        for turn in reversed(verbatim):
            total += estimate_tokens([turn], [])
            if total > verbatim_budget and kept >= COMPACTION_KEEP_RECENT_TURNS:
                break
            kept += 1
        cut = len(verbatim) - min(kept, len(verbatim))
        # Snap forward so the kept tail starts on a user (perception) turn.
        while cut < len(verbatim) and verbatim[cut].get("role") != "user":
            cut += 1
        return cut

    def _current_recap_text(self) -> str | None:
        """Return the existing running-recap narrative, or ``None`` if not installed."""
        if not self._recap_installed:
            return None
        content = self.lifecycle_history[self._recap_index()].get("content", "")
        return content if isinstance(content, str) else None

    async def _author_recap(self, prior_recap: str | None, evicted: list[dict[str, Any]]) -> str:
        """Ask the decider (no tools) to narrate the new cumulative recap; best-effort.

        Args:
            prior_recap: The previous recap (folded in), or ``None`` on the first.
            evicted: The turns being folded away.

        Returns:
            The new recap text; falls back to ``prior_recap`` (or empty) on failure.
        """
        messages = build_compaction_messages(prior_recap, evicted)
        try:
            decision = await self.decider.decide(messages, [])  # no tools -> narrative
        except Exception:
            logger.exception("Compaction decider failed for agent %r", self.agent_id)
            recap = prior_recap or ""
        else:
            recap = decision.text.strip() or (prior_recap or "")
        # Bound the cumulative recap at authoring so a verbose model cannot grow it
        # across compactions; keeps the eviction budget math honest and overflow-safe.
        return truncate_to_tokens(recap, COMPACTION_RECAP_RESERVE_TOKENS)

    def _set_recap(self, text: str) -> None:
        """Install or replace the running-recap pair at ``[recap_index]`` / ``+1``.

        The recap is a ``user`` turn (an in-world 'looking back' surfacing) followed
        by the agent's :data:`~agents.compaction.RECAP_ACK` (``assistant``) so the
        pair never creates two consecutive ``user`` turns. Inserted right after the
        memory pair (or after the system turn for a memory-less agent).

        Args:
            text: The recap narrative.
        """
        recap = {"role": "user", "content": self._render_recap_turn(text)}
        ack = {"role": "assistant", "content": RECAP_ACK}
        index = self._recap_index()
        if self._recap_installed:
            self.lifecycle_history[index] = recap
            self.lifecycle_history[index + 1] = ack
        else:
            self.lifecycle_history[index:index] = [recap, ack]
            self._recap_installed = True

    @staticmethod
    def _render_recap_turn(text: str) -> str:
        """Frame the recap narrative as an in-world 'looking back' turn (no meta)."""
        body = text.strip() if text.strip() else "The recent past is a blur, but you carry on."
        return f"Looking back on how you came to be here:\n{body}"

    def _enforce_prompt_budget(self, tools: list[dict[str, Any]]) -> None:
        """Floor-overflow net: guarantee the prompt fits ``PROMPT_BUDGET_TOKENS``.

        Only reachable when the scaffolding (system + memory block) alone is large.
        Degrades in order: truncate the recap, then the in-context memory-block turn
        (keeping its HIGH-importance head), then drop the oldest whole breath-groups
        as a last resort. The durable memory store is never touched -- only the
        rendered in-context copies -- so the prompt is *always* made to fit.

        Args:
            tools: The action schemas (counted in the estimate).
        """
        if estimate_tokens(self.lifecycle_history, tools) <= PROMPT_BUDGET_TOKENS:
            return
        # 1. Shrink the recap turn until the whole prompt fits.
        if self._recap_installed and self._shrink_to_fit(self._recap_index(), tools):
            return
        # 2. Shrink the in-context memory-block turn (HIGH-importance lines lead).
        if self._resident_block_installed:
            fits = self._shrink_to_fit(1, tools)
            logger.critical(
                "Agent %r: in-context memory block truncated to fit the context window; "
                "consider lowering MEMORY_RESIDENT_CAP for this model",
                self.agent_id,
            )
            if fits:
                return
        # 3. Last resort: drop the oldest whole breath-groups (keep the tail on a user turn).
        prefix = self._prefix_len()
        while (
            estimate_tokens(self.lifecycle_history, tools) > PROMPT_BUDGET_TOKENS
            and len(self.lifecycle_history) > prefix + 1
        ):
            del self.lifecycle_history[prefix]
            while (
                len(self.lifecycle_history) > prefix
                and self.lifecycle_history[prefix].get("role") != "user"
            ):
                del self.lifecycle_history[prefix]
        # Final safeguard (the absolute never-overflow guarantee): after dropping whole
        # groups, a lone surviving turn -- or the scaffolding itself -- can still exceed
        # the budget. A huge perception is NOT bounded by the generation reserve, and an
        # over-large identity/memory-block is not bounded at all. Shrink turns newest
        # first (the system turn, which carries identity, is shrunk LAST and only as an
        # absolute last resort), returning the instant the whole prompt fits.
        for index in range(len(self.lifecycle_history) - 1, -1, -1):
            if estimate_tokens(self.lifecycle_history, tools) <= PROMPT_BUDGET_TOKENS:
                return
            self._shrink_to_fit(index, tools)
        # Only the tool schemas are unshrinkable. If they alone exceed the budget the
        # prompt cannot be made to fit -- a gross misconfiguration we log loudly rather
        # than silently overflow.
        if estimate_tokens(self.lifecycle_history, tools) > PROMPT_BUDGET_TOKENS:
            logger.critical(
                "Agent %r: tool schemas alone exceed PROMPT_BUDGET_TOKENS=%d; the prompt "
                "cannot be made to fit. Reduce the number or size of action schemas.",
                self.agent_id,
                PROMPT_BUDGET_TOKENS,
            )

    def _shrink_to_fit(self, index: int, tools: list[dict[str, Any]]) -> bool:
        """Halve the ``content`` of turn ``index`` until the whole prompt fits the budget.

        Geometric shrink (re-measuring the *whole* prompt each round, so JSON overhead
        and rounding are accounted for) converges fast and always terminates -- once a
        truncation stops making progress the field is dropped entirely.

        Args:
            index: The turn whose content to shrink.
            tools: The action schemas (counted in the estimate).

        Returns:
            ``True`` if the whole prompt now fits ``PROMPT_BUDGET_TOKENS``.
        """
        message = self.lifecycle_history[index]
        while estimate_tokens(self.lifecycle_history, tools) > PROMPT_BUDGET_TOKENS:
            content = str(message["content"])
            if not content:
                return False
            shrunk = truncate_to_tokens(content, max(0, estimate_tokens([message], []) // 2))
            if len(shrunk) >= len(content):  # no further progress -> drop it entirely
                message["content"] = ""
                return estimate_tokens(self.lifecycle_history, tools) <= PROMPT_BUDGET_TOKENS
            message["content"] = shrunk
        return True

    # ---- the breath & the loop -------------------------------------------

    async def breathe(self) -> None:
        """Take one breath: perceive, decide, execute, then refresh status.

        Only an ``ALIVE`` agent runs the full path (perceive -> budget -> decide ->
        execute -> reflect). A non-``ALIVE`` (paralysed) breath does **nothing but
        drain its inbox**: no perceive-append, no Ollama, no compaction. This keeps
        the loop alive so another agent can feed and revive it (Sprint 6) while
        spending zero inference on a frozen agent and keeping its queue bounded and
        its history from growing (which would otherwise create illegal consecutive
        ``user`` turns). :attr:`breath_count` is incremented exactly once, even if a
        step raises unexpectedly, so the run loop's budget always makes progress.

        Returns:
            None.
        """
        previous_status = self._status()
        try:
            if previous_status is AgentStatus.ALIVE:
                await self.perceive()
                # Bound the prompt BEFORE deciding -- the never-overflow guarantee.
                # Only ALIVE agents grow their history, so only they need the check.
                await self._ensure_context_budget(COMPACTION_TRIGGER_TOKENS)
                self._last_decide_failed = False
                decision = await self.decide()
                if decision is None:
                    self._last_decide_failed = True
                else:
                    self._last_prompt_tokens = decision.prompt_tokens  # actual-token net
                    await self.execute(decision.tool_calls)
                    # breath_count is incremented in the finally below, so during
                    # the k-th (1-indexed) breath it still holds k-1; +1 makes the
                    # reflection fire on breaths N, 2N, ... and never on the first.
                    # Gate on liveness too: a tool call may have paralysed the agent
                    # mid-breath, and a frozen agent must spend no Ollama (neither the
                    # reflection decide nor the recap-authoring one).
                    if self.alive and (self.breath_count + 1) % REFLECT_EVERY_N_BREATHS == 0:
                        await self.reflect()
                        # Reflection already re-prefilled the cache, so compact harder
                        # now (lower target) while it is "free" -- prefer reflection.
                        await self._ensure_context_budget(COMPACTION_TARGET_TOKENS)
            else:
                # Paralyzed: keep the loop alive to be revived; drain the inbox so the
                # queue stays bounded (events are missed while incapacitated). No
                # Ollama, no append. A paralyzed breath is not a failed decide, so clear
                # any stale flag from an earlier failed decide -- else run() would apply
                # the decide-backoff to every drain-only breath and starve inbox draining.
                self._last_decide_failed = False
                self.event_bus.get_events(self.agent_id)
            await self.refresh_status(previous_status)
        finally:
            self.breath_count += 1

    async def run(self, max_breaths: int | None = None, pace: float | None = None) -> None:
        """Breathe repeatedly while the agent is alive and budget remains.

        Loops ``breathe()`` then sleeps for :attr:`pace`, stopping when the agent
        is no longer ``ALIVE`` (e.g. paralysis), when it has been marked stopped,
        or when ``max_breaths`` is reached. The trailing sleep is skipped once the
        loop is about to stop. Per-breath exceptions are logged and the loop
        continues; a failed decision backs off (sleeps at least
        :data:`DECIDE_BACKOFF_SECONDS`) so a downed model never spins the loop.

        Args:
            max_breaths: Maximum number of breaths; ``None`` runs indefinitely.
            pace: Overrides :attr:`pace` for this run when given.

        Returns:
            None.
        """
        if pace is not None:
            self.pace = pace
        while self._can_continue(max_breaths):
            try:
                await self.breathe()
            except Exception:
                logger.exception("Unexpected error during a breath for agent %r", self.agent_id)
                self._last_decide_failed = True
            if not self._can_continue(max_breaths):
                break
            if self._last_decide_failed:
                delay = max(self.pace, DECIDE_BACKOFF_SECONDS)
            else:
                delay = self.pace
            await asyncio.sleep(delay)

    def _can_continue(self, max_breaths: int | None) -> bool:
        """Return whether the loop may take another breath.

        Only death (or an explicit stop) is terminal: a PARALYZED agent keeps
        breathing (drain-only) so it can be fed and revived (Sprint 6).
        """
        if self._stopped or self._status() is AgentStatus.DEAD:
            return False
        return max_breaths is None or self.breath_count < max_breaths

    # ---- helpers ----------------------------------------------------------

    def _call_id(self, tool_call: ToolCall, index: int) -> str:
        """Return the id pairing an assistant tool call with its ``tool`` result.

        Uses the provider-supplied id when present, otherwise synthesises a stable
        one from the breath and position. The same ``(tool_call, index)`` yields
        the same id in :meth:`decide` and :meth:`execute`, so pairing holds without
        mutating the (possibly shared) :class:`~agents.decider.ToolCall`.

        Args:
            tool_call: The tool call to identify.
            index: The call's position within the decision.

        Returns:
            The pairing id.
        """
        if tool_call.id is not None:
            return tool_call.id
        return f"{self.agent_id}-call-{self.breath_count}-{index}"

    def _assistant_message(self, decision: Decision) -> dict[str, Any]:
        """Render a decision as an ``assistant`` chat message.

        Args:
            decision: The decision to render.

        Returns:
            An ``assistant`` message dict; ``thinking`` and ``tool_calls`` keys are
            included only when present.
        """
        message: dict[str, Any] = {"role": "assistant", "content": decision.text}
        if decision.thinking:
            message["thinking"] = decision.thinking
        if decision.tool_calls:
            message["tool_calls"] = [
                {
                    "id": self._call_id(call, index),
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.params},
                }
                for index, call in enumerate(decision.tool_calls)
            ]
        return message

    def _rollback_perception(self) -> None:
        """Drop the trailing ``user`` perception turn (used when ``decide`` fails)."""
        if self.lifecycle_history and self.lifecycle_history[-1].get("role") == "user":
            self.lifecycle_history.pop()

    def _coerce_params(self, params: dict[str, Any]) -> dict[str, Any]:
        """Marshal model-supplied JSON params to the types tools expect (DD6).

        Ollama returns JSON with string keys/values; resource identifiers are
        coerced to :class:`~world.regions.ResourceTypes` -- both a ``resource_type``
        value and the keys of a ``resources`` mapping (the mating escrow keys on the
        enum). Unrecognised values are left untouched so the tool can return its own
        agent-facing ``Error:`` string.

        Args:
            params: The raw params from the tool call.

        Returns:
            A new params dict with resource identifiers coerced where possible.
        """
        coerced = dict(params)
        if "resource_type" in coerced:
            coerced["resource_type"] = self._coerce_resource(coerced["resource_type"])
        resources = coerced.get("resources")
        if isinstance(resources, dict):
            coerced["resources"] = {
                self._coerce_resource(key): value for key, value in resources.items()
            }
        return coerced

    @staticmethod
    def _coerce_resource(value: Any) -> Any:
        """Coerce ``value`` to a :class:`~world.regions.ResourceTypes` if possible."""
        if isinstance(value, ResourceTypes):
            return value
        try:
            return ResourceTypes(value)
        except (ValueError, KeyError):
            return value

    def _render_perception(self, events: list[Event]) -> str:
        """Render the agent's self-state, region, and recent events as narrative.

        Args:
            events: The drained events, already ordered chronologically.

        Returns:
            A single multi-line perception string for the ``user`` turn.
        """
        agent_state = self.world.get_agent(self.agent_id)
        if agent_state is None:
            return "All sensation has left you; you are no longer part of this world."

        lines: list[str] = ["You take stock of yourself and your surroundings.", "", "Within you:"]
        lines.append(f"- Energy: {agent_state.current_energy}")
        # Low-energy attack warning (Sprint 6 T5): if an attack would drop the agent
        # to/below the paralysis threshold, surface it so the model can decide
        # knowingly. Only meaningful while the agent is still able to act.
        if (
            agent_state.status is AgentStatus.ALIVE
            and agent_state.current_energy <= ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD
        ):
            lines.append(
                f"- ⚠️ Your energy is {agent_state.current_energy}; attacking costs "
                f"{ATTACK_ENERGY_COST} — you would be paralyzed."
            )
        lines.append(f"- Materials: {agent_state.current_materials}")
        lines.append(f"- Where you stand: {agent_state.current_position}")
        lines.append(f"- Condition: {agent_state.status.value}")

        region = self.world.get_region(agent_state.current_position)
        lines.append("")
        if region is not None:
            lines.append(f"Around you lies {region.name}: {region.description}")
            paths = ", ".join(region.connections) if region.connections else "nowhere from here"
            lines.append(f"- Paths lead to: {paths}")
            others = [
                self._describe_neighbor(other)
                for other in self.world.get_agents_in_region(region.name)
                if other.id != self.agent_id
            ]
            lines.append(f"- Also here: {', '.join(others) if others else 'no one else'}")
            lines.append(f"- Energy in this place: {region.current_energy}")
            lines.append(f"- Materials in this place: {region.current_materials}")
        else:
            lines.append("The place around you is indistinct.")

        lines.append("")
        if events:
            lines.append("Lately you have noticed:")
            lines.extend(f"- {self._render_event(event)}" for event in events)
        else:
            lines.append("Nothing else stirs nearby.")
        return "\n".join(lines)

    @staticmethod
    def _render_event(event: Event) -> str:
        """Render a single perceived event as a plain-narrative line."""
        message = event.payload.get("message") if isinstance(event.payload, dict) else None
        return str(message) if message else f"Something shifted nearby ({event.type})."

    @staticmethod
    def _describe_neighbor(other: AgentState) -> str:
        """Name a co-located agent, labelling the fallen and the dead.

        Corpses and paralysed agents are kept in the region (Sprint 6), so the
        perception must mark them rather than list them as ordinary neighbours -- a
        plain name invites the model to speak to the dead or feed a corpse.

        Args:
            other: A co-located agent (not the perceiving agent itself).

        Returns:
            The agent's name, suffixed ``(fallen)`` if PARALYZED or ``(dead)`` if DEAD.
        """
        match other.status:
            case AgentStatus.PARALYZED:
                return f"{other.name} (fallen)"
            case AgentStatus.DEAD:
                return f"{other.name} (dead)"
            case _:
                return other.name

    async def _announce_paralysis(self, agent_state: AgentState) -> None:
        """Emit the system ``agent_paralyzed`` event for an ``ALIVE -> PARALYZED`` flip.

        Args:
            agent_state: The agent that has just become paralysed (its region is
                used to scope the event so nearby beings perceive the collapse).
        """
        event = Event(
            type="agent_paralyzed",
            source="system",
            payload={"message": f"{agent_state.name} has collapsed and can no longer move."},
            scope=ScopeType.LOCAL,
            region=agent_state.current_position,
            timestamp=self.world.now(),
        )
        try:
            await self.event_bus.publish(event)
        except EventBusError:
            logger.exception("Failed to publish agent_paralyzed for agent %r", self.agent_id)

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
is the milestone's failure boundary -- on an ``ALIVE -> PARALYZED`` transition the
agent emits a system ``agent_paralyzed`` event (the agent holds the bus; the world
does not, per design DD4) and stops acting. ``DEAD`` also stops the loop (death
itself is Sprint 6).
"""

from __future__ import annotations

import asyncio
from typing import Any

from agents.decider import Decider, Decision, ToolCall
from agents.prompt import build_system_prompt
from agents.tool_schemas import schemas_for
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import DECIDE_BACKOFF_SECONDS
from core.exceptions import EventBusError, ToolError
from core.logging import get_logger
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState

logger = get_logger(__name__)

# DECIDE_BACKOFF_SECONDS is re-exported from core.constants (its one tuned home);
# imported here because the breathing loop applies it and tests reference it.
__all__ = ["DECIDE_BACKOFF_SECONDS", "Agent"]


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
        """
        self.agent_id: str = agent_id
        self.world: WorldState = world
        self.event_bus: EventBus = event_bus
        self.tool_registry: ToolRegistry = tool_registry
        self.decider: Decider = decider
        self.pace: float = pace

        # Renamed from "chat_history": these are the turns of a living being.
        self.lifecycle_history: list[dict[str, Any]] = []
        self.breath_count: int = 0
        self._stopped: bool = False
        self._last_decide_failed: bool = False

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

    # ---- setup ------------------------------------------------------------

    def _load_system_prompt(self) -> None:
        """Seed :attr:`lifecycle_history` with the agent's system prompt.

        The prompt is persona + tool affordances only (design DD9); no goals,
        strategy, or simulation language. A missing agent yields an empty persona
        (graceful degradation) rather than crashing construction.
        """
        agent_state = self.world.get_agent(self.agent_id)
        persona = agent_state.persona if agent_state is not None else ""
        prompt = build_system_prompt(persona, self._tool_names())
        self.lifecycle_history.append({"role": "system", "content": prompt})

    # ---- the four steps of a breath --------------------------------------

    async def perceive(self) -> None:
        """Drain the inbox and compose one ``user`` perception turn.

        Reads the agent's own state and its region directly from the world (rather
        than via ``look_around``, to avoid double-reporting) and renders the drained
        events as plain narrative ordered by timestamp. Appends a single ``user``
        message to :attr:`lifecycle_history`. No meta/simulation language is used.

        Returns:
            None. (Async for the breathing-loop interface and future perception
            I/O, e.g. Sprint-5 memory retrieval.)
        """
        events = self.event_bus.get_events(self.agent_id)
        events.sort(key=lambda event: event.timestamp)
        self.lifecycle_history.append({"role": "user", "content": self._render_perception(events)})

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
            tools = schemas_for(self._tool_names())
            decision = await self.decider.decide(self.lifecycle_history, tools)
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

        Args:
            tool_calls: The tool calls from the decision (possibly empty).

        Returns:
            None.
        """
        for index, tool_call in enumerate(tool_calls):
            call_id = self._call_id(tool_call, index)
            params = self._coerce_params(tool_call.params)
            try:
                result = await self.tool_registry.invoke(tool_call.name, self.agent_id, params)
            except ToolError as error:
                logger.warning(
                    "Tool %r failed for agent %r: %s", tool_call.name, self.agent_id, error
                )
                result = f"Nothing happened; the action {tool_call.name!r} could not be performed."
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
        and marks the loop to stop acting (paralysis is this milestone's failure
        boundary). ``DEAD`` also stops the loop (death is Sprint 6).

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
            self._stopped = True
            await self._announce_paralysis(agent_state)
        elif current_status is AgentStatus.DEAD:
            self._stopped = True

    # ---- the breath & the loop -------------------------------------------

    async def breathe(self) -> None:
        """Take one breath: perceive, decide, execute, then refresh status.

        A paralysed (or otherwise non-``ALIVE``) agent still perceives but does
        not decide or execute. :attr:`breath_count` is incremented exactly once,
        even if a step raises unexpectedly, so the run loop's budget always makes
        progress.

        Returns:
            None.
        """
        previous_status = self._status()
        try:
            await self.perceive()
            self._last_decide_failed = False
            if previous_status is AgentStatus.ALIVE:
                decision = await self.decide()
                if decision is None:
                    self._last_decide_failed = True
                else:
                    await self.execute(decision.tool_calls)
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
        """Return whether the loop may take another breath."""
        if self._stopped or not self.alive:
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
                other.name
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

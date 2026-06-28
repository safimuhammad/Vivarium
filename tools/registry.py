"""The :class:`ToolRegistry` -- name-keyed dispatch for the simulation's tools.

The registry is the single entry point through which an agent's chosen action is
executed: it maps a tool name to its implementation and invokes it against the
shared :class:`~world.world.WorldState` and :class:`~bus.event_bus.EventBus`.

Every registered tool follows the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` (see ``CLAUDE.md``
Section 3), so the registry can dispatch them generically.

Error model (see ``CLAUDE.md`` Section 4): the registry is *infrastructure*, so
genuine failures raise typed :class:`~core.exceptions.ToolError` (and are logged)
rather than being printed and swallowed:

* an unknown tool name, or an acting agent that does not exist, raises
  ``ToolError``;
* an unexpected exception from a tool body is logged and re-raised as a chained
  ``ToolError``.

Tool *logic* failures (bad params understood by the tool, rejected actions) are
**not** exceptions -- the tool returns an agent-facing result string instead.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from bus.event_bus import EventBus
from core.exceptions import ToolError
from core.logging import get_logger
from world.world import WorldState

logger = get_logger(__name__)

ToolFn = Callable[..., Awaitable[str]]
"""A registered tool: an async callable returning the agent-facing result string.

Concretely ``async def tool(world, event_bus, agent_id, **params) -> str``; typed
with an open argument list so every builtin's specific ``**params`` is accepted.
"""


class ToolRegistry:
    """Name-keyed registry that dispatches tool calls against the shared world.

    Attributes:
        world: The live world state passed to every invoked tool.
        event_bus: The bus passed to every invoked tool.
        tool_registry: Map of tool name -> async tool implementation.
    """

    def __init__(self, world: WorldState, event_bus: EventBus) -> None:
        """Initialise the registry.

        Args:
            world: The live :class:`~world.world.WorldState` tools mutate.
            event_bus: The :class:`~bus.event_bus.EventBus` tools publish to.
        """
        self.world: WorldState = world
        self.event_bus: EventBus = event_bus
        self.tool_registry: dict[str, ToolFn] = {}

    def register(self, name: str, func: ToolFn) -> None:
        """Register (or replace) a tool under ``name``.

        Mutates :attr:`tool_registry`.

        Args:
            name: The name agents use to select the tool.
            func: The async tool implementation following the uniform signature.

        Returns:
            None.
        """
        self.tool_registry[name] = func

    def list_tools(self) -> list[str]:
        """Return the names of all registered tools.

        Returns:
            A list of registered tool names (insertion order).
        """
        return list(self.tool_registry)

    async def invoke(self, name: str, agent_id: str, params: dict[str, Any]) -> str:
        """Invoke a registered tool on behalf of an agent and await its result.

        Looks up ``name``, verifies the acting agent exists, then awaits the tool
        with ``params`` splatted as keyword arguments. Side effects are entirely
        the tool's (world mutation + event publication).

        Args:
            name: Name of the tool to invoke.
            agent_id: Id of the acting agent (must exist in the world).
            params: Keyword arguments forwarded to the tool.

        Returns:
            The tool's agent-facing result string (including its own
            ``"Error: "`` / ``"Invalid: "`` logic-failure strings).

        Raises:
            ToolError: If ``name`` is not registered, if ``agent_id`` does not
                exist in the world, or if the tool body raises an unexpected
                exception (the original cause is chained and logged).
        """
        tool_fn = self.tool_registry.get(name)
        if tool_fn is None:
            logger.error("Unknown tool %r requested by agent %r", name, agent_id)
            raise ToolError(f"Unknown tool {name!r}")

        if self.world.get_agent(agent_id) is None:
            logger.error("Tool %r invoked for unknown agent %r", name, agent_id)
            raise ToolError(f"Cannot invoke tool {name!r} for unknown agent {agent_id!r}")

        try:
            return await tool_fn(self.world, self.event_bus, agent_id, **params)
        except ToolError:
            raise
        except Exception as exc:
            logger.exception("Tool %r raised unexpectedly for agent %r", name, agent_id)
            raise ToolError(f"Tool {name!r} failed during execution") from exc

"""Tests for :class:`tools.registry.ToolRegistry`.

The registry registers tools by name, lists them, and invokes them. ``invoke``
is **async** and awaits the (async) tool, returning its result string. Its error
handling follows the infrastructure layer: an unknown tool name or an unknown
acting agent raises :class:`~core.exceptions.ToolError`, and an unexpected
exception from a tool body is logged and re-raised as a chained ``ToolError``.
Tool *logic* failures are still returned as strings, never raised.
"""

from __future__ import annotations

from typing import Any

import pytest

from bus.event_bus import EventBus
from core.exceptions import ToolError
from tools.builtin import register_builtins
from tools.builtin.combat import attack
from tools.registry import ToolRegistry
from world.world import WorldState

# ---- register / list ------------------------------------------------------


def test_register_and_list_tools(registry: ToolRegistry) -> None:
    """Registered tool names are returned by ``list_tools``."""

    async def noop(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
        return "ok"

    assert registry.list_tools() == []
    registry.register("noop", noop)
    assert registry.list_tools() == ["noop"]


# ---- invoke happy path (awaits the coroutine) -----------------------------


async def test_invoke_awaits_tool_and_returns_result(registry: ToolRegistry) -> None:
    """``invoke`` awaits the tool body (it runs) and returns its string result."""
    calls: dict[str, Any] = {}

    async def recorder(world: WorldState, event_bus: EventBus, agent_id: str, value: int) -> str:
        calls["value"] = value
        calls["agent_id"] = agent_id
        return f"recorded {value}"

    registry.register("recorder", recorder)
    result = await registry.invoke("recorder", "wanderer_001", {"value": 7})

    assert result == "recorded 7"  # not an un-awaited coroutine
    assert calls == {"value": 7, "agent_id": "wanderer_001"}


async def test_invoke_passes_params_as_kwargs(registry: ToolRegistry, world: WorldState) -> None:
    """Params are splatted as kwargs into the tool (real builtin end-to-end)."""
    registry.register("attack", attack)
    result = await registry.invoke("attack", "wanderer_001", {"target": "wanderer_002"})
    assert result.startswith("Successfully Attacked")
    target = world.get_agent("wanderer_002")
    assert target is not None and target.current_energy < 100.0


# ---- invoke error handling (infrastructure layer raises) ------------------


async def test_invoke_unknown_tool_raises_toolerror(registry: ToolRegistry) -> None:
    """An unknown tool name is an infrastructure error -> ``ToolError``."""
    with pytest.raises(ToolError):
        await registry.invoke("does_not_exist", "wanderer_001", {})


async def test_invoke_unknown_agent_raises_toolerror(registry: ToolRegistry) -> None:
    """Invoking for an agent not in the world is an infrastructure error."""

    async def noop(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
        return "ok"

    registry.register("noop", noop)
    with pytest.raises(ToolError):
        await registry.invoke("noop", "ghost", {})


async def test_invoke_tool_raising_is_wrapped_and_chained(registry: ToolRegistry) -> None:
    """An unexpected exception in a tool becomes a chained ``ToolError``."""

    async def boom(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
        raise RuntimeError("kaboom")

    registry.register("boom", boom)
    with pytest.raises(ToolError) as excinfo:
        await registry.invoke("boom", "wanderer_001", {})
    assert isinstance(excinfo.value.__cause__, RuntimeError)


async def test_invoke_missing_required_param_returns_error_string(
    registry: ToolRegistry,
) -> None:
    """A missing required param is the agent's mistake -> clean perception string.

    A small local model routinely omits required params; this must not crash the
    tool (raw ``TypeError`` -> ``ToolError``) but feed the model a correctable
    ``"Error: ..."`` naming the missing param (CLAUDE.md §3).
    """
    registry.register("attack", attack)
    result = await registry.invoke("attack", "wanderer_001", {})  # missing 'target'
    assert result.startswith("Error:")
    assert "target" in result


async def test_invoke_drops_unknown_kwargs(registry: ToolRegistry) -> None:
    """Hallucinated extra kwargs are dropped so the tool still runs (the seed bug).

    The model emitting ``look_around(region=...)`` (a param the tool doesn't accept)
    must not crash it; the noise is dropped and the action executes normally.
    """
    register_builtins(registry)
    result = await registry.invoke("look_around", "wanderer_001", {"region": "alpha"})
    assert "alpha" in result  # ran successfully, returned perception (no raise)


async def test_invoke_tool_raising_toolerror_propagates_unwrapped(
    registry: ToolRegistry,
) -> None:
    """A ``ToolError`` from a tool propagates as-is (not re-wrapped/chained)."""
    sentinel = ToolError("from inside the tool")

    async def raiser(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
        raise sentinel

    registry.register("raiser", raiser)
    with pytest.raises(ToolError) as excinfo:
        await registry.invoke("raiser", "wanderer_001", {})
    assert excinfo.value is sentinel  # same object, not wrapped


async def test_invoke_tool_logic_failure_returns_string_not_raise(
    registry: ToolRegistry,
) -> None:
    """A tool *logic* failure is still a returned string, not an exception."""
    registry.register("attack", attack)
    # Valid acting agent, but the target does not exist -> agent-facing Error string.
    result = await registry.invoke("attack", "wanderer_001", {"target": "ghost"})
    assert result.startswith("Error:")


# ---- register_builtins ----------------------------------------------------


async def test_register_builtins_registers_all_tools(registry: ToolRegistry) -> None:
    """``register_builtins`` wires every builtin tool by its canonical name."""
    register_builtins(registry)
    expected = {
        "attack",
        "speak",
        "move",
        "look_around",
        "harvest_resources",
        "transfer_resource",
        "initiate_mating",
        "reject_mating",
        "accept_mating",
    }
    assert expected <= set(registry.list_tools())

    # A real builtin invoked through the async registry returns its string.
    result = await registry.invoke("look_around", "wanderer_001", {})
    assert "alpha" in result

"""Built-in Vivarium tools and a helper to register them all.

Each built-in tool follows the uniform closure signature
``async def tool(world, event_bus, agent_id, **params) -> str``. Use
:func:`register_builtins` to register every built-in under its canonical name on
a :class:`~tools.registry.ToolRegistry`.
"""

from __future__ import annotations

from tools.builtin.combat import attack
from tools.builtin.communication import speak
from tools.builtin.homes import build_home, leave_home, pledge_home, use_hearth
from tools.builtin.mating import accept_mating, initiate_mating, reject_mating
from tools.builtin.movement import look_around, move
from tools.builtin.resources import harvest_resources, transfer_resource
from tools.registry import ToolFn, ToolRegistry

__all__ = [
    "BUILTIN_TOOLS",
    "accept_mating",
    "attack",
    "build_home",
    "harvest_resources",
    "initiate_mating",
    "leave_home",
    "look_around",
    "move",
    "pledge_home",
    "register_builtins",
    "reject_mating",
    "speak",
    "transfer_resource",
    "use_hearth",
]

#: Canonical tool name -> implementation; the single source for the builtin set.
BUILTIN_TOOLS: dict[str, ToolFn] = {
    "attack": attack,
    "speak": speak,
    "move": move,
    "look_around": look_around,
    "harvest_resources": harvest_resources,
    "transfer_resource": transfer_resource,
    "initiate_mating": initiate_mating,
    "reject_mating": reject_mating,
    "accept_mating": accept_mating,
    "build_home": build_home,
    "use_hearth": use_hearth,
    "pledge_home": pledge_home,
    "leave_home": leave_home,
}


def register_builtins(registry: ToolRegistry) -> None:
    """Register every built-in tool on ``registry`` under its canonical name.

    Mutates the registry's tool map (see :data:`BUILTIN_TOOLS`).

    Args:
        registry: The :class:`~tools.registry.ToolRegistry` to populate.

    Returns:
        None.
    """
    for name, func in BUILTIN_TOOLS.items():
        registry.register(name, func)

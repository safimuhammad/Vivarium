"""Hand-authored Ollama function schemas for the built-in tools (design DD3).

Each built-in tool (see :data:`tools.builtin.BUILTIN_TOOLS`) has a corresponding
entry in :data:`TOOL_SCHEMAS` describing its callable signature in the Ollama /
OpenAI function-calling format. The schema *bodies* (parameter names, types, and
which are required) are authored by hand, but the schema *set* must stay in
lock-step with the built-in tool set: a parity test asserts
``set(TOOL_SCHEMAS) == set(tools.builtin.BUILTIN_TOOLS)``.

Resource-type parameters are constrained to the
:class:`world.regions.ResourceTypes` string values so the model can only request
known resources.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from core.constants import (
    ATTACK_DAMAGE,
    ATTACK_ENERGY_COST,
    BREAKIN_ENERGY_COST,
    BREAKIN_MATERIALS_COST,
    HEARTH_MATERIALS_PER_USE,
    HOME_BUILD_MATERIALS_COST,
    MATING_MAX_OFFSPRING,
    MATING_MIN_ENERGY_CONTRIBUTION,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    MOVE_ENERGY_COST,
    SPEAK_ENERGY_COST,
)
from world.regions import ResourceTypes

RESOURCE_ENUM: list[str] = [resource.value for resource in ResourceTypes]
"""Allowed string values for any resource-type parameter (from ResourceTypes)."""


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "look_around": {
        "type": "function",
        "function": {
            "name": "look_around",
            "description": (
                "Observe your current region: your own energy and materials, the "
                "region's resource pools and connections, and who else is present."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    "move": {
        "type": "function",
        "function": {
            "name": "move",
            "description": (
                "Travel to a directly connected region. Travelling costs you "
                f"{MOVE_ENERGY_COST:.0f} energy."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "Name of an adjacent region to travel to.",
                    },
                },
                "required": ["destination"],
            },
        },
    },
    "speak": {
        "type": "function",
        "function": {
            "name": "speak",
            "description": (
                "Say something. With no target, everyone in your region hears it; "
                "with a target, only that one being hears it. Speaking costs you "
                f"{SPEAK_ENERGY_COST:g} energy."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The words to say.",
                    },
                    "target": {
                        "type": "string",
                        "description": "Optional id of a single listener to whisper to.",
                    },
                },
                "required": ["message"],
            },
        },
    },
    "attack": {
        "type": "function",
        "function": {
            "name": "attack",
            "description": (
                "Strike another being in your region, draining "
                f"{ATTACK_DAMAGE:.0f} of their energy; striking costs you "
                f"{ATTACK_ENERGY_COST:.0f} energy. A blow that drops them below zero "
                "energy — or any blow against one already fallen — kills them, and you "
                "take ALL of their energy and materials as loot."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Id of the co-located being to strike.",
                    },
                },
                "required": ["target"],
            },
        },
    },
    "harvest_resources": {
        "type": "function",
        "function": {
            "name": "harvest_resources",
            "description": "Gather a resource from your current region into your own stores.",
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_type": {
                        "type": "string",
                        "enum": RESOURCE_ENUM,
                        "description": "Which resource to gather.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "How much of the resource to gather.",
                    },
                },
                "required": ["resource_type", "amount"],
            },
        },
    },
    "transfer_resource": {
        "type": "function",
        "function": {
            "name": "transfer_resource",
            "description": "Give some of a resource to another being in your region.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Id of the co-located recipient.",
                    },
                    "resource_type": {
                        "type": "string",
                        "enum": RESOURCE_ENUM,
                        "description": "Which resource to give.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "How much of the resource to give.",
                    },
                },
                "required": ["target", "resource_type", "amount"],
            },
        },
    },
    "initiate_mating": {
        "type": "function",
        "function": {
            "name": "initiate_mating",
            "description": (
                "Propose mating to another being in your region to bring a new being -- a "
                "child -- into the world. Commit energy and materials now (at least "
                f"{MATING_MIN_ENERGY_CONTRIBUTION:.0f} energy and "
                f"{MATING_MIN_MATERIALS_CONTRIBUTION:.0f} materials); they are returned if "
                "the proposal is rejected or times out. You may mate again only after a "
                f"cooldown, and only up to {MATING_MAX_OFFSPRING} children in all."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Id of the being to propose to.",
                    },
                    "message": {
                        "type": "string",
                        "description": "A message to send with the proposal.",
                    },
                    "resources": {
                        "type": "object",
                        "description": "Resources to commit, keyed by resource type.",
                        "properties": {
                            value: {
                                "type": "number",
                                "description": f"Amount of {value} to commit.",
                            }
                            for value in RESOURCE_ENUM
                        },
                    },
                },
                "required": ["target", "message", "resources"],
            },
        },
    },
    "reject_mating": {
        "type": "function",
        "function": {
            "name": "reject_mating",
            "description": (
                "Reject a pending mating proposal, returning the proposer's resources."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Id of the being whose proposal you are rejecting.",
                    },
                    "message": {
                        "type": "string",
                        "description": "A message to send with the rejection.",
                    },
                },
                "required": ["target", "message"],
            },
        },
    },
    "accept_mating": {
        "type": "function",
        "function": {
            "name": "accept_mating",
            "description": (
                "Accept a pending mating proposal from a being in your region, matching "
                "the energy and materials they committed; a new being -- a child -- is "
                "born to you both."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Id of the being whose proposal you are accepting.",
                    },
                    "message": {
                        "type": "string",
                        "description": "A message to send with the acceptance.",
                    },
                },
                "required": ["target", "message"],
            },
        },
    },
    "build_home": {
        "type": "function",
        "function": {
            "name": "build_home",
            "description": (
                "Raise a home of your own where you stand. It costs "
                f"{HOME_BUILD_MATERIALS_COST:.0f} materials, and you may hold only one home."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    "use_hearth": {
        "type": "function",
        "function": {
            "name": "use_hearth",
            "description": (
                "Rest at your home's hearth, burning up to "
                f"{HEARTH_MATERIALS_PER_USE:.0f} of your materials to recover energy. "
                "You must be where your home stands."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    "pledge_home": {
        "type": "function",
        "function": {
            "name": "pledge_home",
            "description": (
                "Pledge yourself to a home where you stand, joining it so you share its "
                "upkeep and may rest at its hearth. A home tended by more beings stands sounder."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "home_id": {
                        "type": "string",
                        "description": "Id of the home in your place to join.",
                    },
                },
                "required": ["home_id"],
            },
        },
    },
    "leave_home": {
        "type": "function",
        "function": {
            "name": "leave_home",
            "description": (
                "Give up your place in the home you share; you no longer share its upkeep "
                "or rest at its hearth."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    "deposit_to_home": {
        "type": "function",
        "function": {
            "name": "deposit_to_home",
            "description": (
                "Set some of your own materials into the shared store of the home you share, "
                "where you stand. What you set aside stays in the home's keeping until you "
                "draw it back out. A home grown heavy with a great store draws notice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "How many materials to set into the home's store.",
                    },
                },
                "required": ["amount"],
            },
        },
    },
    "withdraw_from_home": {
        "type": "function",
        "function": {
            "name": "withdraw_from_home",
            "description": (
                "Draw some materials back out of the shared store of the home you share, "
                "where you stand, into your own holding. You cannot draw out more than the "
                "home's store holds."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "How many materials to draw out of the home's store.",
                    },
                },
                "required": ["amount"],
            },
        },
    },
    "break_in": {
        "type": "function",
        "function": {
            "name": "break_in",
            "description": (
                "Force your way into a home in your place that is not your own. Each attempt "
                f"wears at its soundness and costs you {BREAKIN_ENERGY_COST:.0f} energy and "
                f"{BREAKIN_MATERIALS_COST:.0f} materials, spent whether or not it gives way. "
                "A home tended by many mends faster than one being can break it, so it takes "
                "several breaking in together to bring one down. When it gives way you take "
                "its store (thieve) or seize it for your own (colonize), as you intend."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_home": {
                        "type": "string",
                        "description": "Id of the home in your place to break into.",
                    },
                    "intent": {
                        "type": "string",
                        "enum": ["thieve", "colonize"],
                        "description": (
                            "Whether to take the home's store (thieve) or seize it (colonize)."
                        ),
                    },
                },
                "required": ["target_home", "intent"],
            },
        },
    },
    "scavenge_ruins": {
        "type": "function",
        "function": {
            "name": "scavenge_ruins",
            "description": (
                "Pick over the ruins of a fallen home in your place for what materials still lie "
                "in it, drawing some into your own holding. You cannot take more than the ruins "
                "hold."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_home": {
                        "type": "string",
                        "description": "Id of the ruins in your place to pick over.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "How many materials to draw from the ruins.",
                    },
                },
                "required": ["target_home", "amount"],
            },
        },
    },
}
"""Tool name -> Ollama function schema; its key set mirrors ``BUILTIN_TOOLS``."""


def schemas_for(names: Iterable[str]) -> list[dict[str, Any]]:
    """Return the schemas for the named tools, in iteration order.

    Args:
        names: Tool names to look up (e.g. the names a registry exposes).

    Returns:
        The matching schema objects from :data:`TOOL_SCHEMAS`, in the order of
        ``names``.

    Raises:
        KeyError: If any name has no schema (a programming error given the parity
            invariant; surfaced loudly rather than silently dropping a tool).
    """
    return [TOOL_SCHEMAS[name] for name in names]

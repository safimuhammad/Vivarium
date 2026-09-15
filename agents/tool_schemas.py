"""Hand-authored Ollama function schemas for the built-in tools (design DD3).

Each legacy built-in tool (see :data:`tools.builtin.BUILTIN_TOOLS`) has a
corresponding entry in :data:`TOOL_SCHEMAS`; Physical walking tools mirror
:data:`tools.builtin.SPATIAL_BUILTIN_TOOLS` in :data:`SPATIAL_TOOL_SCHEMAS`.
The schema *bodies* (parameter names, types, and which are required) are
authored by hand.  The two catalog-specific parity tests keep historical worlds
byte-stable while allowing a spatial run to expose its extra actions.

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

MATING_TOOL_NAME: str = "initiate_mating"
"""The one tool whose description embeds a per-run world rule (the offspring cap)."""


def initiate_mating_description(max_offspring: int) -> str:
    """Return the ``initiate_mating`` description for one run's offspring ceiling.

    The cap is enforced silently by the mating tools, so it has to be *stated* to be
    an incentive at all: a being that cannot see the ceiling cannot tell whether an
    offer it makes will even be allowed. A run that lowers the ceiling must therefore
    lower it in the description too, or the number the being reads is a lie.

    Args:
        max_offspring: The run's per-being offspring ceiling.

    Returns:
        The tool description text.
    """
    return (
        "Propose mating to another being in your region to bring a new being -- a "
        "child -- into the world. Commit energy and materials now (at least "
        f"{MATING_MIN_ENERGY_CONTRIBUTION:.0f} energy and "
        f"{MATING_MIN_MATERIALS_CONTRIBUTION:.0f} materials); they are returned if "
        "the proposal is rejected or times out. You may mate again only after a "
        f"cooldown, and only up to {max_offspring} children in all."
    )


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "look_around": {
        "type": "function",
        "function": {
            "name": "look_around",
            "description": (
                "Observe your current region: your own energy and materials, the "
                "region's resource pools and connections, and who else is present. "
                "This is private awareness only; it changes nothing and reaches no one else."
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
            "description": initiate_mating_description(MATING_MAX_OFFSPRING),
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
                "A home tended by many mends faster than one being can break it, so it seldom "
                "falls to one alone. When it gives way you take its store (thieve) or seize it "
                "for your own (colonize), as you intend."
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
                "in it, and draw some into your own holding. You cannot take more than the ruins "
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

SPATIAL_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "go_to": {
        "type": "function",
        "function": {
            "name": "go_to",
            "description": (
                "Walk toward a named place in your current region. The walk continues while "
                "you think, until you arrive, stop, or choose a different place."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "destination_id": {
                        "type": "string",
                        "description": "Id of a known place in your current region.",
                    },
                },
                "required": ["destination_id"],
            },
        },
    },
    "stop_moving": {
        "type": "function",
        "function": {
            "name": "stop_moving",
            "description": (
                "Come to rest at your current spot, cancelling any walking or regional journey."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
}
"""Physical walking schemas; their key set mirrors ``SPATIAL_BUILTIN_TOOLS``."""

_ALL_TOOL_SCHEMAS: dict[str, dict[str, Any]] = TOOL_SCHEMAS | SPATIAL_TOOL_SCHEMAS


def schemas_for(
    names: Iterable[str],
    *,
    max_offspring: int = MATING_MAX_OFFSPRING,
    spatial: bool = False,
) -> list[dict[str, Any]]:
    """Return the schemas for the named tools, in iteration order.

    When ``max_offspring`` is the repository default the shared
    :data:`TOOL_SCHEMAS` objects are returned unchanged, so the bytes an agent sees
    are identical to every run before this parameter existed. A run that lowered or
    raised the ceiling gets a *copy* of the ``initiate_mating`` schema carrying its
    own number (see :func:`initiate_mating_description`); the shared dict is never
    mutated, so concurrent runs cannot see each other's ceiling.

    Args:
        names: Tool names to look up (e.g. the names a registry exposes).
        max_offspring: This run's per-being offspring ceiling.
        spatial: Whether to describe physical walking and local hearing rules.

    Returns:
        The matching schema objects, in the order of ``names``.

    Raises:
        KeyError: If any name has no schema (a programming error given the parity
            invariant; surfaced loudly rather than silently dropping a tool).
    """
    ordered = list(names)  # ``names`` may be a one-shot iterator; it is read twice.
    schemas = [_ALL_TOOL_SCHEMAS[name] for name in ordered]
    result = []
    for name, schema in zip(ordered, schemas, strict=True):
        if name == MATING_TOOL_NAME and max_offspring != MATING_MAX_OFFSPRING:
            schema = _with_offspring_cap(schema, max_offspring)
        if spatial:
            schema = _with_spatial_rules(schema, name)
        result.append(schema)
    return result


def _with_spatial_rules(schema: dict[str, Any], name: str) -> dict[str, Any]:
    """Describe physical rules without mutating the shared legacy schema catalog."""
    descriptions = {
        "harvest_resources": (
            "Gather energy or materials into your stores only while stationary at a matching "
            "resource site. Your current observations state what is harvestable here and give "
            "destination IDs for matching sites. go_to starts a journey; harvesting requires "
            "arrival and does not move you. Arrival ends walking automatically; no separate "
            "stop_moving is needed. The amount must be positive and no greater than the current "
            "shared regional supply of that resource."
        ),
        "move": (
            "Travel to a connected region by walking to its exit "
            "and entering at the matching entrance. "
            f"Starting this journey costs {MOVE_ENERGY_COST:.0f} energy; repeating the same active "
            "destination keeps it without another charge. You remain here until arrival."
        ),
        "speak": (
            "Say something. Nearby beings within your local hearing range hear it; "
            "with a target, only that being receives the whisper. "
            f"Speaking costs {SPEAK_ENERGY_COST:g} energy."
        ),
    }
    if name not in descriptions:
        return schema
    return {**schema, "function": {**schema["function"], "description": descriptions[name]}}


def _with_offspring_cap(schema: dict[str, Any], max_offspring: int) -> dict[str, Any]:
    """Return a shallow copy of ``schema`` whose description states ``max_offspring``.

    Args:
        schema: The shared ``initiate_mating`` schema.
        max_offspring: This run's per-being offspring ceiling.

    Returns:
        A new schema dict; the shared one is left untouched.
    """
    function = dict(schema["function"])
    function["description"] = initiate_mating_description(max_offspring)
    return {**schema, "function": function}

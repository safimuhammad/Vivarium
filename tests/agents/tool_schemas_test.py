"""Tests for the hand-authored Ollama tool schemas (:mod:`agents.tool_schemas`).

Enforces the DD3 parity invariant (the schema *set* equals the built-in tool set)
and checks each schema is well-formed for the Ollama function-calling API, with
resource-type params constrained to the :class:`world.regions.ResourceTypes`
string values. Also enforces DD9 on the schema *descriptions* themselves: they are
assembled into the same system prompt as :data:`agents.prompt.WORLD_MECHANICS`, so
they must stay just as free of goal/strategy/simulation language.
"""

from __future__ import annotations

from typing import Any

from agents.tool_schemas import TOOL_SCHEMAS, schemas_for
from core.constants import (
    ATTACK_DAMAGE,
    ATTACK_ENERGY_COST,
    MOVE_ENERGY_COST,
    SPEAK_ENERGY_COST,
)
from tests.agents.prompt_test import FORBIDDEN_TERMS
from tools.builtin import BUILTIN_TOOLS
from world.regions import ResourceTypes

RESOURCE_VALUES: set[str] = {resource.value for resource in ResourceTypes}


def test_schema_set_matches_builtin_tools() -> None:
    assert set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)


def test_every_schema_is_well_formed() -> None:
    for name, schema in TOOL_SCHEMAS.items():
        assert schema["type"] == "function"
        function = schema["function"]
        assert function["name"] == name
        assert isinstance(function["description"], str)
        assert function["description"]
        params = function["parameters"]
        assert params["type"] == "object"
        assert isinstance(params["properties"], dict)
        assert isinstance(params["required"], list)
        for required in params["required"]:
            assert required in params["properties"]


def test_resource_type_params_constrained_to_enum() -> None:
    for name in ("harvest_resources", "transfer_resource"):
        props = TOOL_SCHEMAS[name]["function"]["parameters"]["properties"]
        assert set(props["resource_type"]["enum"]) == RESOURCE_VALUES


def test_schemas_for_returns_requested_schemas_in_order() -> None:
    names = ["speak", "move"]
    result: list[dict[str, Any]] = schemas_for(names)
    assert [schema["function"]["name"] for schema in result] == names


def test_costed_action_schemas_state_their_energy_cost() -> None:
    """move/speak/attack surface their real energy costs at the decision point (Finding 7).

    The figures are sourced from ``core.constants`` (not hand-typed) so the cost the
    model reasons against always matches the rule the tool actually enforces. harvest
    and transfer carry no per-action energy cost, so they advertise none.
    """
    move_desc = TOOL_SCHEMAS["move"]["function"]["description"]
    assert f"{MOVE_ENERGY_COST:.0f}" in move_desc

    speak_desc = TOOL_SCHEMAS["speak"]["function"]["description"]
    assert f"{SPEAK_ENERGY_COST:g}" in speak_desc

    attack_desc = TOOL_SCHEMAS["attack"]["function"]["description"]
    assert f"{ATTACK_DAMAGE:.0f}" in attack_desc
    assert f"{ATTACK_ENERGY_COST:.0f}" in attack_desc
    # The loot incentive must be visible to the agent (else a "kill for loot" test is
    # confounded — the agent can't choose a reward it doesn't know exists).
    assert "loot" in attack_desc.lower()


def test_no_schema_description_leaks_forbidden_dd9_language() -> None:
    """DD9 regression: no tool-schema description may leak goal/strategy/sim language.

    The tool affordance list is assembled into the same system prompt as
    :data:`agents.prompt.WORLD_MECHANICS` (see :func:`agents.prompt.build_system_prompt`),
    so a schema description is just as capable of corrupting the agent's authentic,
    unaware framing as the shared mechanics block is. Reuses the exact substring
    blocklist :mod:`tests.agents.prompt_test` enforces on ``WORLD_MECHANICS`` so the two
    DD9 guards can never silently drift apart, and scans EVERY schema so a future
    tool-schema edit can't reintroduce forbidden framing unnoticed.
    """
    for name, schema in TOOL_SCHEMAS.items():
        description = schema["function"]["description"].lower()
        for banned in FORBIDDEN_TERMS:
            assert banned not in description, f"{name!r} schema description leaks {banned!r}"

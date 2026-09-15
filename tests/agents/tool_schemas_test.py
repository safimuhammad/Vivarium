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

from agents.tool_schemas import SPATIAL_TOOL_SCHEMAS, TOOL_SCHEMAS, schemas_for
from core.constants import (
    ATTACK_DAMAGE,
    ATTACK_ENERGY_COST,
    MATING_MAX_OFFSPRING,
    MOVE_ENERGY_COST,
    SPEAK_ENERGY_COST,
)
from tests.agents.prompt_test import FORBIDDEN_TERMS
from tools.builtin import BUILTIN_TOOLS, SPATIAL_BUILTIN_TOOLS
from world.regions import ResourceTypes

RESOURCE_VALUES: set[str] = {resource.value for resource in ResourceTypes}


def test_schema_set_matches_builtin_tools() -> None:
    assert set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)
    assert set(SPATIAL_TOOL_SCHEMAS) == set(SPATIAL_BUILTIN_TOOLS)


def test_every_schema_is_well_formed() -> None:
    for name, schema in (TOOL_SCHEMAS | SPATIAL_TOOL_SCHEMAS).items():
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


def test_spatial_harvest_schema_states_site_and_arrival_rules() -> None:
    """Spatial harvesting cannot advertise region-wide access or implicit travel."""
    legacy = TOOL_SCHEMAS["harvest_resources"]["function"]["description"]
    schema = schemas_for(["harvest_resources"], spatial=True)[0]
    description = schema["function"]["description"]
    assert "stationary" in description
    assert "matching" in description
    assert "go_to" in description
    assert "does not move you" in description
    assert "supply" in description
    assert schemas_for(["harvest_resources"])[0]["function"]["description"] == legacy


def test_schemas_for_returns_requested_schemas_in_order() -> None:
    names = ["speak", "move"]
    result: list[dict[str, Any]] = schemas_for(names)
    assert [schema["function"]["name"] for schema in result] == names


def test_schemas_for_returns_spatial_schemas_when_the_registry_exposes_them() -> None:
    """Nirvana runs can request schemas outside the frozen legacy catalog."""
    names = ["go_to", "stop_moving"]
    result = schemas_for(names)
    assert [schema["function"]["name"] for schema in result] == names
    assert result[0] is SPATIAL_TOOL_SCHEMAS["go_to"]


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


def test_look_around_schema_states_private_read_only_consequence() -> None:
    desc = TOOL_SCHEMAS["look_around"]["function"]["description"].lower()
    assert "private awareness" in desc
    assert "changes nothing" in desc
    assert "reaches no one else" in desc


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
    for name, schema in (TOOL_SCHEMAS | SPATIAL_TOOL_SCHEMAS).items():
        description = schema["function"]["description"].lower()
        for banned in FORBIDDEN_TERMS:
            assert banned not in description, f"{name!r} schema description leaks {banned!r}"


def test_schemas_for_returns_the_shared_objects_at_the_default_offspring_cap() -> None:
    """Default runs must see byte-identical schemas: identity, not just equality."""
    schemas = schemas_for(["initiate_mating", "look_around"])
    assert schemas[0] is TOOL_SCHEMAS["initiate_mating"]
    assert schemas[1] is TOOL_SCHEMAS["look_around"]


def test_schemas_for_states_a_runs_own_offspring_ceiling() -> None:
    """The cap is enforced silently, so a run that lowers it must SAY the new number."""
    schemas = schemas_for(["initiate_mating"], max_offspring=2)
    description = schemas[0]["function"]["description"]
    assert "up to 2 children in all" in description
    assert schemas[0] is not TOOL_SCHEMAS["initiate_mating"]
    # The shared schema is never mutated -- another run must not inherit this ceiling.
    assert (
        f"up to {MATING_MAX_OFFSPRING} children in all"
        in TOOL_SCHEMAS["initiate_mating"]["function"]["description"]
    )


def test_schemas_for_leaves_other_tools_shared_when_the_ceiling_changes() -> None:
    schemas = schemas_for(["look_around", "initiate_mating"], max_offspring=9)
    assert schemas[0] is TOOL_SCHEMAS["look_around"]
    assert "up to 9 children in all" in schemas[1]["function"]["description"]

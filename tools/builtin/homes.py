"""Home tools: ``build_home`` (raise a private home) and ``use_hearth`` (burn
materials for energy at your home).

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting being's LLM (a success sentence,
``"Error: "`` for a lookup/precondition failure, ``"Invalid: "`` for a rule
violation). Home ids route through ``world.rng`` so a run is reproducible from a
seed. All world mutation goes through :class:`~world.world.WorldState` methods; the
tool only orchestrates and publishes the LOCAL event (the world holds no bus, DD4).
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import HOME_BUILD_MATERIALS_COST, HOME_MAX_INTEGRITY
from world.world import WorldState


async def build_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Raise a private home for the being in its current region.

    Mutates world state:
        * Deducts :data:`~core.constants.HOME_BUILD_MATERIALS_COST` from the being's
          materials, then stores a new home (owned by the being, at its current
          region, integrity :data:`~core.constants.HOME_MAX_INTEGRITY`) via
          :meth:`~world.world.WorldState.build_home`. The home id routes through
          ``world.rng`` so it is reproducible from the seed.

    Emits events:
        * One ``"home_built"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the builder, region = its current position, stamped ``world.now()``) so
          co-located beings perceive the new home.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the building being.

    Returns:
        A success sentence with the materials left; an ``"Error: "`` string if the
        being is unknown; an ``"Invalid: "`` string if it already owns a home or
        lacks the materials (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if world.home_of(agent_id) is not None:
        return "Invalid: You already have a home; you may hold only one."
    if agent.current_materials < HOME_BUILD_MATERIALS_COST:
        return (
            f"Invalid: You lack the materials to build a home "
            f"(need {HOME_BUILD_MATERIALS_COST:.0f}, you have {agent.current_materials})."
        )

    world.modify_agent_materials(agent_id, -HOME_BUILD_MATERIALS_COST)
    home_id = f"home_{world.rng.getrandbits(32):08x}"
    region = agent.current_position
    world.build_home(home_id, agent_id, region, built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    await event_bus.publish(
        Event(
            "home_built",
            agent_id,
            {"message": f"{agent.name} has raised a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return (
        f"You raise a home here. It cost you {HOME_BUILD_MATERIALS_COST:.0f} materials; "
        f"you have {agent.current_materials} left."
    )

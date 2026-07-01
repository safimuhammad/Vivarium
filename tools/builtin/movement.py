"""Movement tools: ``move`` (relocate) and ``look_around`` (read the region).

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting agent's LLM.

Note: ``move`` charges :data:`~core.constants.MOVE_ENERGY_COST` energy on a
successful relocation. It validates existence, adjacency and sufficient energy
*before* any mutation, and only deducts the cost once
:meth:`~world.world.WorldState.move_agent` has succeeded -- a failed move neither
relocates the agent nor charges it.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import MOVE_ENERGY_COST
from world.agents import describe_agent_brief
from world.world import WorldState


async def move(world: WorldState, event_bus: EventBus, agent_id: str, destination: str) -> str:
    """Move an agent to a directly connected region.

    Mutates world state:
        * On success, updates the agent's ``current_position`` to ``destination``
          (delegated to :meth:`~world.world.WorldState.move_agent`, which enforces
          region adjacency) and deducts
          :data:`~core.constants.MOVE_ENERGY_COST` from the agent's energy. All
          preconditions (existence, sufficient energy, adjacency) are checked
          before any mutation; on failure nothing is moved or charged.

    Emits events:
        * On success, two :attr:`~bus.events.ScopeType.LOCAL` events stamped with
          ``world.now()``: ``"agent_left_region"`` scoped to the origin region and
          ``"agent_entered_region"`` scoped to the destination region.

    Args:
        world: The live world state.
        event_bus: The bus the resulting events are published to.
        agent_id: Id of the agent to move.
        destination: Name of the destination region.

    Returns:
        A success sentence on a completed move; an ``"Error: "`` string if the
        agent or destination region is unknown; an ``"Invalid: "`` string if the
        agent lacks the energy for the move cost or the destination is not
        reachable from the agent's current region.
    """
    agent_state = world.get_agent(agent_id)
    destination_region = world.get_region(destination)
    if not agent_state or not destination_region:
        return "Error: Cannot move, the agent or destination region does not exist."
    current_pos = agent_state.current_position

    if agent_state.current_energy < MOVE_ENERGY_COST:
        return (
            f"Invalid: Cannot move to {destination_region.name}, energy "
            f"{agent_state.current_energy} is below the move cost of {MOVE_ENERGY_COST}."
        )

    if not world.move_agent(agent_id, destination_region.name):
        return (
            f"Invalid: Cannot move to {destination_region.name}, "
            f"it is not reachable from {current_pos}."
        )

    world.modify_agent_energy(agent_id, -MOVE_ENERGY_COST)

    left_event = Event(
        type="agent_left_region",
        source=agent_state.id,
        region=current_pos,
        payload={
            "message": (
                f"{agent_state.name} has left the region {current_pos}\n"
                f" Currently en route to {destination_region.name}"
            )
        },
        scope=ScopeType.LOCAL,
        timestamp=world.now(),
    )
    await event_bus.publish(left_event)
    enter_event = Event(
        type="agent_entered_region",
        source=agent_state.id,
        region=destination_region.name,
        payload={
            "message": (
                f"{agent_state.name} has entered the region {destination_region.name}\n"
                f" Migrated from {current_pos}"
            )
        },
        scope=ScopeType.LOCAL,
        timestamp=world.now(),
    )
    await event_bus.publish(enter_event)
    return f"Agent Moved from {current_pos} to {destination_region.name} Successfully"


async def look_around(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Return a status dashboard of the agent and its current region.

    Mutates world state:
        * Nothing (read-only perception).

    Emits events:
        * Nothing.

    Args:
        world: The live world state.
        event_bus: Unused; present for the uniform tool signature.
        agent_id: Id of the observing agent.

    Returns:
        A multi-line dashboard of the agent's resources and the region's state
        (pools, connections, other agents present), or an ``"Error: "`` string if
        the agent or its region cannot be found. When the agent holds a stake in a
        home standing in its current region, an extra line reports that home's
        vault balance (L2b) -- a co-located being's own store, only.
    """
    agent_state = world.get_agent(agent_id)
    if agent_state is None:
        return "Error: Cannot look around, agent does not exist."
    region_state = world.get_region(agent_state.current_position)
    if region_state is None:
        return f"Error: Cannot look around, region {agent_state.current_position!r} does not exist."

    agents_nearby = world.get_agents_in_region(agent_state.current_position)
    # Describe each neighbour the same way the breathing-loop perception does
    # (Finding 6): name, id, energy/materials, and a (fallen)/(dead) marker. A bare
    # name forced the agent to guess who was a viable partner or a weak target, and
    # left it unable to address anyone in a targeted action.
    others = "; ".join(
        describe_agent_brief(agent) for agent in agents_nearby if agent.id != agent_id
    )
    # Show the being its OWN home's vault when it stands where that home stands (L2b): the
    # depositor perceives its store here; others perceive a heavy vault via the world-table
    # and the home_started_hoarding announcement.
    home = world.stakeholder_home_of(agent_id)
    home_line = ""
    if home is not None and home.region == agent_state.current_position:
        home_line = f"Your home here| its store holds {home.vault_materials} materials\n"
    return (
        f"YOUR CURRENT STATUS\n"
        f"Energy| {agent_state.current_energy}\n"
        f"Materials| {agent_state.current_materials}\n"
        f"World INFORMATION\n"
        f"Region| {region_state.name} - {region_state.description}\n"
        f"Energy pool| {region_state.current_energy}\n"
        f"Materials pool| {region_state.current_materials}\n"
        f"Connections| {','.join(region_state.connections)}\n"
        f"Agents present| {others}\n"
        f"{home_line}"
    )

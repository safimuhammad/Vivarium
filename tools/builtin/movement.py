"""Movement tools for regional relocation and optional spatial travel.

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
from world.agents import AgentState, AgentStatus, describe_agent_brief
from world.homes import HomeStatus, home_is_hoarding, max_integrity
from world.spatial import (
    SpatialNavigationError,
    SpatialNavigationEvent,
    SpatialPoint,
    SpatialRouteUnavailable,
    SpatialTravel,
    SpatialWorld,
    spatial_travel_event_payload,
)
from world.world import WorldState


async def go_to(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    destination_id: str,
) -> str:
    """Start a persistent route toward a named site in the agent's mapped region.

    Mutates world state:
        * Creates or replaces the acting agent's :class:`~world.spatial.SpatialTravel`
          inside the agent's current regional map. Repeating the same active site
          changes nothing.

    Emits events:
        * A LOCAL ``"spatial_travel_started"`` event for a new journey.
        * A LOCAL ``"spatial_travel_cancelled"`` event first when a different
          destination replaces an active journey.

    Args:
        world: The live world state.
        event_bus: Shared bus for significant movement transitions.
        agent_id: Id of the being that wants to travel.
        destination_id: Stable exported landmark id.

    Returns:
        A natural-language success, already-moving, or already-arrived sentence;
        an ``"Error: "`` string for unknown entities; or an ``"Invalid: "`` string
        for an unavailable map, a non-spatial region, an incapacitated being, or a
        blocked route.
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot travel, agent {agent_id!r} does not exist."
    if agent.status is not AgentStatus.ALIVE:
        return f"Invalid: Cannot begin a journey while {agent.status.value}."
    spatial = world.spatial_for_agent(agent_id)
    if spatial is None:
        return "Invalid: This place has no shared walkable map for you to follow."
    now = world.now()
    try:
        outcome = spatial.begin_travel(agent_id, destination_id, now)
    except SpatialRouteUnavailable as exc:
        return f"Invalid: Cannot reach {destination_id!r}; {exc}"
    except SpatialNavigationError as exc:
        return f"Error: Cannot begin travel; {exc}"

    destination = spatial.get_landmark(destination_id)
    assert destination is not None  # begin_travel validates this destination before returning.
    if outcome.status == "already_traveling":
        return f"Already travelling to {destination.name}."
    if outcome.status == "already_at_destination":
        return f"Already at {destination.name}."
    assert outcome.travel is not None
    if outcome.cancelled is not None:
        await _publish_spatial_transition(
            event_bus,
            spatial,
            outcome.cancelled,
        )
    await _publish_spatial_started(
        event_bus,
        spatial,
        agent_id=agent_id,
        travel=outcome.travel,
        position=outcome.position,
        timestamp=now,
    )
    return f"Started travelling to {destination.name}."


async def stop_moving(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Stop the acting agent's spatial journey at its interpolated current position.

    Mutates world state:
        * Cancels the agent's active regional-map travel and stores its exact
          continuous coordinate as the new durable position.

    Emits events:
        * One LOCAL ``"spatial_travel_cancelled"`` event when a journey was active.

    Args:
        world: The live world state.
        event_bus: Shared bus for the significant stop transition.
        agent_id: Id of the being stopping.

    Returns:
        A sentence confirming the exact stop or explaining why no route could stop.
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot stop, agent {agent_id!r} does not exist."
    spatial = world.spatial_for_agent(agent_id)
    if spatial is None:
        return "Invalid: You are not on a shared walkable map."
    event = spatial.cancel_travel(agent_id, world.now(), reason="stopped")
    if event is None:
        return "You are not currently travelling."
    await _publish_spatial_transition(event_bus, spatial, event)
    return "Came to rest at your current position."


async def _publish_spatial_started(
    event_bus: EventBus,
    spatial: SpatialWorld,
    *,
    agent_id: str,
    travel: SpatialTravel,
    position: SpatialPoint,
    timestamp: float,
    message: str | None = None,
    payload_updates: dict[str, object] | None = None,
) -> None:
    """Publish the one event that starts an observed spatial journey."""
    payload = spatial_travel_event_payload(
        spatial,
        travel,
        position=position,
        spatial_state=spatial.position_at(agent_id, timestamp),
        message=message or f"{agent_id} begins walking toward {travel.destination_id}.",
    )
    if payload_updates is not None:
        payload.update(payload_updates)
    await event_bus.publish(
        Event(
            "spatial_travel_started",
            agent_id,
            payload,
            scope=ScopeType.LOCAL,
            region=spatial.region_id,
            timestamp=timestamp,
        )
    )


async def _publish_spatial_transition(
    event_bus: EventBus,
    spatial: SpatialWorld,
    transition: SpatialNavigationEvent,
) -> None:
    """Publish an already-finalized cancellation or arrival transition."""
    event_type = (
        "spatial_travel_cancelled"
        if transition.kind == "travel_cancelled"
        else "spatial_travel_arrived"
    )
    destination = spatial.get_landmark(transition.travel.destination_id)
    message = (
        f"{transition.agent_id} came to rest."
        if transition.kind == "travel_cancelled"
        else (
            f"{transition.agent_id} arrived at "
            f"{destination.name if destination else transition.travel.destination_id}."
        )
    )
    if transition.kind == "travel_cancelled":
        spatial_state = spatial.snapshot_at_position(
            transition.position,
            transition.timestamp,
            travel=None,
        )
    else:
        spatial_state = spatial.position_at(transition.agent_id, transition.timestamp)
    payload = spatial_travel_event_payload(
        spatial,
        transition.travel,
        position=transition.position,
        spatial_state=spatial_state,
        message=message,
        reason=transition.reason,
    )
    await event_bus.publish(
        Event(
            event_type,
            transition.agent_id,
            payload,
            scope=ScopeType.LOCAL,
            region=spatial.region_id,
            timestamp=transition.timestamp,
        )
    )


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

    # A connection touching an authored map must use its explicit gates.  The
    # compatibility relocation below remains only for entirely unmapped edges;
    # it must never hide a malformed or missing regional threshold.
    if (
        world.spatial_for_region(current_pos) is not None
        or world.spatial_for_region(destination_region.name) is not None
    ):
        return await _move_through_authored_gates(
            world,
            event_bus,
            agent_state,
            destination_region.name,
        )

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

    # Pre-mutation snapshot for the renderer (spec §4.2): both events report the
    # mover's energy after the move cost, so the "before" side is read here.
    agent_energy_before = agent_state.current_energy
    world.modify_agent_energy(agent_id, -MOVE_ENERGY_COST)

    left_event = Event(
        type="agent_left_region",
        source=agent_state.id,
        region=current_pos,
        payload={
            "agent_id": agent_state.id,
            "from_region": current_pos,
            "to_region": destination_region.name,
            "move_energy_cost": MOVE_ENERGY_COST,
            "agent_energy_before": agent_energy_before,
            "agent_energy": agent_state.current_energy,
            "message": (
                f"{agent_state.name} has left the region {current_pos}\n"
                f" Currently en route to {destination_region.name}"
            ),
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
            "agent_id": agent_state.id,
            "from_region": current_pos,
            "to_region": destination_region.name,
            "move_energy_cost": MOVE_ENERGY_COST,
            "agent_energy_before": agent_energy_before,
            "agent_energy": agent_state.current_energy,
            "message": (
                f"{agent_state.name} has entered the region {destination_region.name}\n"
                f" Migrated from {current_pos}"
            ),
        },
        scope=ScopeType.LOCAL,
        timestamp=world.now(),
    )
    await event_bus.publish(enter_event)
    return f"Agent Moved from {current_pos} to {destination_region.name} Successfully"


async def _move_through_authored_gates(
    world: WorldState,
    event_bus: EventBus,
    agent: AgentState,
    destination: str,
) -> str:
    """Start one map-backed inter-region journey and charge it once.

    The actual migration occurs only when the navigator later observes arrival
    at the source departure gate.  This helper intentionally publishes no
    legacy left/entered pair at intent time: those lifecycle events represent
    the exact completed gate handoff.
    """
    if agent.status is not AgentStatus.ALIVE:
        return f"Invalid: Cannot begin a journey while {agent.status.value}."
    source = agent.current_position
    energy_before = agent.current_energy
    try:
        outcome = world.begin_region_travel(
            agent.id,
            destination,
            move_energy_cost=MOVE_ENERGY_COST,
        )
    except SpatialRouteUnavailable as exc:
        return f"Invalid: Cannot reach {destination!r}; {exc}"
    except SpatialNavigationError as exc:
        return f"Invalid: Cannot move to {destination}, {exc}"

    if outcome.status == "already_traveling":
        return f"Already travelling to {destination}."
    # A regional gate journey intentionally remains a travel record even when
    # its departure coordinate is the current position, so completion still
    # passes through the same atomic gate handoff and lifecycle events.
    assert outcome.status == "started"
    assert outcome.travel is not None
    spatial = world.spatial_for_agent(agent.id)
    assert spatial is not None
    if outcome.cancelled is not None:
        await _publish_spatial_transition(event_bus, spatial, outcome.cancelled)
    await _publish_spatial_started(
        event_bus,
        spatial,
        agent_id=agent.id,
        travel=outcome.travel,
        position=outcome.position,
        timestamp=world.now(),
        message=f"{agent.name} begins walking from {source} toward {destination}.",
        payload_updates={
            "from_region": source,
            "to_region": destination,
            "move_energy_cost": MOVE_ENERGY_COST,
            "agent_energy_before": energy_before,
            "agent_energy": agent.current_energy,
        },
    )
    return f"Started travelling from {source} to {destination}."


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
        vault balance (L2b) -- a co-located being's own store, only. Additionally
        reports every OTHER co-located home the agent does NOT stake -- a STANDING
        one's id/owner/soundness plus a hoard FLAG (never the exact vault, which
        stays own-home-only), and a co-located RUIN's scavengeable remnant (L2c) --
        so a being can choose a raid or scavenge target.
    """
    agent_state = world.get_agent(agent_id)
    if agent_state is None:
        return "Error: Cannot look around, agent does not exist."
    if world.spatial_for_agent(agent_id) is not None:
        # Use the same one-shot physical renderer as the breathing-loop
        # perception. It remains read-only and intentionally does not commit its
        # short-lived comparison state.
        from agents.spatial_perception import SpatialAwareness

        return SpatialAwareness(world, agent_id).render(world.now())
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

    # Raider/scavenger perception (Fork F): co-located homes the being does NOT stake show
    # soundness + a hoard FLAG (never the exact vault -- that stays own-home-only, 2b); ruins show
    # their remnant so a passer-by can choose to pick them over.
    other_home_lines: list[str] = []
    for other in world.homes_in_region(agent_state.current_position):
        if world.is_stakeholder(other.home_id, agent_id):
            continue  # the being's own home is already shown above, with its exact vault
        if other.status is HomeStatus.STANDING:
            cap = max_integrity(len(other.stakeholders))
            flag = " — it holds a great store" if home_is_hoarding(other) else ""
            other_home_lines.append(
                f"A home here you do not tend| {other.home_id}, kept by {other.owner_id}, "
                f"soundness {other.integrity:.1f}/{cap:.1f}{flag}"
            )
        else:  # RUIN
            other_home_lines.append(
                f"Ruins here| {other.home_id}, {other.remnant_materials:.1f} materials left to "
                f"pick over"
            )
    other_homes = "".join(f"{line}\n" for line in other_home_lines)
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
        f"{other_homes}"
    )

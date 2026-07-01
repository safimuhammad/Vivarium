"""Home tools: ``build_home`` (raise a private home), ``use_hearth`` (burn
materials for energy at a home you share), ``pledge_home`` (join another's home as a
stakeholder), and ``leave_home`` (give up a stake, voluntarily).

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
from core.constants import (
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.resources import _announce_if_started_hoarding
from world.agents import AgentStatus, is_hoarding
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


async def use_hearth(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Rest at the hearth of a home the being shares, burning materials to recover energy.

    Any stakeholder (owner or pledged) may use the hearth (widened from L1's owner-only).
    The fuel is unchanged: it burns the being's OWN materials (conservation — a shared home
    is never a vault-fuelled fountain).

    An active, elected act (a tool) — NOT passive rest — so it does not age the breath
    and only an ALIVE being can choose it (paralysis stays social: a fallen being still
    needs a friend's ``transfer_resource``, never a self-revive at the hearth).

    Recipe (conservation): ``burned = min(materials, HEARTH_MATERIALS_PER_USE)``; the
    materials are DESTROYED first, then the energy they convert to is credited
    (``burned * HEARTH_ENERGY_PER_MATERIAL``), so energy is only ever minted from fuel
    actually consumed.

    Mutates world state:
        * Deducts ``burned`` from the being's materials, then adds
          ``burned * HEARTH_ENERGY_PER_MATERIAL`` to its energy (both via the world's
          flooring methods).

    Emits events:
        * One ``"hearth_used"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the being, region = its current position, stamped ``world.now()``).
        * One ``"agent_started_hoarding"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, stamped with the region and
          ``world.now()``) **only** when this hearth use lifts the being over a
          hoarding threshold (see :func:`~world.agents.is_hoarding`), so co-located
          beings perceive the new hoarder. Only the crossing is announced.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the being resting at its hearth.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being
        is unknown or belongs to no home; an ``"Invalid: "`` string if it is fallen,
        not where its home stands, or holds no materials to burn (rejected calls
        mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot rest at a hearth; "
            "only another being can restore you."
        )
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to rest in."
    if home.region != agent.current_position:
        return "Invalid: You are not where your home stands; you can rest at its hearth only there."
    if agent.current_materials <= 0.0:
        return "Invalid: You have no materials to burn at the hearth."

    # Snapshot hoarding state before ANY mutation below (burn or credit) so we can
    # detect a *crossing* into hoarding, mirroring harvest_resources/transfer_resource.
    # Snapshotting later (e.g. after the burn) would false-positive: an agent already
    # hoarding on materials (>= threshold) whose burn drops materials back under the
    # threshold while the energy credit crosses 500 never actually stopped hoarding,
    # so it must not be re-announced as "started".
    was_hoarding = is_hoarding(agent)

    burned = min(agent.current_materials, HEARTH_MATERIALS_PER_USE)
    world.modify_agent_materials(agent_id, -burned)  # destroy the fuel FIRST (conservation)
    gained = burned * HEARTH_ENERGY_PER_MATERIAL
    world.modify_agent_energy(agent_id, gained)  # THEN credit the energy it converts to
    region = agent.current_position
    await event_bus.publish(
        Event(
            "hearth_used",
            agent_id,
            {"message": f"{agent.name} rests at the hearth, kindling materials into warmth."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )

    # If burning materials for energy just lifted the being over a hoarding
    # threshold, announce it LOCALLY so co-located beings perceive the new hoarder
    # (mirrors harvest_resources/transfer_resource). Only the crossing is announced.
    await _announce_if_started_hoarding(
        event_bus,
        agent,
        was_hoarding=was_hoarding,
        region=region,
        timestamp=world.now(),
    )
    return (
        f"You rest at your hearth, burning {burned} materials for {gained} energy. "
        f"Energy: {agent.current_energy}, Materials: {agent.current_materials}."
    )


async def pledge_home(world: WorldState, event_bus: EventBus, agent_id: str, home_id: str) -> str:
    """Pledge the being to a home where it stands, joining it as a stakeholder.

    A shared home is tended by many: a pledged being shares the home's upkeep (the tick
    draws upkeep across all stakeholders) and gains hearth access (``use_hearth``). Joining
    also raises the home's integrity ceiling (:func:`~world.homes.max_integrity`), so a
    well-peopled home is harder to wear down.

    Mutates world state:
        * Adds the being to the home's :attr:`~world.homes.Home.stakeholders` via
          :meth:`~world.world.WorldState.add_stakeholder`.

    Emits events:
        * One ``"home_joined"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source = the
          pledger, region = the home's region, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the pledging being.
        home_id: Id of the home (in the being's place) to join.

    Returns:
        A success sentence; an ``"Error: "`` string if the being or the home is unknown;
        an ``"Invalid: "`` string if the being is fallen, not where the home stands, or
        already belongs to a home (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot pledge to a home; "
            "only another being can restore you."
        )
    home = world.get_home(home_id)
    if home is None:
        return "Error: There is no such home here to pledge to."
    if home.region != agent.current_position:
        return (
            "Invalid: You are not where that home stands; you can only join a home in your place."
        )
    if world.stakeholder_home_of(agent_id) is not None:
        return "Invalid: You already belong to a home; you may share only one."

    world.add_stakeholder(home_id, agent_id)
    region = agent.current_position
    await event_bus.publish(
        Event(
            "home_joined",
            agent_id,
            {"message": f"{agent.name} has pledged to a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return (
        "You pledge yourself to this home; you now share its keep and may rest at its hearth. "
        f"{len(home.stakeholders)} beings tend it now."
    )


async def leave_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Give up the being's stake in the home it shares (voluntary departure).

    The being renounces its place: it stops sharing the home's upkeep and loses hearth
    access. Departure follows the same rule as death — if the leaver owned the home and
    other stakeholders remain, the lowest-id survivor is promoted to owner; the home's
    integrity is clamped down to the smaller :func:`~world.homes.max_integrity`. A home
    whose last stakeholder leaves is left ownerless-in-practice and decays via the world-tick
    (spec §6). The vault/structure is unaffected (no vault in 2a; ruins are 2c).

    Mutates world state:
        * Removes the being from the home's :attr:`~world.homes.Home.stakeholders`,
          promoting a new owner and clamping integrity, via
          :meth:`~world.world.WorldState.remove_stakeholder`.

    Emits events:
        * One ``"home_left"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source = the
          leaver, region = the home's region, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the departing being.

    Returns:
        A success sentence; an ``"Error: "`` string if the being is unknown or belongs to
        no home (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You do not belong to any home to leave."

    region = home.region
    world.remove_stakeholder(home.home_id, agent_id)  # prune + promote owner + clamp integrity
    await event_bus.publish(
        Event(
            "home_left",
            agent_id,
            {"message": f"{agent.name} has left a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return "You give up your place in this home; its keep and hearth are no longer yours."

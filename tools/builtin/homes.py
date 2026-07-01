"""Home tools: ``build_home`` (raise a private home), ``use_hearth`` (burn
materials for energy at a home you share), ``pledge_home`` (join another's home as a
stakeholder), ``leave_home`` (give up a stake, voluntarily), ``deposit_to_home``
(bank personal materials into the home's shared vault), ``withdraw_from_home``
(draw materials back out of the vault into personal stock), and ``break_in`` (a
co-located non-stakeholder pays a pure-sink cost to wear at a STANDING home's
integrity, breaching it at ``<= 0``; a ``"thieve"`` breach splits the vault among
co-located living breachers and leaves the home STANDING at ~0 (Task 4a), while a
``"colonize"`` breach still falls through to the plain breach sentence until Task 4b).

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
    BREAKIN_ENERGY_COST,
    BREAKIN_INTEGRITY_DAMAGE,
    BREAKIN_MATERIALS_COST,
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.resources import _announce_if_started_hoarding, _coerce_positive_amount
from world.agents import AgentStatus, is_hoarding
from world.homes import Home, HomeStatus, home_is_hoarding
from world.world import WorldState


async def _announce_if_home_started_hoarding(
    event_bus: EventBus,
    home: Home,
    *,
    was_hoarding: bool,
    source: str,
    region: str,
    timestamp: float,
) -> None:
    """Publish a LOCAL ``home_started_hoarding`` event iff this deposit crossed the threshold.

    The home-level mirror of :func:`~tools.builtin.resources._announce_if_started_hoarding`:
    a vault that becomes a hoard by a deposit is announced once, the moment it crosses, so
    co-located beings perceive the new raid target (spec §12, fork 3 — the hoard-signal moves
    agent -> home, no laundering). Does nothing if the home was already hoarding or is still
    below the threshold. Only the crossing is announced (there is no "stopped hoarding" event).

    Args:
        event_bus: The bus the event is published to.
        home: The credited home (its ``vault_materials`` already reflects the deposit).
        was_hoarding: Whether the home was hoarding *before* the deposit.
        source: Id of the being that made the deposit (the event's source).
        region: Region to scope the LOCAL announcement to.
        timestamp: World-clock stamp for the event.

    Returns:
        None.
    """
    if was_hoarding or not home_is_hoarding(home):
        return
    await event_bus.publish(
        Event(
            "home_started_hoarding",
            source,
            {
                "message": (
                    f"The home {home.home_id} in {region} is now sitting on a great store "
                    f"of materials (vault {home.vault_materials})."
                )
            },
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=timestamp,
        )
    )


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
        being is unknown; an ``"Invalid: "`` string if it already has a stake in a
        home (owned or pledged) or lacks the materials (rejected calls mutate
        nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if world.stakeholder_home_of(agent_id) is not None:
        return "Invalid: You already have or share a home; you may hold only one."
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
    if home.status is not HomeStatus.STANDING:
        return "Invalid: Your home has fallen to ruin; its hearth is cold."
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
        already belongs to a DIFFERENT home (rejected calls mutate nothing); a benign,
        idempotent no-op sentence if the being already holds a stake in THIS SAME home
        (no duplicate stakeholder, no event).
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
    if home.status is not HomeStatus.STANDING:
        return "Invalid: That home is a ruin; there is nothing left to pledge to."
    if home.region != agent.current_position:
        return (
            "Invalid: You are not where that home stands; you can only join a home in your place."
        )
    existing_home = world.stakeholder_home_of(agent_id)
    if existing_home is not None:
        if existing_home.home_id == home_id:
            return "You already tend this home."
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
    if home.status is not HomeStatus.STANDING:
        return "Invalid: Your home has fallen to ruin; there is no place left to give up."

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


async def deposit_to_home(
    world: WorldState, event_bus: EventBus, agent_id: str, amount: float
) -> str:
    """Bank materials from the being's personal stock into its home's shared vault.

    A stakeholder standing where its home stands moves ``amount`` materials from its own
    holding into the home's vault. Conserved (spec §12): the materials are deducted from the
    being FIRST, then credited to the vault — the same amount moved, nothing minted. The vault
    is materials-only; energy is untouched.

    Mutates world state:
        * Deducts ``amount`` from the being's materials
          (:meth:`~world.world.WorldState.modify_agent_materials`), then adds it to the home's
          vault (:meth:`~world.world.WorldState.deposit_to_home_vault`).

    Emits events:
        * One ``"home_started_hoarding"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the depositor, region = the home's region, stamped ``world.now()``) **only** when this
          deposit lifts the vault from below to at/above
          :data:`~core.constants.HOARDING_MATERIALS_THRESHOLD` (see
          :func:`~world.homes.home_is_hoarding`). Per-deposit operations are otherwise silent —
          the balance is surfaced via the vault column and ``look_around``.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the depositing being.
        amount: Materials to move from personal stock into the vault.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being is
        unknown or belongs to no home; an ``"Invalid: "`` string if the amount is not a
        positive number, the being is fallen, it is not where its home stands, or it lacks
        that many materials (rejected calls mutate nothing).
    """
    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot tend a home's store; "
            "only another being can restore you."
        )
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to store materials in."
    if home.status is not HomeStatus.STANDING:
        return "Invalid: Your home has fallen to ruin; it can hold no store."
    if home.region != agent.current_position:
        return "Invalid: You are not where your home stands; you can add to its store only there."
    if agent.current_materials < quantity:
        return (
            f"Invalid: You do not have {quantity} materials to store "
            f"(you hold {agent.current_materials})."
        )

    # Snapshot the home's hoard state BEFORE any mutation so we announce only the crossing
    # (mirrors harvest_resources/use_hearth). A deposit only raises the vault, so the vault
    # can only cross UP into hoarding.
    was_hoarding = home_is_hoarding(home)

    world.modify_agent_materials(agent_id, -quantity)  # deduct the source FIRST (conservation)
    world.deposit_to_home_vault(home.home_id, quantity)  # THEN credit the vault
    await _announce_if_home_started_hoarding(
        event_bus,
        home,
        was_hoarding=was_hoarding,
        source=agent_id,
        region=home.region,
        timestamp=world.now(),
    )
    return (
        f"You set {quantity} materials into your home's store. It now holds "
        f"{home.vault_materials} materials; you hold {agent.current_materials}."
    )


async def withdraw_from_home(
    world: WorldState, event_bus: EventBus, agent_id: str, amount: float
) -> str:
    """Draw materials from the being's home vault back into its personal stock.

    A stakeholder standing where its home stands moves ``amount`` materials from the home's
    vault into its own holding. Conserved (spec §12): the materials are deducted from the vault
    FIRST, then credited to the being — the same amount moved, nothing minted. You cannot draw
    out more than the vault holds. The vault is materials-only; energy is untouched.

    Mutates world state:
        * Deducts ``amount`` from the home's vault
          (:meth:`~world.world.WorldState.withdraw_from_home_vault`), then adds it to the being's
          materials (:meth:`~world.world.WorldState.modify_agent_materials`).

    Emits events:
        * None. A withdrawal only lowers the vault, so it can never cross into a hoard; per-op
          withdrawals are silent (the balance is surfaced via the vault column and
          ``look_around``).

    Args:
        world: The live world state.
        event_bus: Unused; present for the uniform tool signature.
        agent_id: Id of the withdrawing being.
        amount: Materials to move from the vault into personal stock.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being is
        unknown or belongs to no home; an ``"Invalid: "`` string if the amount is not a
        positive number, the being is fallen, it is not where its home stands, or the vault
        holds fewer than that many materials (rejected calls mutate nothing).
    """
    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot tend a home's store; "
            "only another being can restore you."
        )
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to draw materials from."
    if home.status is not HomeStatus.STANDING:
        return "Invalid: Your home has fallen to ruin; there is no store to draw from."
    if home.region != agent.current_position:
        return (
            "Invalid: You are not where your home stands; you can draw from its store only there."
        )
    if quantity > home.vault_materials:
        return (
            f"Invalid: Your home's store holds only {home.vault_materials} materials; "
            f"you cannot draw {quantity}."
        )

    world.withdraw_from_home_vault(home.home_id, quantity)  # deduct the source FIRST (conservation)
    world.modify_agent_materials(agent_id, quantity)  # THEN credit personal stock
    return (
        f"You draw {quantity} materials from your home's store. It now holds "
        f"{home.vault_materials} materials; you hold {agent.current_materials}."
    )


async def break_in(
    world: WorldState, event_bus: EventBus, agent_id: str, target_home: str, intent: str
) -> str:
    """Force your way into a co-located home that is not your own, wearing at its integrity.

    Each attempt drains a PURE SINK of :data:`~core.constants.BREAKIN_ENERGY_COST` energy +
    :data:`~core.constants.BREAKIN_MATERIALS_COST` materials from the raider (destroyed, credited
    to no one — conservation), records the raider in the home's ``breachers``, and removes
    :data:`~core.constants.BREAKIN_INTEGRITY_DAMAGE` integrity. The home is **breached** when the
    blow drives integrity ``<= 0``; the breaching blow executes ``intent`` atomically. For
    ``intent == "thieve"`` (Task 4a) the vault is split equally among every co-located, ALIVE
    breacher (the final striker is always included, even if the cost just paralysed it). The
    split conserves the vault exactly for up to 2 recipients; for 3+ recipients the equal
    per-capita float division leaves at most ~N·ULP (≈1e-14, the float noise floor) of drift,
    minimized by giving the remainder to the final striker. The vault is then zeroed exactly and
    the home is left **STANDING at ~0** (never ``make_ruin`` here — that would double-count the
    looted vault into a ruin remnant; the tick makes the ruin later).
    ``intent == "colonize"`` still falls through to the plain breach sentence until Task 4b. A lone
    raider is out-healed by the home's repair between breaths and self-limits by the resource burn;
    a coordinated group stacking damage inside one repair window makes net progress.

    Mutates world state:
        * Drains ``BREAKIN_ENERGY_COST`` energy + ``BREAKIN_MATERIALS_COST`` materials from the
          raider (pure sinks); records the raider via
          :meth:`~world.world.WorldState.record_breacher`; applies ``-BREAKIN_INTEGRITY_DAMAGE``
          via :meth:`~world.world.WorldState.modify_home_integrity` (floored at 0).
        * On a ``"thieve"`` breach: empties ``home.vault_materials`` to 0 via
          :meth:`~world.world.WorldState.withdraw_from_home_vault`, then credits each recipient's
          share via :meth:`~world.world.WorldState.modify_agent_materials` (conserved — the vault
          is debited for the WHOLE balance before any recipient is credited; the shares plus
          the final striker's remainder sum back to that balance exactly for <=2 recipients,
          and within the float noise floor for 3+ (see the split note above). Deliberately
          does NOT call ``make_ruin`` — ``home.status`` is never touched here, so it stays
          whatever it already was (``STANDING``); ruining is the world-tick's job (Task 5),
          and doing it here would double-count the just-emptied vault into a ruin remnant.

    Emits events:
        * On a breach (integrity ``<= 0``): one ``"home_breached"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, source = the raider, region = the home's region,
          stamped ``world.now()``).
        * On a ``"thieve"`` breach: one further ``"home_thieved"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, source = the raider, region = the home's region,
          stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the raiding being.
        target_home: Id of the co-located home to break into.
        intent: The raider's intent on breach, one of ``"thieve"`` or ``"colonize"``.

    Returns:
        A success sentence (a distinct "breached" sentence on the breaching blow); an
        ``"Error: "`` string if the raider or home is unknown; an ``"Invalid: "`` string for a bad
        intent, a ruined target, a target it stakes, a target in another region, or too little
        energy/materials to pay the cost (rejected calls mutate nothing).
    """
    if intent not in ("thieve", "colonize"):
        return (
            "Invalid: You must mean either to take a home's store (thieve) or seize it (colonize)."
        )
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot force your way into a home; "
            "only another being can restore you."
        )
    home = world.get_home(target_home)
    if home is None:
        return "Error: There is no such home here to break into."
    if home.status is not HomeStatus.STANDING:
        return "Invalid: That home is already a ruin; there is nothing to break into."
    if home.region != agent.current_position:
        return (
            "Invalid: You are not where that home stands; you can only break into a home "
            "in your place."
        )
    if world.is_stakeholder(target_home, agent_id):
        return "Invalid: This is your own home; you cannot break into it."
    if (
        agent.current_energy < BREAKIN_ENERGY_COST
        or agent.current_materials < BREAKIN_MATERIALS_COST
    ):
        return (
            f"Invalid: Forcing a home costs {BREAKIN_ENERGY_COST:.0f} energy and "
            f"{BREAKIN_MATERIALS_COST:.0f} materials; you hold {agent.current_energy} energy and "
            f"{agent.current_materials} materials."
        )

    # Pay the cost — a PURE SINK (both pools destroyed, credited to no one).
    world.modify_agent_energy(agent_id, -BREAKIN_ENERGY_COST)
    world.modify_agent_materials(agent_id, -BREAKIN_MATERIALS_COST)
    world.record_breacher(target_home, agent_id)
    world.modify_home_integrity(target_home, -BREAKIN_INTEGRITY_DAMAGE)  # floors at 0

    region = home.region
    if home.integrity <= 0.0:
        await event_bus.publish(
            Event(
                "home_breached",
                agent_id,
                {"message": f"{agent.name} has broken into the home {home.home_id} in {region}."},
                scope=ScopeType.LOCAL,
                region=region,
                timestamp=world.now(),
            )
        )
        if intent == "thieve":
            loot = home.vault_materials
            # Recipients: the final striker ALWAYS (it landed the breaching blow, even if the cost
            # just paralysed it), plus every OTHER breacher co-located and ALIVE.
            recipients = [agent_id] + [
                b
                for b in sorted(home.breachers)
                if b != agent_id
                and (peer := world.get_agent(b)) is not None
                and peer.status is AgentStatus.ALIVE
                and peer.current_position == region
            ]
            # Deduct the WHOLE vault FIRST -> 0 (conservation).
            world.withdraw_from_home_vault(target_home, loot)
            share = loot / len(recipients)
            for recipient in recipients:
                if recipient == agent_id:
                    continue
                world.modify_agent_materials(recipient, share)
            # Remainder to the final striker: Σ splits == loot exactly for <=2 recipients;
            # for 3+, float per-capita division leaves at most ~N*ULP of drift (see docstring).
            world.modify_agent_materials(agent_id, loot - share * (len(recipients) - 1))
            await event_bus.publish(
                Event(
                    "home_thieved",
                    agent_id,
                    {
                        "message": (
                            f"{agent.name} and {len(recipients) - 1} other(s) stripped the home "
                            f"{home.home_id} of {loot} materials."
                        )
                    },
                    scope=ScopeType.LOCAL,
                    region=region,
                    timestamp=world.now(),
                )
            )
            return (
                f"You break the home {home.home_id} open and strip its store — {loot} materials, "
                f"split among {len(recipients)}. The emptied wreck still stands, for now."
            )
        return f"You break the home {home.home_id} open — it can no longer keep anyone out."
    return (
        f"You batter the home {home.home_id}; its soundness drops to {home.integrity:.1f} but it "
        f"still stands. You spent {BREAKIN_ENERGY_COST:.0f} energy and "
        f"{BREAKIN_MATERIALS_COST:.0f} materials."
    )

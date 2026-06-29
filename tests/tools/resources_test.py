"""Tests for :mod:`tools.builtin.resources` -- ``harvest_resources`` and
``transfer_resource``.

``harvest_resources`` moves resource from the agent's current region into the
agent and emits a ``resource_changed`` event. ``transfer_resource`` moves
resource from one co-located agent to another and emits a ``resource_transferred``
event. Both report lookup failures (unknown agent, unknown resource type) with
``Error:`` and rule violations (insufficient stock, cross-region transfer) with
``Invalid:``.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from tools.builtin.resources import harvest_resources, transfer_resource
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState

# ---- harvest_resources ----------------------------------------------------


async def test_harvest_energy_moves_region_stock_to_agent(
    world: WorldState, event_bus: EventBus
) -> None:
    """Harvesting energy debits the region and credits the agent; emits an event."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount=30.0
    )

    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 130.0  # 100 + 30
    assert region.current_energy == 70.0  # 100 - 30

    inbox = event_bus.get_events("wanderer_001")
    assert len(inbox) == 1
    assert inbox[0].type == "resource_changed"
    assert inbox[0].scope is ScopeType.LOCAL
    assert inbox[0].timestamp == world.now()
    assert result.startswith("Successfully harvested")


async def test_harvest_materials_moves_region_stock_to_agent(
    world: WorldState, event_bus: EventBus
) -> None:
    """Harvesting materials debits the region and credits the agent."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.MATERIALS, amount=20.0
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_materials == 70.0  # 50 + 20
    assert region.current_materials == 80.0  # 100 - 20
    assert result.startswith("Successfully harvested")


async def test_harvest_more_than_available_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """Requesting more than the region holds is a rule violation, no effect."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount=1000.0
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 100.0  # unchanged
    assert region.current_energy == 100.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_001") == []


async def test_harvest_unknown_resource_type_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An unknown resource string is reported with an ``Error:`` listing valids."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type="gold", amount=5.0
    )
    assert result.startswith("Error: Invalid resource type gold")
    assert "energy" in result and "materials" in result
    assert event_bus.get_events("wanderer_001") == []


async def test_harvest_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown harvester yields an ``Error:`` string."""
    result = await harvest_resources(
        world, event_bus, "ghost", resource_type=ResourceTypes.ENERGY, amount=5.0
    )
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_001") == []


# ---- transfer_resource ----------------------------------------------------


async def test_transfer_energy_moves_between_co_located_agents(
    world: WorldState, event_bus: EventBus
) -> None:
    """Transferring energy debits the sender and credits the receiver; emits event."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=20.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 80.0  # 100 - 20
    assert receiver.current_energy == 120.0  # 100 + 20

    inbox = event_bus.get_events("wanderer_002")
    assert len(inbox) == 1
    assert inbox[0].type == "resource_transferred"
    assert inbox[0].scope is ScopeType.LOCAL
    assert inbox[0].target == "wanderer_002"
    assert inbox[0].timestamp == world.now()
    assert result.startswith("Successfully transferred")


async def test_transfer_across_regions_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """Sender and receiver in different regions is a rule violation, no effect."""
    assert world.move_agent("wanderer_002", "beta") is True
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=20.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 100.0 and receiver.current_energy == 100.0
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_more_than_held_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """Transferring more than the sender holds is a rule violation, no effect."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=1000.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 100.0 and receiver.current_energy == 100.0
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_unknown_resource_type_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An unknown resource string is reported with an ``Error:``."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type="gold",
        amount=5.0,
    )
    assert result.startswith("Error: Invalid resource type gold")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown receiver yields an ``Error:`` string."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="ghost",
        resource_type=ResourceTypes.ENERGY,
        amount=5.0,
    )
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_materials_moves_between_co_located_agents(
    world: WorldState, event_bus: EventBus
) -> None:
    """The materials branch of transfer debits sender and credits receiver."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.MATERIALS,
        amount=15.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_materials == 35.0  # 50 - 15
    assert receiver.current_materials == 65.0  # 50 + 15
    assert result.startswith("Successfully transferred")


async def test_harvest_materials_insufficient_region_stock_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """The materials branch of the region check rejects over-harvesting."""
    # beta holds only 50 materials; ask for more.
    assert world.move_agent("wanderer_001", "beta") is True
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.MATERIALS, amount=999.0
    )
    region = world.get_region("beta")
    assert region is not None and region.current_materials == 50.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_001") == []


async def test_transfer_materials_insufficient_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """The materials branch of the agent check rejects over-transfer."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.MATERIALS,
        amount=999.0,
    )
    sender = world.get_agent("wanderer_001")
    assert sender is not None and sender.current_materials == 50.0  # unchanged
    assert result.startswith("Invalid:")


async def test_harvest_in_unknown_region_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An agent positioned in a non-existent region cannot harvest."""
    world.add_agent(
        AgentState(
            id="lost",
            name="Lost",
            persona="adrift",
            current_position="void",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        )
    )
    result = await harvest_resources(
        world, event_bus, "lost", resource_type=ResourceTypes.ENERGY, amount=5.0
    )
    assert result.startswith("Error:")


# ---- amount coercion: harvest_resources -----------------------------------


async def test_harvest_numeric_string_amount_succeeds(
    world: WorldState, event_bus: EventBus
) -> None:
    """A numeric-string amount (the model often sends ``"50"``) harvests normally."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount="50"
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 150.0  # 100 + 50
    assert region.current_energy == 50.0  # 100 - 50
    assert result.startswith("Successfully harvested")
    assert len(event_bus.get_events("wanderer_001")) == 1


async def test_harvest_non_numeric_amount_returns_error_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    """A non-numeric amount yields an ``Error:`` string without raising or mutating."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount="five"
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 100.0  # unchanged
    assert region.current_energy == 100.0  # unchanged
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_001") == []


async def test_harvest_negative_amount_is_invalid_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    """A negative amount is a rule violation, not a reversed (deposit) flow."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount=-30.0
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 100.0  # unchanged
    assert region.current_energy == 100.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_001") == []


async def test_harvest_zero_amount_is_invalid_no_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """A zero amount is a pointless no-op and must not fire an event."""
    result = await harvest_resources(
        world, event_bus, "wanderer_001", resource_type=ResourceTypes.ENERGY, amount=0.0
    )
    agent = world.get_agent("wanderer_001")
    region = world.get_region("alpha")
    assert agent is not None and region is not None
    assert agent.current_energy == 100.0  # unchanged
    assert region.current_energy == 100.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_001") == []


# ---- amount coercion: transfer_resource -----------------------------------


async def test_transfer_numeric_string_amount_succeeds(
    world: WorldState, event_bus: EventBus
) -> None:
    """A numeric-string amount transfers normally between co-located agents."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount="40",
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 60.0  # 100 - 40
    assert receiver.current_energy == 140.0  # 100 + 40
    assert result.startswith("Successfully transferred")
    assert len(event_bus.get_events("wanderer_002")) == 1


async def test_transfer_non_numeric_amount_returns_error_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    """A non-numeric amount yields an ``Error:`` string without raising or mutating."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount="five",
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 100.0  # unchanged
    assert receiver.current_energy == 100.0  # unchanged
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_negative_amount_is_invalid_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    """A negative amount must not reverse the flow and drain the receiver."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=-30.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 100.0  # unchanged
    assert receiver.current_energy == 100.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_002") == []


async def test_transfer_zero_amount_is_invalid_no_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """A zero amount is a pointless no-op and must not fire an event."""
    result = await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=0.0,
    )
    sender = world.get_agent("wanderer_001")
    receiver = world.get_agent("wanderer_002")
    assert sender is not None and receiver is not None
    assert sender.current_energy == 100.0  # unchanged
    assert receiver.current_energy == 100.0  # unchanged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_002") == []


# ---- transfer_resource: agent_recovered on revival ------------------------


async def test_transfer_energy_revives_emits_agent_recovered(
    world: WorldState, event_bus: EventBus
) -> None:
    """Feeding a PARALYZED agent above the threshold flips it ALIVE and emits a
    LOCAL ``agent_recovered`` event (source = feeder, target = revived)."""
    world.modify_agent_energy("wanderer_002", -96.0)  # -> PARALYZED at 4.0
    await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=10.0,
    )  # 4 -> 14 > 5
    t = world.get_agent("wanderer_002")
    assert t is not None and t.status is AgentStatus.ALIVE
    recovered = [
        e for e in event_bus.get_events("wanderer_002") if e.type == "agent_recovered"
    ]
    assert recovered and recovered[0].scope is ScopeType.LOCAL
    assert recovered[0].source == "wanderer_001" and recovered[0].target == "wanderer_002"


async def test_transfer_not_enough_to_revive_no_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """A transfer that leaves the receiver PARALYZED emits no ``agent_recovered``."""
    world.modify_agent_energy("wanderer_002", -98.0)  # -> 2.0 PARALYZED
    await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=1.0,
    )  # 2 -> 3, still <= 5
    t = world.get_agent("wanderer_002")
    assert t is not None and t.status is AgentStatus.PARALYZED
    assert not any(
        e.type == "agent_recovered" for e in event_bus.get_events("wanderer_002")
    )


async def test_transfer_to_alive_no_recovered_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """A transfer to an already-ALIVE receiver emits no ``agent_recovered``."""
    await transfer_resource(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        resource_type=ResourceTypes.ENERGY,
        amount=10.0,
    )
    assert not any(
        e.type == "agent_recovered" for e in event_bus.get_events("wanderer_002")
    )

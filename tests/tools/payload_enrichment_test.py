"""Tests for the live-presentation payload contract (design spec §4.1/§4.2).

Every numeric payload field a tool reports is read *after* its mutation, so a
renderer receiving only the post state can repaint ``70`` but can never animate
``100 -> 70``. This module pins the complementary rule for every publish site:

* **Pre-state.** For every world quantity a publish site mutates, the payload
  carries an ``X_before`` beside the post-mutation ``X`` (the ``was_hoarding`` /
  ``target_was_paralyzed`` / ``previous_owner_id`` idiom, generalised).
* **Identity.** The cheap ``*_name`` fields the frontend otherwise reconstructs
  by agent lookup travel with the event.
* **Display-only.** ``speak`` and ``self_talk`` are classified by the backend,
  not inferred by the frontend from the type string.

These are *presentation* facts only: the pre-state values are read from the same
live objects the tool already touches, no world method changes, and the agent's
perception channel (``payload["message"]``) is untouched.
"""

from __future__ import annotations

import pytest

from agents.decider import Decision
from agents.runtime import Agent
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    ATTACK_DAMAGE,
    ATTACK_ENERGY_COST,
    BREAKIN_ENERGY_COST,
    BREAKIN_INTEGRITY_DAMAGE,
    BREAKIN_MATERIALS_COST,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
    IDLE_AGING_ENERGY_COST,
    MATING_MIN_ENERGY_CONTRIBUTION,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
    MOVE_ENERGY_COST,
    PARALYSIS_ENERGY_THRESHOLD,
    SPEAK_ENERGY_COST,
)
from observability.event_payloads import DISPLAY_ONLY_EVENT_TYPES, is_display_only
from tests.conftest import FakeClock, MockDecider
from tools.builtin.combat import attack
from tools.builtin.communication import speak
from tools.builtin.homes import (
    break_in,
    build_home,
    deposit_to_home,
    leave_home,
    pledge_home,
    scavenge_ruins,
    use_hearth,
)
from tools.builtin.mating import accept_mating, initiate_mating, reject_mating
from tools.builtin.movement import move
from tools.builtin.resources import harvest_resources, transfer_resource
from tools.registry import ToolRegistry
from world.agents import AgentStatus
from world.homes import HomeStatus, max_integrity
from world.regions import ResourceTypes
from world.tick import tick
from world.world import WorldState


def _only(events: list[Event], event_type: str) -> Event:
    """Return the single event of ``event_type`` in ``events``."""
    matches = [event for event in events if event.type == event_type]
    assert len(matches) == 1, f"expected exactly one {event_type}, got {len(matches)}"
    return matches[0]


# ---- combat ---------------------------------------------------------------


async def test_attack_reports_pre_state_and_names(world: WorldState, event_bus: EventBus) -> None:
    """``attack`` carries both combatants' pre-hit energy and their display names."""
    result = await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    assert result.startswith("Successfully Attacked")

    payload = _only(event_bus.get_events("wanderer_002"), "attack").payload
    assert payload["attacker_energy_before"] == 100.0
    assert payload["attacker_energy"] == 100.0 - ATTACK_ENERGY_COST
    assert payload["victim_energy_before"] == 100.0
    assert payload["victim_energy"] == 100.0 - ATTACK_DAMAGE
    assert payload["attacker_name"] == "Ada"
    assert payload["victim_name"] == "Boris"


async def test_attack_paralysis_reports_pre_hit_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """The ``agent_paralyzed`` an attack causes reports the victim's pre-hit energy."""
    victim = world.get_agent("wanderer_002")
    assert victim is not None
    victim.current_energy = 21.0  # -20 damage lands at 1.0: paralysed, not killed

    await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    payload = _only(event_bus.get_events("wanderer_002"), "agent_paralyzed").payload
    assert payload["energy_before"] == 21.0
    assert payload["energy"] == 1.0


async def test_agent_died_reports_both_sides_of_the_loot(
    world: WorldState, event_bus: EventBus
) -> None:
    """A lethal hit reports pre/post balances for killer and victim, not only the loot."""
    victim = world.get_agent("wanderer_002")
    assert victim is not None
    victim.current_energy = 10.0  # 10 - 20 < KILL_ENERGY_THRESHOLD -> lethal

    await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    payload = _only(event_bus.get_events("wanderer_001"), "agent_died").payload
    assert payload["attacker_energy_before"] == 100.0
    assert payload["attacker_energy"] == 100.0 - ATTACK_ENERGY_COST + 10.0
    assert payload["attacker_materials_before"] == 50.0
    assert payload["attacker_materials"] == 100.0
    assert payload["victim_energy_before"] == 10.0
    assert payload["victim_energy"] == 0.0
    assert payload["victim_materials_before"] == 50.0
    assert payload["victim_materials"] == 0.0


# ---- communication --------------------------------------------------------


async def test_speak_reports_speaker_energy_and_name(
    world: WorldState, event_bus: EventBus
) -> None:
    """``speak`` reports the speaker's pre/post energy and display name."""
    await speak(world, event_bus, "wanderer_001", message="hello")

    payload = _only(event_bus.get_events("wanderer_002"), "speak").payload
    assert payload["speaker_energy_before"] == 100.0
    assert payload["speaker_energy"] == 100.0 - SPEAK_ENERGY_COST
    assert payload["speaker_name"] == "Ada"


# ---- movement -------------------------------------------------------------


async def test_move_events_report_pre_move_energy(world: WorldState, event_bus: EventBus) -> None:
    """Both movement events report the mover's energy before the move cost."""
    await move(world, event_bus, "wanderer_001", destination="beta")

    # The mover is already in beta, so only those left behind in alpha hear the departure.
    left = _only(event_bus.get_events("wanderer_002"), "agent_left_region").payload
    entered = _only(event_bus.get_events("wanderer_001"), "agent_entered_region").payload
    for payload in (left, entered):
        assert payload["agent_energy_before"] == 100.0
        assert payload["agent_energy"] == 100.0 - MOVE_ENERGY_COST


# ---- resources ------------------------------------------------------------


async def test_harvest_reports_pre_state_for_agent_and_region(
    world: WorldState, event_bus: EventBus
) -> None:
    """``resource_changed`` reports the four pre-harvest balances and the agent's name."""
    await harvest_resources(world, event_bus, "wanderer_001", ResourceTypes.ENERGY, 30.0)

    payload = _only(event_bus.get_events("wanderer_001"), "resource_changed").payload
    assert payload["agent_energy_before"] == 100.0
    assert payload["agent_energy"] == 130.0
    assert payload["agent_materials_before"] == 50.0
    assert payload["agent_materials"] == 50.0
    assert payload["region_energy_before"] == 100.0
    assert payload["region_energy"] == 70.0
    assert payload["region_materials_before"] == 100.0
    assert payload["region_materials"] == 100.0
    assert payload["agent_name"] == "Ada"


async def test_harvest_message_names_the_resource_not_the_enum(
    world: WorldState, event_bus: EventBus
) -> None:
    """The perceived harvest message says ``energy``, never ``ResourceTypes.ENERGY``."""
    await harvest_resources(world, event_bus, "wanderer_001", ResourceTypes.ENERGY, 10.0)

    payload = _only(event_bus.get_events("wanderer_001"), "resource_changed").payload
    assert "ResourceTypes." not in str(payload["message"])
    assert "10.0 of energy" in str(payload["message"])


async def test_transfer_reports_pre_state_for_both_parties(
    world: WorldState, event_bus: EventBus
) -> None:
    """``resource_transferred`` reports both parties' pre-transfer balances."""
    await transfer_resource(
        world, event_bus, "wanderer_001", target="wanderer_002", resource_type="energy", amount=25.0
    )

    payload = _only(event_bus.get_events("wanderer_002"), "resource_transferred").payload
    assert payload["sender_energy_before"] == 100.0
    assert payload["sender_energy"] == 75.0
    assert payload["sender_materials_before"] == 50.0
    assert payload["sender_materials"] == 50.0
    assert payload["receiver_energy_before"] == 100.0
    assert payload["receiver_energy"] == 125.0
    assert payload["receiver_materials_before"] == 50.0
    assert payload["receiver_materials"] == 50.0


async def test_transfer_message_names_the_resource_not_the_enum(
    world: WorldState, event_bus: EventBus
) -> None:
    """The perceived transfer message says ``energy``, never ``ResourceTypes.ENERGY``."""
    await transfer_resource(
        world, event_bus, "wanderer_001", target="wanderer_002", resource_type="energy", amount=5.0
    )

    payload = _only(event_bus.get_events("wanderer_002"), "resource_transferred").payload
    assert "ResourceTypes." not in str(payload["message"])
    assert "5.0 of energy" in str(payload["message"])


async def test_agent_recovered_reports_pre_revival_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """``agent_recovered`` reports the giver's and the revived being's pre-gift energy."""
    fallen = world.get_agent("wanderer_002")
    assert fallen is not None
    fallen.current_energy = 1.0
    fallen.status = AgentStatus.PARALYZED

    await transfer_resource(
        world, event_bus, "wanderer_001", target="wanderer_002", resource_type="energy", amount=40.0
    )

    payload = _only(event_bus.get_events("wanderer_002"), "agent_recovered").payload
    assert payload["giver_energy_before"] == 100.0
    assert payload["giver_energy"] == 60.0
    assert payload["revived_energy_before"] == 1.0
    assert payload["revived_energy"] == 41.0


async def test_agent_started_hoarding_reports_pre_credit_balances(
    world: WorldState, event_bus: EventBus
) -> None:
    """The hoarding-crossing announcement reports the balances that crossed it."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOARDING_MATERIALS_THRESHOLD - 10.0
    region = world.get_region("alpha")
    assert region is not None
    region.current_materials = 1000.0

    await harvest_resources(world, event_bus, "wanderer_001", ResourceTypes.MATERIALS, 20.0)

    payload = _only(event_bus.get_events("wanderer_001"), "agent_started_hoarding").payload
    assert payload["materials_before"] == HOARDING_MATERIALS_THRESHOLD - 10.0
    assert payload["materials"] == HOARDING_MATERIALS_THRESHOLD + 10.0
    assert payload["energy_before"] == 100.0
    assert payload["energy"] == 100.0


# ---- homes ----------------------------------------------------------------


async def test_home_built_reports_builder_materials_and_name(
    world: WorldState, event_bus: EventBus
) -> None:
    """``home_built`` reports the builder's pre/post materials and display name."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 200.0

    await build_home(world, event_bus, "wanderer_001")

    payload = _only(event_bus.get_events("wanderer_001"), "home_built").payload
    assert payload["builder_materials_before"] == 200.0
    assert payload["builder_materials"] == 200.0 - HOME_BUILD_MATERIALS_COST
    assert payload["builder_name"] == "Ada"


async def test_hearth_used_reports_pre_burn_balances(
    world: WorldState, event_bus: EventBus
) -> None:
    """``hearth_used`` reports the being's balances before the fuel burn."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    await use_hearth(world, event_bus, "wanderer_001")

    payload = _only(event_bus.get_events("wanderer_001"), "hearth_used").payload
    assert payload["agent_energy_before"] == 100.0
    assert payload["agent_materials_before"] == 50.0
    assert payload["agent_materials"] == 50.0 - HEARTH_MATERIALS_PER_USE


async def test_home_joined_reports_pre_pledge_roster_and_ceiling(
    world: WorldState, event_bus: EventBus
) -> None:
    """``home_joined`` reports the roster and integrity ceiling before the pledge."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )

    await pledge_home(world, event_bus, "wanderer_002", "h1")

    payload = _only(event_bus.get_events("wanderer_002"), "home_joined").payload
    assert payload["previous_stakeholders"] == ["wanderer_001"]
    assert payload["stakeholders"] == ["wanderer_001", "wanderer_002"]
    assert payload["max_integrity_before"] == max_integrity(1)
    assert payload["max_integrity"] == max_integrity(2)
    assert payload["integrity_before"] == HOME_MAX_INTEGRITY


async def test_home_left_reports_pre_departure_ceiling(
    world: WorldState, event_bus: EventBus
) -> None:
    """``home_left`` reports the integrity and ceiling before the stake was given up."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.add_stakeholder("h1", "wanderer_002")

    await leave_home(world, event_bus, "wanderer_002")

    payload = _only(event_bus.get_events("wanderer_002"), "home_left").payload
    assert payload["max_integrity_before"] == max_integrity(2)
    assert payload["max_integrity"] == max_integrity(1)
    assert payload["integrity_before"] == HOME_MAX_INTEGRITY


async def test_home_started_hoarding_reports_pre_deposit_vault(
    world: WorldState, event_bus: EventBus
) -> None:
    """The home hoard-crossing announcement reports the vault before the deposit."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("h1", HOARDING_MATERIALS_THRESHOLD - 5.0)
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 100.0

    await deposit_to_home(world, event_bus, "wanderer_001", 10.0)

    payload = _only(event_bus.get_events("wanderer_001"), "home_started_hoarding").payload
    assert payload["vault_materials_before"] == HOARDING_MATERIALS_THRESHOLD - 5.0
    assert payload["vault_materials"] == HOARDING_MATERIALS_THRESHOLD + 5.0


async def test_home_breached_reports_pre_blow_integrity_and_raider_state(
    world: WorldState, event_bus: EventBus
) -> None:
    """``home_breached`` reports the integrity and raider balances before the blow."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=BREAKIN_INTEGRITY_DAMAGE
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_energy = 90.0
    boris.current_materials = 60.0

    await break_in(world, event_bus, "wanderer_002", target_home="h1", intent="thieve")

    payload = _only(event_bus.get_events("wanderer_002"), "home_breached").payload
    assert payload["integrity_before"] == BREAKIN_INTEGRITY_DAMAGE
    assert payload["integrity"] == 0.0
    assert payload["breacher_energy_before"] == 90.0
    assert payload["breacher_energy"] == 90.0 - BREAKIN_ENERGY_COST
    assert payload["breacher_materials_before"] == 60.0
    assert payload["breacher_materials"] == 60.0 - BREAKIN_MATERIALS_COST


async def test_home_thieved_reports_pre_split_vault(world: WorldState, event_bus: EventBus) -> None:
    """``home_thieved`` reports the vault balance before it was split."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=BREAKIN_INTEGRITY_DAMAGE
    )
    world.deposit_to_home_vault("h1", 40.0)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = 60.0

    await break_in(world, event_bus, "wanderer_002", target_home="h1", intent="thieve")

    payload = _only(event_bus.get_events("wanderer_002"), "home_thieved").payload
    assert payload["vault_materials_before"] == 40.0
    assert payload["vault_materials"] == 0.0


async def test_ruins_scavenged_reports_pre_draw_balances(
    world: WorldState, event_bus: EventBus
) -> None:
    """``ruins_scavenged`` reports the remnant and the scavenger's materials before the draw."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.make_ruin("h1")
    home = world.get_home("h1")
    assert home is not None and home.status is HomeStatus.RUIN
    remnant_before = home.remnant_materials

    await scavenge_ruins(world, event_bus, "wanderer_002", target_home="h1", amount=5.0)

    payload = _only(event_bus.get_events("wanderer_002"), "ruins_scavenged").payload
    assert payload["remnant_materials_before"] == remnant_before
    assert payload["remnant_materials"] == remnant_before - 5.0
    assert payload["agent_materials_before"] == 50.0
    assert payload["agent_materials"] == 55.0


# ---- mating ---------------------------------------------------------------


async def _fund_for_mating(world: WorldState) -> None:
    for agent in world.get_all_agents():
        agent.current_energy = 300.0
        agent.current_materials = 300.0


async def test_mating_initiated_reports_pre_escrow_balances(
    world: WorldState, event_bus: EventBus
) -> None:
    """``mating_initiated`` reports the initiator's balances before the escrow deduction."""
    await _fund_for_mating(world)

    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="join me",
        resources={
            ResourceTypes.ENERGY: MATING_MIN_ENERGY_CONTRIBUTION,
            ResourceTypes.MATERIALS: MATING_MIN_MATERIALS_CONTRIBUTION,
        },
    )

    payload = _only(event_bus.get_events("wanderer_002"), "mating_initiated").payload
    assert payload["initiator_energy_before"] == 300.0
    assert payload["initiator_energy"] == 300.0 - MATING_MIN_ENERGY_CONTRIBUTION
    assert payload["initiator_materials_before"] == 300.0
    assert payload["initiator_materials"] == 300.0 - MATING_MIN_MATERIALS_CONTRIBUTION


async def test_mating_rejected_reports_the_refund_as_a_transition(
    world: WorldState, event_bus: EventBus
) -> None:
    """``mating_rejected`` reports the initiator's balances either side of the refund."""
    await _fund_for_mating(world)
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="join me",
        resources={
            ResourceTypes.ENERGY: MATING_MIN_ENERGY_CONTRIBUTION,
            ResourceTypes.MATERIALS: MATING_MIN_MATERIALS_CONTRIBUTION,
        },
    )
    event_bus.get_events("wanderer_001")  # drain

    await reject_mating(world, event_bus, "wanderer_002", target="wanderer_001", message="no")

    payload = _only(event_bus.get_events("wanderer_001"), "mating_rejected").payload
    assert payload["initiator_energy_before"] == 300.0 - MATING_MIN_ENERGY_CONTRIBUTION
    assert payload["initiator_energy"] == 300.0
    assert payload["initiator_materials_before"] == 300.0 - MATING_MIN_MATERIALS_CONTRIBUTION
    assert payload["initiator_materials"] == 300.0


async def test_agent_born_reports_the_acceptors_commitment(
    world: WorldState, event_bus: EventBus
) -> None:
    """``agent_born`` reports the acceptor's balances either side of its commitment."""
    await _fund_for_mating(world)
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="join me",
        resources={
            ResourceTypes.ENERGY: MATING_MIN_ENERGY_CONTRIBUTION,
            ResourceTypes.MATERIALS: MATING_MIN_MATERIALS_CONTRIBUTION,
        },
    )
    event_bus.get_events("wanderer_001")  # drain

    await accept_mating(world, event_bus, "wanderer_002", target="wanderer_001", message="yes")

    payload = _only(event_bus.get_events("wanderer_001"), "agent_born").payload
    assert payload["acceptor_energy_before"] == 300.0
    assert payload["acceptor_energy"] == 300.0 - MATING_MIN_ENERGY_CONTRIBUTION
    assert payload["acceptor_materials_before"] == 300.0
    assert payload["acceptor_materials"] == 300.0 - MATING_MIN_MATERIALS_CONTRIBUTION


# ---- world tick -----------------------------------------------------------


async def test_mating_proposal_timeout_reports_the_refund_as_a_transition(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """The tick's timeout refund reports the initiator's balances either side of it."""
    await _fund_for_mating(world)
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="join me",
        resources={
            ResourceTypes.ENERGY: MATING_MIN_ENERGY_CONTRIBUTION,
            ResourceTypes.MATERIALS: MATING_MIN_MATERIALS_CONTRIBUTION,
        },
    )
    event_bus.get_events("wanderer_001")  # drain
    fake_clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS + 1.0)

    await tick(world, event_bus)

    payload = _only(event_bus.get_events("wanderer_001"), "mating_proposal_timeout").payload
    assert payload["initiator_energy_before"] == 300.0 - MATING_MIN_ENERGY_CONTRIBUTION
    assert payload["initiator_energy"] == 300.0
    assert payload["initiator_materials_before"] == 300.0 - MATING_MIN_MATERIALS_CONTRIBUTION
    assert payload["initiator_materials"] == 300.0


async def test_home_collapsed_reports_pre_decay_integrity(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """``home_collapsed`` reports the integrity the home held before this tick's decay."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=1.0)
    for agent in world.get_all_agents():
        agent.current_materials = 0.0  # nobody can cover upkeep -> decay
    fake_clock.advance(5.0)

    await tick(world, event_bus)

    payload = _only(event_bus.get_events("wanderer_001"), "home_collapsed").payload
    assert payload["integrity_before"] == 1.0
    assert payload["integrity"] <= 0.0


# ---- runtime --------------------------------------------------------------


async def test_breath_paralysis_reports_pre_breath_energy(
    world: WorldState,
    event_bus: EventBus,
    populated_registry: ToolRegistry,
) -> None:
    """The breath-triggered ``agent_paralyzed`` reports the energy before the breath."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_energy = PARALYSIS_ENERGY_THRESHOLD + IDLE_AGING_ENERGY_COST
    agent = Agent(
        "wanderer_001",
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(text="I rest a while.")]),
        pace=0.0,
    )

    await agent.breathe()

    payload = _only(event_bus.get_events("wanderer_002"), "agent_paralyzed").payload
    assert payload["energy_before"] == PARALYSIS_ENERGY_THRESHOLD + IDLE_AGING_ENERGY_COST
    assert payload["energy"] == PARALYSIS_ENERGY_THRESHOLD


# ---- display-only classification -------------------------------------------


def test_display_only_vocabulary_is_exactly_the_utterances() -> None:
    """Only private thought and speech are classified display-only."""
    assert frozenset({"self_talk", "speak"}) == DISPLAY_ONLY_EVENT_TYPES
    assert is_display_only("speak") is True
    assert is_display_only("self_talk") is True
    assert is_display_only("attack") is False
    assert is_display_only("home_built") is False


@pytest.mark.parametrize("event_type", ["speak", "self_talk"])
def test_display_only_is_stated_on_the_serialized_event(event_type: str) -> None:
    """A serialized utterance states ``display_only: True`` in its payload."""
    from observability.event_log import serialize_event

    event = Event(event_type, "wanderer_001", {"message": "hm"}, ScopeType.LOCAL)
    assert serialize_event(event)["payload"]["display_only"] is True


def test_display_only_is_stated_false_on_choreographed_events() -> None:
    """A body-occupying beat states ``display_only: False`` rather than omitting it."""
    from observability.event_log import serialize_event

    event = Event("attack", "wanderer_001", {"message": "hm"}, ScopeType.LOCAL)
    assert serialize_event(event)["payload"]["display_only"] is False


def test_serializing_does_not_mutate_the_live_payload_agents_perceive() -> None:
    """Classification is a presentation fact: the live ``Event.payload`` is untouched."""
    from observability.event_log import serialize_event

    payload: dict[str, object] = {"message": "hm"}
    event = Event("speak", "wanderer_001", payload, ScopeType.LOCAL)
    serialize_event(event)
    assert payload == {"message": "hm"}
    assert "display_only" not in event.payload

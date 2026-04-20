from .events import Event, ScopeType
from world.world import WorldState
import asyncio


class EventBus:
    def __init__(self, world_state: WorldState):
        self.world_state = world_state
        self.agent_queues = {}

    def subscribe(self, agent_id: str):
        # check is valid agent
        if self.world_state.get_agent(agent_id):
            self.agent_queues[agent_id] = asyncio.Queue()
            return True
        return False

    async def publish(self, event: Event):
        match event.scope:
            case ScopeType.LOCAL:
                if event.region:
                    targeted_region = self.world_state.get_agents_in_region(
                        event.region
                    )
                    for agent in targeted_region:
                        if agent.id in self.agent_queues:
                            fetched_queue = self.agent_queues.get(agent.id)
                            await fetched_queue.put(event)
                    return True
                else:
                    agent_data = self.world_state.get_agent(event.source)
                    if not agent_data:
                        return False
                    local_region = self.world_state.get_agents_in_region(
                        agent_data.current_position
                    )
                    for agent in local_region:
                        if agent.id in self.agent_queues:
                            fetched_queue = self.agent_queues.get(agent.id)
                            await fetched_queue.put(event)
                    return True
            case ScopeType.GLOBAL:
                for agent_id, queue in self.agent_queues.items():
                    await queue.put(event)
                return True
            case ScopeType.TARGETED:
                if event.target in self.agent_queues:
                    fetched_queue = self.agent_queues.get(event.target)
                    await fetched_queue.put(event)
                return True

    def get_events(self, agent_id: str) -> list[Event]:
        events = []
        queue = self.agent_queues.get(agent_id)
        if queue:
            while not queue.empty():
                event = queue.get_nowait()
                events.append(event)
        return events

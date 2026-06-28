from bus.event_bus import EventBus
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.world import WorldState


class Agent:
    def __init__(
        self,
        agent_id: str,
        world: WorldState,
        event_bus: EventBus,
        tool_registry: ToolRegistry,
        model: str,
        pace: float,
    ) -> None:
        self.lifecycle_history: list[
            dict
        ] = []  # renamed from chat_history more suited for living breathing agents
        self.world = world
        self.event_bus = event_bus
        self.tool_registry = tool_registry
        self.model = model
        self.pace = pace
        self.agent_id = agent_id

        self.breath_count: int = 0
        self.alive: bool = False
        self.agent_state: AgentState = self.world.get_agent(self.agent_id)
        if self.agent_state:
            self.alive = self.agent_state.status != AgentStatus.DEAD
            self.event_bus.subscribe(self.agent_id)

    async def _load_system_prompt(self):
        pass

    async def perceive(self):
        pass

    async def decide(self):
        pass

    async def execute(self, tool_calls):
        pass

    async def breathe(self):
        pass

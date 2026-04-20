from bus.event_bus import EventBus
from world.world import WorldState


class ToolRegistry:
    def __init__(self, world: WorldState, event_bus: EventBus) -> None:
        self.world = world
        self.event_bus = event_bus
        self.tool_registry = {}

    def register(self, name: str, func: callable) -> None:
        self.tool_registry[name] = func

    def list_tools(self) -> list[str]:
        return list(self.tool_registry)

    def invoke(self, name: str, agent_id: str, params: dict):
        try:
            call_func = self.tool_registry.get(name)
            if call_func and self.world.get_agent(agent_id):
                return call_func(self.world, self.event_bus, agent_id, **params)
        except Exception as e:
            print(f"Error occurred in execution{e}")



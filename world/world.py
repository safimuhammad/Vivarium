from .regions import Region, ResourceTypes
from .agents import AgentState, AgentStatus
import time


class WorldState:
    def __init__(self, regions: list[Region] = None, agents: list[AgentState] = None):
        regions = regions or []
        agents = agents or []
        self.regions: dict = {region.name: region for region in regions}
        self.agents: dict = {agent.id: agent for agent in agents}
        self.pending_proposals: dict[tuple[str, str], dict] = {}
        self.pending_proposal_targets: dict[str, list] = {}

    # ---- get methods ----
    def get_all_regions(self) -> list[Region]:
        return list(self.regions.values())

    def get_all_agents(self) -> list[AgentState]:
        return list(self.agents.values())

    def get_region(self, name: str) -> Region:
        return self.regions.get(name)

    def get_agent(self, agent_id: str) -> AgentState:
        return self.agents.get(agent_id)

    def get_agents_in_region(self, region_name: str) -> list[AgentState]:
        agents_in_region: list[AgentState] = []
        for agent in self.agents.values():
            if agent.current_position == region_name:
                agents_in_region.append(agent)
        return agents_in_region

    # ---- Agent methods ----

    def add_agent(self, agent: AgentState) -> bool:
        if agent.id not in self.agents:
            self.agents[agent.id] = agent
            return True
        return False

    def remove_agent(self, agent: AgentState) -> bool:
        if agent.id in self.agents:
            del self.agents[agent.id]
            return True
        return False

    def move_agent(self, agent_id: str, destination: str) -> bool:
        if agent_id in self.agents and destination in self.regions:
            current_pos = self.agents[agent_id].current_position
            current_region = self.regions[current_pos]
            if destination in current_region.connections:
                self.agents[agent_id].current_position = destination
                return True
        return False

    def update_agent_status(self, agent_id: str, status: AgentStatus) -> bool:
        if agent_id in self.agents:
            self.agents[agent_id].status = status
            return True
        return False

    def modify_agent_energy(self, agent_id: str, amount: float) -> bool:
        if agent_id in self.agents:
            self.agents[agent_id].current_energy += amount
            self.agents[agent_id].current_energy = max(
                self.agents[agent_id].current_energy, 0.0
            )
            if self.agents[agent_id].current_energy == 0.0:
                self.agents[agent_id].status = AgentStatus.PARALYZED
            return True
        return False

    def modify_agent_materials(self, agent_id: str, amount: float) -> bool:
        if agent_id in self.agents:
            self.agents[agent_id].current_materials += amount
            self.agents[agent_id].current_materials = max(
                self.agents[agent_id].current_materials, 0.0
            )
            return True
        return False

    # ---- Mating proposal methods ----

    def get_agent_proposals(self, agent_id: str, target: str) -> dict:
        if (agent_id, target) in self.pending_proposals:
            return self.pending_proposals.get((agent_id, target), {})
        return {}

    def get_proposed_targets(self, agent_id: str) -> list:
        if agent_id in self.pending_proposal_targets:
            return self.pending_proposal_targets.get(agent_id, [])
        return []

    def add_proposal(
        self, agent_id: str, target: str, resources: dict[ResourceTypes, float]
    ) -> bool:
        if agent_id in self.agents and target in self.agents:
            self.pending_proposals[(agent_id, target)] = {
                "target": target,
                "timestamp": time.time(),
                "resources": resources,
            }
            if agent_id not in self.pending_proposal_targets:
                self.pending_proposal_targets[agent_id] = []
            self.pending_proposal_targets[agent_id].append(target)
            return True
        return False

    def remove_proposal(self, agent_id: str, target: str) -> bool:
        if (agent_id, target) in self.pending_proposals:
            del self.pending_proposals[(agent_id, target)]
            self.pending_proposal_targets[agent_id].remove(target)
            return True
        return False

    # ---- Region methods ----

    def add_region(self, region: Region) -> bool:
        if region.name not in self.regions:
            self.regions[region.name] = region
            return True
        return False

    def modify_region_energy(self, region_name: str, amount: float) -> bool:
        if region_name in self.regions:
            self.regions[region_name].current_energy += amount
            self.regions[region_name].current_energy = max(
                self.regions[region_name].current_energy, 0.0
            )
            return True
        return False

    def modify_region_materials(self, region_name: str, amount: float) -> bool:
        if region_name in self.regions:
            self.regions[region_name].current_materials += amount
            self.regions[region_name].current_materials = max(
                self.regions[region_name].current_materials, 0.0
            )
            return True
        return False

    def regenerate_resources(self):
        for region in self.regions.values():
            region.current_energy += region.energy_rate
            region.current_energy = min(region.current_energy, region.max_energy)

            region.current_materials += region.materials_rate
            region.current_materials = min(
                region.current_materials, region.max_materials
            )

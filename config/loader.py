import yaml
from world.regions import Region
from world.agents import AgentState, AgentStatus
from world.world import WorldState


def load_config(path: str):
    with open(path, "r") as f:
        data = yaml.safe_load(f)

    # unpack regions
    regions_list = []
    if "regions" in data:
        for region in data["regions"]:
            regions_list.append(Region(**region))
    agents_list = []
    if "agents" in data:
        for agent in data["agents"]:
            status = AgentStatus(agent.get("status"))
            agent["status"] = status
            agents_list.append(AgentState(**agent))

    world = WorldState(regions_list, agents_list)
    return world


if __name__ == "__main__":
    FILE_PATH = "config/world.yaml"
    output = load_config(FILE_PATH)
    print([region.name for region in output.get_all_regions()])
    print([agent.name for agent in output.get_all_agents()])


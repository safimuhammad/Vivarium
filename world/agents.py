from dataclasses import dataclass
from enum import Enum

class AgentStatus(Enum):
    ALIVE = "alive"
    PARALYZED = "paralyzed"
    DEAD = "dead"

@dataclass
class AgentState:
    # identity
    id: str
    name: str
    persona: str
    # world positions
    current_position: str
    current_energy: float
    current_materials: float
    status: AgentStatus

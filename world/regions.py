from dataclasses import dataclass
from enum import Enum

class ResourceTypes(Enum):
    ENERGY = "energy"
    MATERIALS = "materials"

@dataclass
class Region:
    # identity
    name: str
    description: str
    # geography
    connections: list[str]
    # resources
    energy_rate: float
    materials_rate: float
    # current
    current_energy: float
    current_materials: float
    # max
    max_energy: float
    max_materials: float

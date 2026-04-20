from dataclasses import dataclass, field
from enum import Enum
import time


class ScopeType(Enum):
    LOCAL = "local"
    GLOBAL = "global"
    TARGETED = "targeted"


@dataclass
class Event:
    type: str
    source: str # assumes agent_id
    payload: dict
    scope: ScopeType
    region: str = None # optional when passed event heard by entire region passed
    target: str = None # assumes agent_id, None for broadcast and Local
    timestamp: float = field(default_factory=time.time)

"""Read-only physical senses, kept separate from remembered places and private thought."""

from __future__ import annotations

import math
from typing import cast

from core.constants import SPATIAL_SENSE_RADIUS_TILES
from world.homes import HomeStatus
from world.spatial import SpatialJson, SpatialPoint
from world.world import WorldState


def _point(sample: SpatialJson) -> SpatialPoint:
    return SpatialPoint(cast(float, sample["x"]), cast(float, sample["y"]))


def spatial_agent_visible(
    world: WorldState,
    observer_id: str,
    source_id: str,
    now: float,
    *,
    radius_tiles: float = SPATIAL_SENSE_RADIUS_TILES,
    source_point: SpatialPoint | None = None,
) -> bool:
    """Test physical proximity for local senses; preserve non-spatial region routing.

    Reads continuous positions at delivery time without changing navigation.
    System events with no physical source keep their existing region scope.
    """
    spatial = world.spatial_for_agent(observer_id)
    if spatial is None:
        return True
    if source_point is None and not spatial.has_agent(source_id):
        return world.get_agent(source_id) is None
    observer = spatial.current_read(observer_id, now).point
    source = (
        source_point if source_point is not None else spatial.current_read(source_id, now).point
    )
    return observer.distance_to(source) <= radius_tiles * spatial.tile_size


def _bearing(origin: SpatialPoint, target: SpatialPoint) -> str:
    dx, dy = target.x - origin.x, target.y - origin.y
    if math.hypot(dx, dy) < 1:
        return "here"
    directions = (
        "east",
        "southeast",
        "south",
        "southwest",
        "west",
        "northwest",
        "north",
        "northeast",
    )
    return directions[round(math.atan2(dy, dx) / (math.pi / 4)) % 8]


class SpatialAwareness:
    """Render current senses and changes since the last successfully prepared decision.

    Rendering only reads the world. ``commit`` remembers the most recent rendered
    view, so an initial perception and a later inference-queue refresh compare to
    the same prior decision rather than to each other.
    """

    def __init__(
        self, world: WorldState, agent_id: str, *, radius_tiles: float = SPATIAL_SENSE_RADIUS_TILES
    ) -> None:
        """Bind senses to one being; retain only previously visible public facts."""
        self.world = world
        self.agent_id = agent_id
        self.radius_tiles = radius_tiles
        self._previous: dict[str, str] = {}
        self._pending: dict[str, str] = {}
        self._previous_facts: dict[str, str] = {}
        self._pending_facts: dict[str, str] = {}
        self._previous_region: str | None = None
        self._pending_region: str | None = None

    def commit(self) -> None:
        """Remember the last rendered view without mutating the world."""
        self._previous = dict(self._pending)
        self._previous_facts = dict(self._pending_facts)
        self._previous_region = self._pending_region

    def render(self, now: float) -> str:
        """Describe position, journey, nearby public facts and known destinations."""
        spatial = self.world.spatial_for_agent(self.agent_id)
        agent = self.world.get_agent(self.agent_id)
        if (
            spatial is None
            or agent is None
            or not spatial.active_in_region(self.agent_id, agent.current_position)
        ):
            self._pending = {}
            self._pending_facts = {}
            self._pending_region = None
            return ""
        self._pending_region = spatial.region_id
        sample = spatial.position_at(self.agent_id, now)
        point = _point(sample)
        size = spatial.tile_size
        radius = self.radius_tiles * size
        lines = [
            f"Observed now (time {now:.1f}; distances in tiles; north is up):",
            f"- Your position: ({point.x / size:.1f}, {point.y / size:.1f}) "
            f"in {spatial.region_id}.",
        ]
        if self._previous_region is not None and self._previous_region != spatial.region_id:
            lines.append(
                f"- You entered {spatial.region_id} from {self._previous_region}. "
                "Coordinates and destination IDs below refer to this region."
            )
        travel = sample.get("travel")
        if isinstance(travel, dict):
            remaining = max(0.0, float(travel["arrives_at"]) - now)
            lines.append(
                f"- Walking toward {travel['destination_id']}; about {remaining:.0f}s to arrive. "
                "You may stop_moving or choose another go_to destination."
            )
            destination_region = travel.get("destination_region")
            if isinstance(destination_region, str):
                lines.append(
                    f"- Regional journey to {destination_region}: following the path to its exit. "
                    "You will enter at the matching entrance; "
                    "stop_moving or go_to cancels this journey."
                )
        else:
            lines.append(f"- Standing at {sample['at_landmark'] or 'an open path'}.")
        ordered = sorted(
            spatial.landmarks, key=lambda site: (point.distance_to(site.point()), site.id)
        )
        region = self.world.get_region(spatial.region_id)
        # Reuse the authoritative snapshot's landmark and travel state instead of
        # recomputing proximity. In particular, an unfinalized arrival is still
        # walking, matching SpatialWorld.can_gather.
        current_site = next((site for site in ordered if site.id == sample["at_landmark"]), None)
        lines.append("Harvesting at your current position:")
        for resource in ("energy", "materials"):
            if (
                travel is None
                and current_site is not None
                and resource in current_site.affordances
                and region is not None
            ):
                supply = region.current_energy if resource == "energy" else region.current_materials
                status = "harvestable" if supply > 0 else "depleted"
                lines.append(f"- {resource}: {status} here; shared supply {supply:g}.")
            else:
                reason = "while walking" if travel is not None else "here"
                site = next((item for item in ordered if resource in item.affordances), None)
                destination = (
                    f"nearest known matching site: {site.name} [destination_id: {site.id}]."
                    if site is not None
                    else "no matching site is known in this region."
                )
                lines.append(f"- {resource}: unavailable {reason}; {destination}")
        self._pending = {}
        self._pending_facts = {}
        nearby: list[tuple[float, str]] = []
        for other in self.world.get_agents_in_region(spatial.region_id):
            if other.id == agent.id or not spatial.has_agent(other.id):
                continue
            other_read = spatial.current_read(other.id, now)
            target = other_read.point
            distance = point.distance_to(target)
            if distance > radius:
                continue
            action = (
                f"walking toward {other_read.destination_id}"
                if other_read.destination_id is not None
                else "standing"
            )
            detail = (
                f"{other.name} [id: {other.id}]: {distance / size:.1f} tiles "
                f"{_bearing(point, target)}, {action}, {other.status.value}"
            )
            nearby.append((distance, detail))
            self._pending[other.id] = other.name
        lines.append(f"- Beings in sight ({len(nearby)} within {self.radius_tiles:g} tiles):")
        lines.extend(f"  {detail}" for _, detail in sorted(nearby)[:24])
        if not nearby:
            lines.append("  No other being is in sight.")
        elif len(nearby) > 24:
            lines.append(f"  {len(nearby) - 24} more beings are farther away in this crowded view.")
        entered = self._pending.keys() - self._previous.keys()
        departed = self._previous.keys() - self._pending.keys()
        if entered or departed:
            lines.append("Changes since your previous decision:")
            if entered:
                lines.append(
                    "- Now in view: " + ", ".join(self._pending[key] for key in sorted(entered))
                )
            if departed:
                lines.append(
                    "- No longer in view (whereabouts unknown): "
                    + ", ".join(self._previous[key] for key in sorted(departed))
                )
        # Always offer both gathering types, even when the nearest landmarks are plots.
        chosen = ordered[:8]
        for kind in ("energy", "materials", "exit"):
            site = next((item for item in ordered if kind in item.affordances), None)
            if site is not None and site not in chosen:
                chosen.append(site)
        # Every connected exit is actionable route knowledge, even when distant.
        chosen.extend(site for site in ordered if "exit" in site.affordances and site not in chosen)
        lines.append(
            "Known destinations (route knowledge; distant activity and supplies are unobserved):"
        )
        for site in chosen:
            distance = point.distance_to(site.point())
            lines.append(
                f"- {site.name} [destination_id: {site.id}], {distance / size:.1f} tiles "
                f"{_bearing(point, site.point())}; {', '.join(site.affordances)}; "
                f"{'in view' if distance <= radius else 'outside view'}."
            )
            if distance <= radius and region is not None:
                if "energy" in site.affordances:
                    self._pending_facts[f"{spatial.region_id}:energy"] = (
                        f"Visible energy supply: {region.current_energy:g}"
                    )
                    lines.append(
                        "  Energy available here: shared regional supply "
                        f"{region.current_energy:g}/{region.max_energy:g}."
                    )
                if "materials" in site.affordances:
                    self._pending_facts[f"{spatial.region_id}:materials"] = (
                        f"Visible materials supply: {region.current_materials:g}"
                    )
                    lines.append(
                        "  Materials available here: shared regional supply "
                        f"{region.current_materials:g}/{region.max_materials:g}."
                    )
        homes = []
        for home in self.world.homes_in_region(spatial.region_id):
            plot = spatial.home_plot(home.home_id)
            if plot is None or point.distance_to(plot.door) > radius:
                continue
            detail = (
                f"- {home.home_id}, {home.status.value}, kept by {home.owner_id}: "
                f"{point.distance_to(plot.door) / size:.1f} tiles {_bearing(point, plot.door)}; "
                f"door destination_id: plot-{plot.id}; soundness {home.integrity:.1f}."
            )
            homes.append(detail)
            self._pending_facts[f"{spatial.region_id}:home:{home.home_id}"] = (
                f"{home.home_id}: {home.status.value}"
            )
            if home.status is HomeStatus.RUIN:
                homes.append(f"  Visible remnant: {home.remnant_materials:g} materials.")
            elif self.world.is_stakeholder(home.home_id, self.agent_id):
                homes.append(f"  Your shared home's store: {home.vault_materials:g} materials.")
        lines.append("Nearby homes and ruins:")
        lines.extend(homes or ["- No home is in sight."])
        changed = [
            value
            for key, value in self._pending_facts.items()
            if key in self._previous_facts and self._previous_facts[key] != value
        ]
        if changed:
            lines.append("Changed since last seen:")
            lines.extend(f"- {fact}" for fact in changed)
        paths = []
        for name, dx, dy in (("north", 0, -1), ("east", 1, 0), ("south", 0, 1), ("west", -1, 0)):
            clear = spatial.is_walkable(point.x + dx * size, point.y + dy * size)
            paths.append(f"{name}: {'open ground' if clear else 'blocked by terrain or structure'}")
        lines.append("- Adjacent ground: " + "; ".join(paths) + ".")
        lines.append(
            "Gathering requires arrival at a matching site. Distances above are direct; "
            "walking follows paths around obstacles."
        )
        return "\n".join(lines)

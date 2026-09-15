"""Deterministic, map-backed movement for optional regional spatial maps.

The legacy world remains region based. A :class:`SpatialWorld` can be attached
for each region with an exported production collision grid, where it supplies
continuous pixel positions, ordinary four-neighbour A* routes, and durable
travel records. It intentionally owns no event bus: tools and the runner turn
its returned navigation events into observable simulation events.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import ClassVar, Literal, cast

type SpatialJson = dict[str, object]
"""JSON-ready object used by spatial snapshots and exported map metadata."""

DEFAULT_TRAVEL_SPEED_PX_PER_SECOND: float = 32.0
"""Walking speed: one authoritative 32-pixel map tile per second."""


class SpatialNavigationError(ValueError):
    """Base error for malformed spatial data or an impossible navigation request."""


class SpatialConfigError(SpatialNavigationError):
    """Raised when an exported spatial-navigation artifact is malformed."""


class SpatialRouteUnavailableError(SpatialNavigationError):
    """Raised when two legal positions have no route through the collision grid."""


# Compatibility for callers that adopted the pilot's initial exception spelling.
SpatialRouteUnavailable = SpatialRouteUnavailableError


@dataclass(frozen=True, slots=True)
class SpatialPoint:
    """One continuous, real-world pixel coordinate.

    Args:
        x: Horizontal pixel coordinate in the exported region map.
        y: Vertical pixel coordinate in the exported region map.
    """

    x: float
    y: float

    def distance_to(self, other: SpatialPoint) -> float:
        """Return the Euclidean distance to ``other`` in world pixels.

        Args:
            other: Endpoint to measure.

        Returns:
            The non-negative pixel distance.
        """
        return math.hypot(other.x - self.x, other.y - self.y)

    def to_json(self) -> SpatialJson:
        """Return a detached JSON-ready point.

        Returns:
            ``{"x": float, "y": float}``.
        """
        return {"x": self.x, "y": self.y}


@dataclass(frozen=True, slots=True)
class SpatialCurrentRead:
    """The minimal fresh state needed for physical proximity reads.

    Args:
        point: Continuous agent coordinate at the requested observation time.
        destination_id: Active journey's destination, or ``None`` when stopped.
        observed_at: Validated world-clock time used to calculate ``point``.

    This intentionally excludes landmark state, route coordinates, and map
    metadata.  Full observer and snapshot consumers continue to use
    :meth:`SpatialWorld.position_at`.
    """

    point: SpatialPoint
    destination_id: str | None
    observed_at: float


@dataclass(frozen=True, slots=True)
class SpatialLandmark:
    """A named place an agent can visit in the shared walkable map.

    Args:
        id: Stable machine-readable destination id.
        name: Human-readable place name.
        x: Horizontal real-world pixel anchor.
        y: Vertical real-world pixel anchor.
        affordances: Resource types available while stopped at this site.
    """

    id: str
    name: str
    x: float
    y: float
    affordances: tuple[str, ...]

    def point(self) -> SpatialPoint:
        """Return this landmark's detached coordinate.

        Returns:
            A pixel-coordinate point.
        """
        return SpatialPoint(self.x, self.y)

    def to_json(self) -> SpatialJson:
        """Return a detached JSON-ready landmark record.

        Returns:
            A stable landmark object suitable for a region snapshot.
        """
        return {
            "id": self.id,
            "name": self.name,
            "x": self.x,
            "y": self.y,
            "affordances": list(self.affordances),
        }


@dataclass(frozen=True, slots=True)
class SpatialGate:
    """One directed inter-region threshold authored in an exported region map.

    A departure gate lives in its ``from_region`` map; an arrival gate lives in
    its ``to_region`` map.  The paired landmark is deliberately conventional so
    the map remains independently useful to local walking: ``gate-<to>`` for a
    departure and ``arrival-<from>`` for an entrance.

    Args:
        from_region: Region a traveller leaves on this directed connection.
        to_region: Region a traveller enters on this directed connection.
        role: Whether this map exposes the departure or arrival side.
        x: Exact walkable pixel coordinate of the threshold.
        y: Exact walkable pixel coordinate of the threshold.
    """

    from_region: str
    to_region: str
    role: Literal["departure", "arrival"]
    x: float
    y: float

    def point(self) -> SpatialPoint:
        """Return the exact threshold coordinate."""
        return SpatialPoint(self.x, self.y)

    @property
    def landmark_id(self) -> str:
        """Return the required local landmark identifier for this gate."""
        if self.role == "departure":
            return f"gate-{self.to_region}"
        return f"arrival-{self.from_region}"

    def to_json(self) -> SpatialJson:
        """Return a detached gate record retained in spatial metadata."""
        return {
            "from_region": self.from_region,
            "to_region": self.to_region,
            "role": self.role,
            "x": self.x,
            "y": self.y,
        }


@dataclass(frozen=True, slots=True)
class SpatialStagingPoint:
    """A legal anchor used to place founders and newborns on the map.

    Args:
        id: Stable staging-point identifier.
        x: Horizontal real-world pixel anchor.
        y: Vertical real-world pixel anchor.
    """

    id: str
    x: float
    y: float

    def point(self) -> SpatialPoint:
        """Return this staging point as a pixel coordinate.

        Returns:
            A detached point.
        """
        return SpatialPoint(self.x, self.y)


@dataclass(frozen=True, slots=True)
class SpatialHomeFootprint:
    """An explicitly exported hard home footprint for route planning.

    Visual landmark envelopes are deliberately not converted into these hard
    blocks.  This type is only for a map artifact that explicitly declares a
    home footprint to be non-walkable for the simulation.

    Args:
        id: Stable footprint id.
        x: Left pixel edge.
        y: Top pixel edge.
        width: Positive pixel width.
        height: Positive pixel height.
    """

    id: str
    x: float
    y: float
    width: float
    height: float

    def contains(self, point: SpatialPoint) -> bool:
        """Return whether ``point`` lies in this hard footprint.

        Args:
            point: Pixel coordinate to test.

        Returns:
            ``True`` for a point within the closed footprint rectangle.
        """
        return (
            self.x <= point.x <= self.x + self.width and self.y <= point.y <= self.y + self.height
        )


@dataclass(frozen=True, slots=True)
class SpatialHomePlot:
    """One exported shelter plot that may be occupied by one runtime home.

    The plot anchor and door are authored production-map coordinates.  Its hard
    rectangles are dormant until a world home is assigned here, so a bare map
    retains its intended open staging ground.

    Args:
        id: Stable production shelter-plot identifier.
        x: Authored shelter-render origin x coordinate.
        y: Authored shelter-render origin y coordinate.
        door: Walkable home-interaction point.
        hard_footprints: Renderer-derived wall/roof exclusion rectangles.
    """

    id: str
    x: float
    y: float
    door: SpatialPoint
    hard_footprints: tuple[SpatialHomeFootprint, ...]

    def to_snapshot(self, *, region_id: str, map_id: str) -> SpatialJson:
        """Return the per-home spatial record consumed by observers.

        Args:
            region_id: The map's owning region id.
            map_id: The concrete production-map identity.

        Returns:
            A detached v1 home spatial record.
        """
        return {
            "version": 1,
            "region_id": region_id,
            "map_id": map_id,
            "plot_id": self.id,
            "x": self.x,
            "y": self.y,
            "door": self.door.to_json(),
        }


@dataclass(frozen=True, slots=True)
class SpatialTravel:
    """A durable, timed route between an agent's current point and a landmark.

    Args:
        id: Stable id for this travel attempt.
        agent_id: Being following the route.
        destination_id: Target landmark id.
        route: Ordered continuous route points, including both endpoints.
        started_at: World-clock time at which travel began.
        arrives_at: World-clock time at which travel completes.
        speed: Walking speed in pixels per second.
    """

    id: str
    agent_id: str
    destination_id: str
    route: tuple[SpatialPoint, ...]
    started_at: float
    arrives_at: float
    speed: float
    destination_region: str | None = None

    @property
    def regional_destination(self) -> str | None:
        """Return the historical internal spelling for a regional destination."""
        return self.destination_region

    def to_json(self) -> SpatialJson:
        """Return a detached JSON-ready travel record.

        Returns:
            The v1 travel fields retained in an agent spatial snapshot.
        """
        data: SpatialJson = {
            "id": self.id,
            "destination_id": self.destination_id,
            "route": [point.to_json() for point in self.route],
            "started_at": self.started_at,
            "arrives_at": self.arrives_at,
        }
        if self.destination_region is not None:
            data["destination_region"] = self.destination_region
        return data


@dataclass(frozen=True, slots=True)
class SpatialTravelOutcome:
    """The result of asking a spatial world to head toward one landmark.

    Args:
        status: Whether travel was created, was already active, or was unnecessary.
        travel: Current travel record when one exists.
        position: Position at the command's timestamp.
        cancelled: Existing travel cancelled before a different route began.
    """

    status: Literal["started", "already_traveling", "already_at_destination"]
    travel: SpatialTravel | None
    position: SpatialPoint
    cancelled: SpatialNavigationEvent | None = None


@dataclass(frozen=True, slots=True)
class SpatialNavigationEvent:
    """A significant movement transition for tools or the navigator to publish.

    Args:
        kind: Machine-readable movement transition.
        agent_id: Being whose route changed.
        travel: Travel record involved in the transition.
        position: Exact position at the transition timestamp.
        timestamp: World-clock timestamp for the event.
        reason: Optional cancellation reason.
    """

    kind: Literal["travel_cancelled", "travel_arrived"]
    agent_id: str
    travel: SpatialTravel
    position: SpatialPoint
    timestamp: float
    reason: str | None = None


def spatial_travel_event_payload(
    spatial: SpatialWorld,
    travel: SpatialTravel,
    *,
    position: SpatialPoint,
    spatial_state: SpatialJson,
    message: str,
    reason: str | None = None,
) -> SpatialJson:
    """Return the shared v1 event payload for one significant route transition.

    Args:
        spatial: Active map whose identity scopes the route.
        travel: Durable journey record involved in the transition.
        position: Exact coordinate at the transition timestamp.
        spatial_state: Corresponding detached v1 agent spatial state.
        message: Human-readable event narration.
        reason: Optional cancellation cause.

    Returns:
        A JSON-ready payload used unchanged by movement tools and the navigator.
    """
    payload: SpatialJson = {
        "agent_id": travel.agent_id,
        "region_id": spatial.region_id,
        "map_id": spatial.map_id,
        "layout_fingerprint": spatial.layout_fingerprint,
        "travel_id": travel.id,
        "destination_id": travel.destination_id,
        "route": [point.to_json() for point in travel.route],
        "started_at": travel.started_at,
        "arrives_at": travel.arrives_at,
        "position": position.to_json(),
        "spatial": spatial_state,
        "message": message,
    }
    if reason is not None:
        payload["reason"] = reason
    if travel.destination_region is not None:
        payload["destination_region"] = travel.destination_region
    return payload


class SpatialWorld:
    """Optional real-coordinate state for one region's exported collision grid.

    The class stores only discrete anchor positions and travel descriptions.  It
    calculates a continuous position from those durable values when callers use
    :meth:`position_at`; that read never advances world time or mutates state.
    Arrival state transitions happen only through :meth:`tick`.

    Args:
        region_id: Region whose agents may use this map.
        map_id: Stable map identity from the exporter.
        layout_fingerprint: Concrete layout fingerprint from the exporter.
        tile_size: Grid tile size in real-world pixels.
        columns: Grid width in tiles.
        rows: Grid height in tiles.
        collision: Row-major terrain collision values (``True`` means blocked).
        landmarks: Named destinations in stable id order.
        staging_points: Legal spawn/newborn anchors in stable id order.
        home_footprints: Explicit hard footprints, distinct from visual-only art.
        home_plots: Exported shelter plots, initially unoccupied by runtime homes.
        metadata: Extra exporter metadata retained for consumers but not navigation.
    """

    version: int = 1

    def __init__(
        self,
        *,
        region_id: str,
        map_id: str,
        layout_fingerprint: str,
        tile_size: int,
        columns: int,
        rows: int,
        collision: tuple[bool, ...],
        landmarks: tuple[SpatialLandmark, ...],
        gates: tuple[SpatialGate, ...],
        staging_points: tuple[SpatialStagingPoint, ...],
        home_footprints: tuple[SpatialHomeFootprint, ...],
        home_plots: tuple[SpatialHomePlot, ...],
        initial_pressure: SpatialJson,
        metadata: SpatialJson,
    ) -> None:
        """Initialise validated spatial state with no agents yet placed.

        Args:
            region_id: Region id that activates this map.
            map_id: Exported map identifier.
            layout_fingerprint: Exported concrete-layout fingerprint.
            tile_size: Tile width and height in pixels.
            columns: Grid column count.
            rows: Grid row count.
            collision: Row-major blocked/open terrain data.
            landmarks: Legal named destinations.
            gates: Directed region thresholds authored beside local landmarks.
            staging_points: Legal deterministic spawn points.
            home_footprints: Explicit hard route exclusions.
            home_plots: Exported plots that acquire hard exclusions when a home uses one.
            initial_pressure: Pressure that selected the concrete exported recipe.
            metadata: Detached additional exporter metadata.
        """
        self.region_id = region_id
        self.map_id = map_id
        self.layout_fingerprint = layout_fingerprint
        self.tile_size = tile_size
        self.columns = columns
        self.rows = rows
        self._collision = collision
        self.landmarks = landmarks
        self.gates = gates
        self.staging_points = staging_points
        self.home_footprints = home_footprints
        self.home_plots = home_plots
        self.initial_pressure = initial_pressure
        self.metadata = metadata
        self._landmarks_by_id = {landmark.id: landmark for landmark in landmarks}
        self._departure_gates_by_destination = {
            gate.to_region: gate for gate in gates if gate.role == "departure"
        }
        self._arrival_gates_by_source = {
            gate.from_region: gate for gate in gates if gate.role == "arrival"
        }
        self._staging_by_id = {point.id: point for point in staging_points}
        self._home_plots_by_id = {plot.id: plot for plot in home_plots}
        self._home_plots_by_home_id: dict[str, SpatialHomePlot] = {}
        self._home_ids_by_plot_id: dict[str, str] = {}
        self._positions: dict[str, SpatialPoint] = {}
        self._tile_hints: dict[str, tuple[int, int]] = {}
        self._travels: dict[str, SpatialTravel] = {}
        self._travel_sequences: dict[str, int] = {}
        self._queued_events: list[SpatialNavigationEvent] = []

    @classmethod
    def from_mapping(cls, raw: Mapping[str, object]) -> SpatialWorld:
        """Validate an exported v1 navigation artifact and construct a map.

        Args:
            raw: Parsed JSON mapping emitted by the map exporter.

        Returns:
            A map with no agents placed yet.

        Raises:
            SpatialConfigError: If required metadata, grid data, or anchors are
                missing, malformed, outside the map, or not walkable.
        """
        data = _mapping(raw, "spatial navigation artifact")
        version = _int(data.get("version"), "version")
        if version != cls.version:
            raise SpatialConfigError(
                f"Unsupported spatial-navigation version {version}; expected 1."
            )
        region_id = _identifier(data.get("region_id"), "region_id")
        map_id = _identifier(data.get("map_id"), "map_id")
        layout_fingerprint = _identifier(data.get("layout_fingerprint"), "layout_fingerprint")
        tile_size = _positive_int(data.get("tile_size"), "tile_size")
        columns = _positive_int(data.get("width"), "width")
        rows = _positive_int(data.get("height"), "height")
        collision = _walkable_values(data.get("walkable"), columns, rows)
        initial_pressure = _initial_pressure(data.get("initial_pressure"))
        topology = data.get("topology", "bounded")
        if topology != "bounded":
            raise SpatialConfigError("The spatial pilot requires bounded topology.")
        provisional = cls(
            region_id=region_id,
            map_id=map_id,
            layout_fingerprint=layout_fingerprint,
            tile_size=tile_size,
            columns=columns,
            rows=rows,
            collision=collision,
            landmarks=(),
            gates=(),
            staging_points=(),
            home_footprints=(),
            home_plots=(),
            initial_pressure=initial_pressure,
            metadata=_export_metadata(data),
        )
        home_footprints = _home_footprints(data.get("home_footprints"))
        provisional.home_footprints = home_footprints
        home_plots = _home_plots(data.get("home_plots"), provisional)
        provisional.home_plots = home_plots
        provisional._home_plots_by_id = {plot.id: plot for plot in home_plots}
        landmarks = _landmarks(data.get("landmarks"), provisional)
        gates = _gates(data.get("gates"), provisional)
        staging_points = _staging_points(data.get("spawn_points"), provisional)
        if not staging_points:
            raise SpatialConfigError(
                "spatial navigation artifact requires at least one staging point."
            )
        provisional.landmarks = landmarks
        provisional.gates = gates
        provisional.staging_points = staging_points
        provisional._landmarks_by_id = {landmark.id: landmark for landmark in landmarks}
        provisional._departure_gates_by_destination = {
            gate.to_region: gate for gate in gates if gate.role == "departure"
        }
        provisional._arrival_gates_by_source = {
            gate.from_region: gate for gate in gates if gate.role == "arrival"
        }
        provisional._validate_gate_landmarks()
        provisional._staging_by_id = {point.id: point for point in staging_points}
        return provisional

    @classmethod
    def from_path(cls, path: str | Path) -> SpatialWorld:
        """Load and validate a JSON spatial-navigation artifact from disk.

        Args:
            path: Path to the exported JSON file.

        Returns:
            A validated spatial world with no agents placed.

        Raises:
            SpatialConfigError: If the file cannot be read, parsed, or validated.
        """
        source = Path(path)
        try:
            decoded = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SpatialConfigError(
                f"Could not load spatial navigation artifact {source}: {exc}"
            ) from exc
        if not isinstance(decoded, Mapping):
            raise SpatialConfigError("spatial navigation artifact must be a JSON object.")
        return cls.from_mapping(cast(Mapping[str, object], decoded))

    def has_agent(self, agent_id: str) -> bool:
        """Return whether the agent currently has an active position on this map.

        Args:
            agent_id: Being id to inspect.

        Returns:
            ``True`` when an active spatial position is stored.
        """
        return agent_id in self._positions

    def active_travel(self, agent_id: str) -> SpatialTravel | None:
        """Return an agent's active route without advancing simulation time.

        Args:
            agent_id: Being whose durable route should be inspected.

        Returns:
            The active route, or ``None`` when the being is stopped or absent.
        """
        return self._travels.get(agent_id)

    def active_in_region(self, agent_id: str, region_id: str) -> bool:
        """Return whether one agent is active on this exact spatial region.

        Args:
            agent_id: Being id to inspect.
            region_id: Legacy world region to compare.

        Returns:
            ``True`` only when both the region and stored spatial position match.
        """
        return region_id == self.region_id and self.has_agent(agent_id)

    def spawn(
        self,
        agent_id: str,
        *,
        staging_id: str | None = None,
        now: float = 0.0,
    ) -> SpatialPoint:
        """Place an agent at a deterministic legal staging point.

        Existing agents retain their current coordinate.  A supplied ``staging_id``
        is useful for explicit seeded placement; otherwise a stable SHA-256 digest
        of the id selects among sorted legal staging anchors.

        Args:
            agent_id: Being to place.
            staging_id: Optional explicit legal staging point id.
            now: World-clock time used to avoid active walkers' interpolated feet.

        Returns:
            The active pixel coordinate.

        Raises:
            SpatialNavigationError: If the id is invalid or no distinct legal
                placement remains.
        """
        _finite(now, "now")
        if not agent_id:
            raise SpatialNavigationError("agent_id must be a non-empty string.")
        existing = self._positions.get(agent_id)
        if existing is not None:
            return existing
        staging = self._preferred_staging(agent_id, staging_id)
        point = self._select_spawn_point(staging, now)
        self._positions[agent_id] = point
        self._tile_hints[agent_id] = self._tile_for_point(point)
        return point

    def leave_region(
        self,
        agent_id: str,
        now: float,
        *,
        reason: str,
        queue_event: bool = False,
    ) -> SpatialNavigationEvent | None:
        """Cancel travel and remove an agent from this map as it enters a legacy region.

        Args:
            agent_id: Being leaving the spatial region.
            now: Current world-clock time.
            reason: Human-readable cause for the cancellation record.
            queue_event: Whether the navigator should publish the cancellation.

        Returns:
            A cancellation event if a journey was active, otherwise ``None``.
        """
        event = self.cancel_travel(agent_id, now, reason=reason, queue_event=queue_event)
        self._positions.pop(agent_id, None)
        self._tile_hints.pop(agent_id, None)
        return event

    def remove_agent(self, agent_id: str) -> None:
        """Forget all spatial state for an agent permanently removed from the world.

        Args:
            agent_id: Being whose state is removed.

        Returns:
            None.
        """
        self._positions.pop(agent_id, None)
        self._tile_hints.pop(agent_id, None)
        self._travels.pop(agent_id, None)

    def is_tile_walkable(self, column: int, row: int) -> bool:
        """Return whether a grid tile is terrain-open and outside hard footprints.

        Args:
            column: Zero-based tile column.
            row: Zero-based tile row.

        Returns:
            ``True`` when a walker may occupy the tile centre.
        """
        if not 0 <= column < self.columns or not 0 <= row < self.rows:
            return False
        if self._collision[row * self.columns + column]:
            return False
        return not any(
            footprint.contains(self._tile_center(column, row))
            for footprint in self._active_home_footprints()
        )

    def is_walkable(self, x: float, y: float) -> bool:
        """Return whether a real-world pixel point falls on a legal tile.

        Args:
            x: Horizontal real-world pixel coordinate.
            y: Vertical real-world pixel coordinate.

        Returns:
            ``True`` only when the coordinate's tile is legal for walking.
        """
        if not math.isfinite(x) or not math.isfinite(y):
            return False
        return self.is_tile_walkable(
            math.floor(x / self.tile_size),
            math.floor(y / self.tile_size),
        )

    def get_landmark(self, destination_id: str) -> SpatialLandmark | None:
        """Look up one named destination.

        Args:
            destination_id: Stable landmark id.

        Returns:
            The landmark or ``None`` when it does not exist.
        """
        return self._landmarks_by_id.get(destination_id)

    def departure_gate(self, destination_region: str) -> SpatialGate | None:
        """Return this map's directed departure gate toward ``destination_region``."""
        return self._departure_gates_by_destination.get(destination_region)

    def arrival_gate(self, source_region: str) -> SpatialGate | None:
        """Return this map's directed arrival gate from ``source_region``."""
        return self._arrival_gates_by_source.get(source_region)

    def place_at(self, agent_id: str, point: SpatialPoint, now: float) -> SpatialPoint:
        """Place a newly entering agent at one exact authored walkable coordinate.

        This deliberately does not use the deterministic staging selector.  A
        regional handoff must enter at its matched arrival threshold, even when
        that coordinate is not a spawn point.  Walkers are not solid in the
        existing navigation model, so a gate remains usable when somebody is
        already standing there.

        Args:
            agent_id: Being entering this map.
            point: Exact authored entrance coordinate.
            now: World-clock value used for validation parity with ``spawn``.

        Returns:
            The stored detached coordinate.

        Raises:
            SpatialNavigationError: If the id is invalid, already active, or the
                supplied coordinate is not legal ground.
        """
        _finite(now, "now")
        if not agent_id:
            raise SpatialNavigationError("agent_id must be a non-empty string.")
        if agent_id in self._positions:
            raise SpatialNavigationError(f"Agent {agent_id!r} already has a spatial position.")
        if not self.is_walkable(point.x, point.y):
            raise SpatialNavigationError("Arrival coordinate is not on walkable terrain.")
        self._positions[agent_id] = point
        self._tile_hints[agent_id] = self._tile_for_point(point)
        return point

    def can_assign_home(self, now: float) -> bool:
        """Return whether one unoccupied legal production plot remains.

        A plot is ineligible when its new walls would cover any current spatial
        position.  This check includes agents in motion so a newly-built home
        never appears around a walker; existing routes that would later reach a
        new wall are separately cancelled by :meth:`assign_home`.

        Args:
            now: World-clock time at which current positions are assessed.

        Returns:
            ``True`` when at least one compatible unoccupied plot exists.
        """
        _finite(now, "now")
        return any(self._plot_is_eligible(plot, now) for plot in self.home_plots)

    def assign_home(self, home_id: str, now: float) -> SpatialHomePlot:
        """Assign one runtime home to a stable, legal, unoccupied plot.

        The sorted plot set is addressed by a SHA-256 home-id offset followed by
        deterministic linear probing.  It is therefore reproducible for an
        identical sequence of home builds while still spreading homes across the
        authored plots.  Assignments remain attached to a home after it becomes a
        ruin; only :meth:`release_home` frees a plot.

        If the new hard rectangles block a remaining journey, that journey stops
        at its exact current coordinate and a cancellation is queued for the
        navigator.  No route is silently bent or teleported around a new home.

        Args:
            home_id: Stable world-home identifier to assign.
            now: Current world-clock time.

        Returns:
            The newly or previously assigned plot.

        Raises:
            SpatialNavigationError: If no legal plot is available.
        """
        _finite(now, "now")
        if not home_id:
            raise SpatialNavigationError("home_id must be a non-empty string.")
        existing = self._home_plots_by_home_id.get(home_id)
        if existing is not None:
            return existing
        plot = self._select_home_plot(home_id, now)
        if plot is None:
            raise SpatialNavigationError("No unoccupied shelter plot can safely hold a home.")
        self._home_plots_by_home_id[home_id] = plot
        self._home_ids_by_plot_id[plot.id] = home_id
        self._cancel_routes_blocked_by(plot.hard_footprints, now)
        return plot

    def release_home(self, home_id: str) -> None:
        """Free a plot only when its world home is permanently removed.

        Args:
            home_id: World-home identifier whose plot should be released.

        Returns:
            None.
        """
        plot = self._home_plots_by_home_id.pop(home_id, None)
        if plot is not None:
            self._home_ids_by_plot_id.pop(plot.id, None)

    def home_snapshot(self, home_id: str) -> SpatialJson | None:
        """Return one assigned home's observer-facing spatial metadata.

        Args:
            home_id: World-home identifier to look up.

        Returns:
            A detached v1 record, or ``None`` when the home is not on this map.
        """
        plot = self._home_plots_by_home_id.get(home_id)
        if plot is None:
            return None
        return plot.to_snapshot(region_id=self.region_id, map_id=self.map_id)

    def home_plot(self, home_id: str) -> SpatialHomePlot | None:
        """Return the immutable plot assigned to one home, if any.

        Args:
            home_id: World-home identifier to look up.

        Returns:
            The assigned plot or ``None``.
        """
        return self._home_plots_by_home_id.get(home_id)

    def position_at(self, agent_id: str, now: float) -> SpatialJson:
        """Read an agent's continuous position without mutating any travel state.

        Args:
            agent_id: Being whose location is requested.
            now: World-clock time at which to observe the route.

        Returns:
            A v1 spatial snapshot with coordinates, landmark state, and any
            active travel record.

        Raises:
            KeyError: If the agent is not active in this spatial region.
            SpatialNavigationError: If ``now`` is non-finite.
        """
        _finite(now, "now")
        point = self._point_at(agent_id, now)
        return self.snapshot_at_position(point, now, travel=self._travels.get(agent_id))

    def current_read(self, agent_id: str, now: float) -> SpatialCurrentRead:
        """Read fresh coordinates and the active destination without building a snapshot.

        This is the hot read for nearby-being perception and proximity routing.
        It calculates a continuous point at every call but deliberately avoids
        landmark lookup, route serialization, and map metadata.  As with
        :meth:`position_at`, a journey remains visible through its nominal
        arrival time until :meth:`tick` records its arrival and clears it.

        Args:
            agent_id: Being whose current coordinate is requested.
            now: World-clock time at which to observe the route.

        Returns:
            A typed, non-mutating coordinate and active-destination read.

        Raises:
            KeyError: If the agent is not active in this spatial region.
            SpatialNavigationError: If ``now`` is non-finite.
        """
        observed_at = _finite(now, "now")
        point = self._point_at(agent_id, observed_at)
        travel = self._travels.get(agent_id)
        return SpatialCurrentRead(
            point=point,
            destination_id=travel.destination_id if travel is not None else None,
            observed_at=observed_at,
        )

    def snapshot_at_position(
        self,
        point: SpatialPoint,
        now: float,
        *,
        travel: SpatialTravel | None,
    ) -> SpatialJson:
        """Return a v1 spatial snapshot for an explicit transition coordinate.

        This is used for a cancellation event after a redirect has already begun:
        the event must preserve the stopped point with ``travel: null`` rather
        than accidentally serialize the replacement journey.

        Args:
            point: Exact transition coordinate.
            now: World-clock observation time.
            travel: Travel to include, or ``None`` for a stopped/arrived state.

        Returns:
            A detached v1 spatial JSON object.

        Raises:
            SpatialNavigationError: If time or coordinates are non-finite.
        """
        _finite(now, "now")
        _finite(point.x, "point.x")
        _finite(point.y, "point.y")
        at_landmark = self._landmark_at(point)
        metadata: SpatialJson = {
            "version": self.version,
            "region_id": self.region_id,
            "map_id": self.map_id,
            "layout_fingerprint": self.layout_fingerprint,
            "x": point.x,
            "y": point.y,
            "observed_at": now,
            "at_landmark": at_landmark.id if at_landmark is not None else None,
            "travel": travel.to_json() if travel is not None else None,
        }
        return metadata

    def spatial_metadata(self) -> SpatialJson:
        """Return detached region-level metadata for reconnecting observers.

        Returns:
            The v1 map identity, tile geometry, and named landmark affordances.
        """
        metadata: SpatialJson = {
            "version": self.version,
            "region_id": self.region_id,
            "map_id": self.map_id,
            "layout_fingerprint": self.layout_fingerprint,
            "tile_size": self.tile_size,
            "columns": self.columns,
            "rows": self.rows,
            "topology": "bounded",
            "initial_pressure": dict(self.initial_pressure),
            "landmarks": [landmark.to_json() for landmark in self.landmarks],
        }
        if self.gates:
            metadata["gates"] = [gate.to_json() for gate in self.gates]
        return metadata

    def can_gather(self, agent_id: str, resource_type: str, now: float) -> SpatialLandmark | None:
        """Return the compatible site when a stopped agent may gather a resource.

        Args:
            agent_id: Being attempting the gather.
            resource_type: Resource type name, such as ``"energy"``.
            now: Current world-clock time.

        Returns:
            The matched landmark when stopped at a compatible site; otherwise
            ``None``.
        """
        if agent_id not in self._positions or agent_id in self._travels:
            return None
        landmark = self._landmark_at(self._point_at(agent_id, now))
        if landmark is None or resource_type not in landmark.affordances:
            return None
        return landmark

    def _validate_gate_landmarks(self) -> None:
        """Require every typed gate to agree with its local landmark contract."""
        for gate in self.gates:
            expected_owner = gate.from_region if gate.role == "departure" else gate.to_region
            if expected_owner != self.region_id:
                raise SpatialConfigError(
                    f"{gate.role.title()} gate {gate.from_region!r}->{gate.to_region!r} "
                    f"does not belong to map {self.region_id!r}."
                )
            landmark = self._landmarks_by_id.get(gate.landmark_id)
            if landmark is None:
                raise SpatialConfigError(
                    f"Gate {gate.from_region!r}->{gate.to_region!r} requires landmark "
                    f"{gate.landmark_id!r}."
                )
            if landmark.point().distance_to(gate.point()) > 0.000_001:
                raise SpatialConfigError(
                    f"Gate {gate.from_region!r}->{gate.to_region!r} must match landmark "
                    f"{gate.landmark_id!r}."
                )
            expected_affordance = "exit" if gate.role == "departure" else "entrance"
            if expected_affordance not in landmark.affordances:
                raise SpatialConfigError(
                    f"Gate landmark {gate.landmark_id!r} requires {expected_affordance!r} "
                    "affordance."
                )

    def begin_travel(
        self,
        agent_id: str,
        destination_id: str,
        now: float,
        *,
        speed: float = DEFAULT_TRAVEL_SPEED_PX_PER_SECOND,
        destination_region: str | None = None,
    ) -> SpatialTravelOutcome:
        """Plan a deterministic route to one landmark without teleporting.

        Repeating the same active destination is idempotent: the existing travel
        id and timing are retained.  A different destination first computes a
        viable route from the current continuous point; only then is the old route
        cancelled and replaced.

        Args:
            agent_id: Being that will walk.
            destination_id: Landmark id to visit.
            now: Current world-clock time.
            speed: Positive walking speed in pixels per second.
            destination_region: Optional target region reached only when this
                local route arrives at a validated departure gate.

        Returns:
            A result describing a new, retained, or unnecessary journey.

        Raises:
            SpatialNavigationError: If agent, destination, time, or speed is invalid.
            SpatialRouteUnavailable: If no walkable route exists.
        """
        _finite(now, "now")
        _positive_finite(speed, "speed")
        if destination_region is not None:
            _identifier(destination_region, "destination_region")
        if agent_id not in self._positions:
            raise SpatialNavigationError(f"Agent {agent_id!r} has no active spatial position.")
        destination = self._landmarks_by_id.get(destination_id)
        if destination is None:
            raise SpatialNavigationError(f"Unknown destination {destination_id!r}.")
        existing = self._travels.get(agent_id)
        current = self._point_at(agent_id, now)
        if (
            existing is not None
            and existing.destination_id == destination_id
            and existing.destination_region == destination_region
        ):
            return SpatialTravelOutcome("already_traveling", existing, current)
        destination_point = destination.point()
        if (
            current.distance_to(destination_point) <= 0.000_001
            and existing is None
            and destination_region is None
        ):
            self._positions[agent_id] = destination_point
            self._tile_hints[agent_id] = self._tile_for_point(destination_point)
            return SpatialTravelOutcome("already_at_destination", None, destination_point)
        start_tile = self._route_start_tile(agent_id, current, existing)
        destination_tile = self._tile_for_point(destination_point)
        if not self.is_tile_walkable(*start_tile):
            raise SpatialRouteUnavailable(f"No legal starting tile for agent {agent_id!r}.")
        if not self.is_tile_walkable(*destination_tile):
            raise SpatialRouteUnavailable(
                f"Destination {destination_id!r} is not on a walkable tile."
            )
        path = self._astar(start_tile, destination_tile)
        route = self._route_points(current, path, destination_point)
        if not self._route_is_clear(route):
            raise SpatialRouteUnavailable(
                f"No walkable route from {agent_id!r} to {destination_id!r} avoids a home."
            )
        distance = sum(left.distance_to(right) for left, right in pairwise(route))
        if distance <= 0.000_001 and destination_region is None:
            self._positions[agent_id] = destination_point
            self._tile_hints[agent_id] = destination_tile
            return SpatialTravelOutcome("already_at_destination", None, destination_point)
        cancelled = (
            self.cancel_travel(agent_id, now, reason="new_destination") if existing else None
        )
        sequence = self._travel_sequences.get(agent_id, 0) + 1
        self._travel_sequences[agent_id] = sequence
        travel = SpatialTravel(
            id=f"{self.region_id}:{agent_id}:travel:{sequence}",
            agent_id=agent_id,
            destination_id=destination_id,
            route=route,
            started_at=now,
            arrives_at=now + distance / speed,
            speed=speed,
            destination_region=destination_region,
        )
        self._positions[agent_id] = current
        self._tile_hints[agent_id] = start_tile
        self._travels[agent_id] = travel
        return SpatialTravelOutcome("started", travel, current, cancelled)

    def cancel_travel(
        self,
        agent_id: str,
        now: float,
        *,
        reason: str = "stopped",
        queue_event: bool = False,
    ) -> SpatialNavigationEvent | None:
        """Stop an active route at its exact current coordinate.

        Args:
            agent_id: Being whose travel should stop.
            now: Current world-clock time.
            reason: Reason retained in the movement event.
            queue_event: Whether a non-tool caller wants the navigator to publish
                the cancellation on its next pass.

        Returns:
            The transition event when travel existed, otherwise ``None``.
        """
        _finite(now, "now")
        travel = self._travels.get(agent_id)
        if travel is None:
            return None
        point = self._point_on_travel(travel, now)
        self._positions[agent_id] = point
        containing_tile = self._tile_for_point(point)
        self._tile_hints[agent_id] = (
            containing_tile
            if self.is_tile_walkable(*containing_tile)
            else self._nearest_route_tile(travel, point)
        )
        del self._travels[agent_id]
        event = SpatialNavigationEvent(
            "travel_cancelled",
            agent_id,
            travel,
            point,
            now,
            reason=reason,
        )
        if queue_event:
            self._queued_events.append(event)
        return event

    def tick(self, now: float) -> list[SpatialNavigationEvent]:
        """Finalize completed routes and return queued significant transitions.

        Args:
            now: Current world-clock time.

        Returns:
            Queued cancellations followed by deterministic arrival transitions.
        """
        _finite(now, "now")
        events = list(self._queued_events)
        self._queued_events.clear()
        for agent_id in sorted(self._travels):
            travel = self._travels[agent_id]
            if now < travel.arrives_at:
                continue
            destination = self._landmarks_by_id[travel.destination_id]
            point = destination.point()
            self._positions[agent_id] = point
            self._tile_hints[agent_id] = self._tile_for_point(point)
            del self._travels[agent_id]
            events.append(
                SpatialNavigationEvent(
                    "travel_arrived",
                    agent_id,
                    travel,
                    point,
                    travel.arrives_at,
                )
            )
        return events

    def _point_at(self, agent_id: str, now: float) -> SpatialPoint:
        """Return continuous agent position at ``now`` without changing state."""
        base = self._positions.get(agent_id)
        if base is None:
            raise KeyError(agent_id)
        travel = self._travels.get(agent_id)
        return self._point_on_travel(travel, now) if travel is not None else base

    def _point_on_travel(self, travel: SpatialTravel, now: float) -> SpatialPoint:
        """Interpolate one immutable travel record at a bounded world-clock time."""
        if now <= travel.started_at:
            return travel.route[0]
        if now >= travel.arrives_at:
            return travel.route[-1]
        elapsed_distance = (now - travel.started_at) * travel.speed
        traversed = 0.0
        for start, end in pairwise(travel.route):
            segment = start.distance_to(end)
            if elapsed_distance <= traversed + segment:
                progress = (elapsed_distance - traversed) / segment if segment else 1.0
                return SpatialPoint(
                    start.x + (end.x - start.x) * progress,
                    start.y + (end.y - start.y) * progress,
                )
            traversed += segment
        return travel.route[-1]

    def _astar(
        self, start: tuple[int, int], destination: tuple[int, int]
    ) -> tuple[tuple[int, int], ...]:
        """Return a deterministic cardinal A* path through authoritative collision."""
        frontier: list[tuple[int, int, int, int]] = []
        heapq.heappush(frontier, (_manhattan(start, destination), 0, start[1], start[0]))
        came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
        costs: dict[tuple[int, int], int] = {start: 0}
        while frontier:
            _, cost, row, column = heapq.heappop(frontier)
            current = (column, row)
            if cost != costs.get(current):
                continue
            if current == destination:
                return _reconstruct_path(came_from, current)
            for neighbor in self._neighbors(current):
                next_cost = cost + 1
                if next_cost >= costs.get(neighbor, math.inf):
                    continue
                costs[neighbor] = next_cost
                came_from[neighbor] = current
                priority = next_cost + _manhattan(neighbor, destination)
                heapq.heappush(frontier, (priority, next_cost, neighbor[1], neighbor[0]))
        raise SpatialRouteUnavailable(
            "No walkable route from tile "
            f"{start[0]},{start[1]} to {destination[0]},{destination[1]}."
        )

    def _neighbors(self, point: tuple[int, int]) -> tuple[tuple[int, int], ...]:
        """Return legal cardinal neighbours in a fixed order for stable A* ties."""
        column, row = point
        candidates = ((column, row - 1), (column - 1, row), (column + 1, row), (column, row + 1))
        start = self._tile_center(column, row)
        return tuple(
            candidate
            for candidate in candidates
            if self.is_tile_walkable(*candidate)
            and self._segment_is_clear(start, self._tile_center(*candidate))
        )

    def _route_start_tile(
        self,
        agent_id: str,
        point: SpatialPoint,
        travel: SpatialTravel | None,
    ) -> tuple[int, int]:
        """Choose a non-teleporting legal A* entry tile for one current point."""
        if travel is not None:
            return self._nearest_route_tile(travel, point)
        hint = self._tile_hints.get(agent_id)
        if hint is not None and self.is_tile_walkable(*hint):
            return hint
        tile = self._tile_for_point(point)
        if self.is_tile_walkable(*tile):
            return tile
        candidates = [
            (column, row)
            for row in range(self.rows)
            for column in range(self.columns)
            if self.is_tile_walkable(column, row)
        ]
        if not candidates:
            raise SpatialRouteUnavailable("Spatial map has no walkable tiles.")
        return min(
            candidates,
            key=lambda candidate: (
                self._tile_center(*candidate).distance_to(point),
                candidate[1],
                candidate[0],
            ),
        )

    def _nearest_route_tile(self, travel: SpatialTravel, point: SpatialPoint) -> tuple[int, int]:
        """Select the closest legal endpoint of the current travel segment."""
        candidates = [self._tile_for_point(route_point) for route_point in travel.route]
        legal = [candidate for candidate in candidates if self.is_tile_walkable(*candidate)]
        if not legal:
            raise SpatialRouteUnavailable("Active travel has no legal route tiles.")
        return min(
            legal,
            key=lambda candidate: (
                self._tile_center(*candidate).distance_to(point),
                candidate[1],
                candidate[0],
            ),
        )

    def _route_points(
        self,
        current: SpatialPoint,
        path: tuple[tuple[int, int], ...],
        destination: SpatialPoint,
    ) -> tuple[SpatialPoint, ...]:
        """Build deduplicated continuous route points from an A* tile path."""
        points: list[SpatialPoint] = [current]
        for tile in path:
            _append_point(points, self._tile_center(*tile))
        _append_point(points, destination)
        return tuple(points)

    def _tile_center(self, column: int, row: int) -> SpatialPoint:
        """Return the center coordinate of one tile."""
        return SpatialPoint(
            column * self.tile_size + self.tile_size / 2,
            row * self.tile_size + self.tile_size / 2,
        )

    def _tile_for_point(self, point: SpatialPoint) -> tuple[int, int]:
        """Return the containing tile for an in-bounds point."""
        column = math.floor(point.x / self.tile_size)
        row = math.floor(point.y / self.tile_size)
        return column, row

    def _landmark_at(self, point: SpatialPoint) -> SpatialLandmark | None:
        """Return the nearest landmark when the point lies within one half-tile."""
        radius = self.tile_size / 2
        candidates = [
            landmark for landmark in self.landmarks if landmark.point().distance_to(point) <= radius
        ]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda landmark: (landmark.point().distance_to(point), landmark.id),
        )

    def _active_home_footprints(self) -> tuple[SpatialHomeFootprint, ...]:
        """Return static and occupied-plot hard rectangles in stable order."""
        assigned = tuple(
            footprint
            for home_id in sorted(self._home_plots_by_home_id)
            for footprint in self._home_plots_by_home_id[home_id].hard_footprints
        )
        return self.home_footprints + assigned

    def _preferred_staging(
        self,
        agent_id: str,
        staging_id: str | None,
    ) -> SpatialStagingPoint:
        """Choose the stable first-choice anchor for a spawn request."""
        if staging_id is not None:
            staging = self._staging_by_id.get(staging_id)
            if staging is None:
                raise SpatialNavigationError(f"Unknown staging point {staging_id!r}.")
            return staging
        ordered = tuple(sorted(self.staging_points, key=lambda item: item.id))
        digest = hashlib.sha256(agent_id.encode("utf-8")).digest()
        return ordered[int.from_bytes(digest[:8], "big") % len(ordered)]

    def _select_spawn_point(
        self,
        preferred: SpatialStagingPoint,
        now: float,
    ) -> SpatialPoint:
        """Choose a deterministic unoccupied anchor or nearest legal fallback tile."""
        ordered = tuple(sorted(self.staging_points, key=lambda item: item.id))
        start = ordered.index(preferred)
        for offset in range(len(ordered)):
            candidate = ordered[(start + offset) % len(ordered)].point()
            if self.is_walkable(candidate.x, candidate.y) and not self._point_is_occupied(
                candidate, now
            ):
                return candidate
        fallback = self._nearest_unoccupied_neighbor(self._tile_for_point(preferred.point()), now)
        if fallback is None:
            raise SpatialNavigationError("No unoccupied legal spatial spawn point remains.")
        return fallback

    def _point_is_occupied(self, candidate: SpatialPoint, now: float) -> bool:
        """Return whether a current agent's sampled feet are exactly at this point."""
        return any(
            self._point_at(agent_id, now).distance_to(candidate) <= 0.000_001
            for agent_id in self._positions
        )

    def _nearest_unoccupied_neighbor(
        self,
        start: tuple[int, int],
        now: float,
    ) -> SpatialPoint | None:
        """Breadth-first search for the nearest free legal tile centre after anchor exhaustion."""
        frontier = [start]
        visited = {start}
        while frontier:
            current = frontier.pop(0)
            column, row = current
            for neighbor in (
                (column, row - 1),
                (column - 1, row),
                (column + 1, row),
                (column, row + 1),
            ):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                if not self.is_tile_walkable(*neighbor):
                    continue
                if self.is_tile_walkable(*current) and not self._segment_is_clear(
                    self._tile_center(*current), self._tile_center(*neighbor)
                ):
                    continue
                point = self._tile_center(*neighbor)
                if not self._point_is_occupied(point, now):
                    return point
                frontier.append(neighbor)
        return None

    def _plot_is_eligible(self, plot: SpatialHomePlot, now: float) -> bool:
        """Return whether this unoccupied plot avoids every current agent position."""
        if plot.id in self._home_ids_by_plot_id:
            return False
        return all(
            not any(
                footprint.contains(self._point_at(agent_id, now))
                for footprint in plot.hard_footprints
            )
            for agent_id in self._positions
        )

    def _select_home_plot(self, home_id: str, now: float) -> SpatialHomePlot | None:
        """Select one eligible plot through stable hash-offset linear probing."""
        plots = tuple(sorted(self.home_plots, key=lambda item: item.id))
        if not plots:
            return None
        offset = int.from_bytes(hashlib.sha256(home_id.encode("utf-8")).digest()[:8], "big")
        for index in range(len(plots)):
            candidate = plots[(offset + index) % len(plots)]
            if self._plot_is_eligible(candidate, now):
                return candidate
        return None

    def _cancel_routes_blocked_by(
        self,
        footprints: tuple[SpatialHomeFootprint, ...],
        now: float,
    ) -> None:
        """Queue exact stop records for routes whose remaining path now hits a home."""
        if not footprints:
            return
        for agent_id in sorted(self._travels):
            travel = self._travels[agent_id]
            remaining = self._remaining_route_points(travel, now)
            if not self._route_is_clear(remaining):
                self.cancel_travel(agent_id, now, reason="home_built", queue_event=True)

    def _remaining_route_points(
        self,
        travel: SpatialTravel,
        now: float,
    ) -> tuple[SpatialPoint, ...]:
        """Return the exact current point followed by the untraversed route suffix."""
        current = self._point_on_travel(travel, now)
        if now >= travel.arrives_at:
            return (current,)
        elapsed = max(0.0, (now - travel.started_at) * travel.speed)
        traversed = 0.0
        for index, (start, end) in enumerate(pairwise(travel.route)):
            segment = start.distance_to(end)
            if elapsed <= traversed + segment:
                return (current, *travel.route[index + 1 :])
            traversed += segment
        return (current,)

    def _route_is_clear(self, route: tuple[SpatialPoint, ...]) -> bool:
        """Return whether all continuous route segments avoid active hard rectangles."""
        return all(self._segment_is_clear(start, end) for start, end in pairwise(route))

    def _segment_is_clear(self, start: SpatialPoint, end: SpatialPoint) -> bool:
        """Return whether an exact route segment avoids every active hard rectangle."""
        return not any(
            _segment_intersects_footprint(start, end, footprint)
            for footprint in self._active_home_footprints()
        )


@dataclass(frozen=True, slots=True)
class SpatialWorldBundle:
    """Validated v2 container holding one independently-exported map per region.

    The bundled format deliberately reuses the stable v1 region-map artifact.
    It changes startup assembly only: local navigation, snapshots, and replay
    still identify each physical space by that map's own v1 identity.

    Args:
        regions: Maps sorted by their stable region id.
    """

    version: ClassVar[int] = 2
    regions: tuple[SpatialWorld, ...]

    @classmethod
    def from_mapping(cls, raw: Mapping[str, object]) -> SpatialWorldBundle:
        """Validate a v2 export bundle and its distinct v1 region maps."""
        data = _mapping(raw, "spatial navigation bundle")
        version = _int(data.get("version"), "version")
        if version != cls.version:
            raise SpatialConfigError(
                f"Unsupported spatial-navigation bundle version {version}; expected 2."
            )
        maps = tuple(
            SpatialWorld.from_mapping(_mapping(entry, f"regions[{index}]"))
            for index, entry in enumerate(_sequence(data.get("regions"), "regions"))
        )
        if not maps:
            raise SpatialConfigError("spatial navigation bundle requires at least one region map.")
        region_ids = [spatial.region_id for spatial in maps]
        if len(region_ids) != len(set(region_ids)):
            duplicates = sorted({name for name in region_ids if region_ids.count(name) > 1})
            raise SpatialConfigError(f"Duplicate spatial bundle region ids: {duplicates}.")
        return cls(tuple(sorted(maps, key=lambda spatial: spatial.region_id)))

    @classmethod
    def from_path(cls, path: str | Path) -> SpatialWorldBundle:
        """Load and validate a v2 bundle from a JSON file."""
        source = Path(path)
        try:
            decoded = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SpatialConfigError(
                f"Could not load spatial navigation bundle {source}: {exc}"
            ) from exc
        if not isinstance(decoded, Mapping):
            raise SpatialConfigError("spatial navigation bundle must be a JSON object.")
        return cls.from_mapping(cast(Mapping[str, object], decoded))

    def by_region(self, region_id: str) -> SpatialWorld:
        """Return one map by its exact region id, or raise ``KeyError``."""
        for spatial in self.regions:
            if spatial.region_id == region_id:
                return spatial
        raise KeyError(region_id)


def _mapping(value: object, label: str) -> Mapping[str, object]:
    """Return a string-keyed mapping or raise a useful config error."""
    if not isinstance(value, Mapping) or not all(isinstance(key, str) for key in value):
        raise SpatialConfigError(f"{label} must be an object.")
    return cast(Mapping[str, object], value)


def _sequence(value: object, label: str) -> Sequence[object]:
    """Return a non-string sequence or raise a useful config error."""
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise SpatialConfigError(f"{label} must be an array.")
    return value


def _identifier(value: object, label: str) -> str:
    """Validate one non-empty stable identifier."""
    if not isinstance(value, str) or not value.strip():
        raise SpatialConfigError(f"{label} must be a non-empty string.")
    return value


def _finite(value: object, label: str) -> float:
    """Validate and coerce one finite number."""
    if isinstance(value, bool):
        raise SpatialNavigationError(f"{label} must be a finite number.")
    try:
        number = float(cast(float | str, value))
    except (TypeError, ValueError) as exc:
        raise SpatialNavigationError(f"{label} must be a finite number.") from exc
    if not math.isfinite(number):
        raise SpatialNavigationError(f"{label} must be a finite number.")
    return number


def _positive_finite(value: object, label: str) -> float:
    """Validate one strictly positive finite number."""
    number = _finite(value, label)
    if number <= 0:
        raise SpatialNavigationError(f"{label} must be positive.")
    return number


def _int(value: object, label: str) -> int:
    """Validate one exact integer configuration value."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise SpatialConfigError(f"{label} must be an integer.")
    return value


def _positive_int(value: object, label: str) -> int:
    """Validate one strictly positive integer configuration value."""
    number = _int(value, label)
    if number <= 0:
        raise SpatialConfigError(f"{label} must be positive.")
    return number


def _walkable_values(value: object, columns: int, rows: int) -> tuple[bool, ...]:
    """Validate exporter ``walkable`` rows and convert them to blocked booleans."""
    raw_rows = _sequence(value, "walkable")
    if len(raw_rows) != rows:
        raise SpatialConfigError(f"walkable must contain {rows} rows, got {len(raw_rows)}.")
    collision: list[bool] = []
    for row_index, raw_row in enumerate(raw_rows):
        row = _sequence(raw_row, f"walkable[{row_index}]")
        if len(row) != columns:
            raise SpatialConfigError(
                f"walkable[{row_index}] must contain {columns} columns, got {len(row)}."
            )
        for column_index, cell in enumerate(row):
            if isinstance(cell, bool) or not isinstance(cell, int) or cell not in (0, 1):
                raise SpatialConfigError(f"walkable[{row_index}][{column_index}] must be 0 or 1.")
            collision.append(cell == 0)
    return tuple(collision)


def _initial_pressure(value: object) -> SpatialJson:
    """Validate the pressure input that selected the concrete map recipe."""
    raw = _mapping(value, "initial_pressure")
    population = _nonnegative_int(
        raw.get("populationHighWater"), "initial_pressure.populationHighWater"
    )
    footprint = _nonnegative_int(
        raw.get("builtFootprintHighWater"), "initial_pressure.builtFootprintHighWater"
    )
    return {
        "populationHighWater": population,
        "builtFootprintHighWater": footprint,
    }


def _nonnegative_int(value: object, label: str) -> int:
    """Validate one non-negative integer configuration value."""
    number = _int(value, label)
    if number < 0:
        raise SpatialConfigError(f"{label} must be non-negative.")
    return number


def _landmarks(value: object, spatial: SpatialWorld) -> tuple[SpatialLandmark, ...]:
    """Validate and sort named, terrain-legal landmarks."""
    landmarks: list[SpatialLandmark] = []
    seen: set[str] = set()
    for index, raw in enumerate(_sequence(value, "landmarks")):
        entry = _mapping(raw, f"landmarks[{index}]")
        landmark_id = _identifier(entry.get("id"), f"landmarks[{index}].id")
        if landmark_id in seen:
            raise SpatialConfigError(f"Duplicate landmark id {landmark_id!r}.")
        seen.add(landmark_id)
        name = _identifier(entry.get("name"), f"landmarks[{index}].name")
        point = SpatialPoint(
            _finite(entry.get("x"), f"landmarks[{index}].x"),
            _finite(entry.get("y"), f"landmarks[{index}].y"),
        )
        if not spatial.is_walkable(point.x, point.y):
            raise SpatialConfigError(f"Landmark {landmark_id!r} must be on a walkable tile.")
        affordances_raw = _sequence(entry.get("affordances", []), f"landmarks[{index}].affordances")
        affordances: list[str] = []
        for affordance in affordances_raw:
            value = _identifier(affordance, f"landmarks[{index}].affordances entry")
            if value not in affordances:
                affordances.append(value)
        landmarks.append(SpatialLandmark(landmark_id, name, point.x, point.y, tuple(affordances)))
    return tuple(sorted(landmarks, key=lambda item: item.id))


def _gates(value: object, spatial: SpatialWorld) -> tuple[SpatialGate, ...]:
    """Validate optional directed gate coordinates and their unique edge roles."""
    if value is None:
        return ()
    gates: list[SpatialGate] = []
    seen: set[tuple[str, str, str]] = set()
    for index, raw in enumerate(_sequence(value, "gates")):
        entry = _mapping(raw, f"gates[{index}]")
        from_region = _identifier(entry.get("from_region"), f"gates[{index}].from_region")
        to_region = _identifier(entry.get("to_region"), f"gates[{index}].to_region")
        if from_region == to_region:
            raise SpatialConfigError(f"Gate {from_region!r} may not loop to itself.")
        role = entry.get("role")
        if role not in {"departure", "arrival"}:
            raise SpatialConfigError(f"gates[{index}].role must be 'departure' or 'arrival'.")
        typed_role: Literal["departure", "arrival"] = role
        point = SpatialPoint(
            _finite(entry.get("x"), f"gates[{index}].x"),
            _finite(entry.get("y"), f"gates[{index}].y"),
        )
        if not spatial.is_walkable(point.x, point.y):
            raise SpatialConfigError(
                f"Gate {from_region!r}->{to_region!r} must be on walkable terrain."
            )
        key = (typed_role, from_region, to_region)
        if key in seen:
            raise SpatialConfigError(f"Duplicate {typed_role} gate {from_region!r}->{to_region!r}.")
        seen.add(key)
        gates.append(SpatialGate(from_region, to_region, typed_role, point.x, point.y))
    return tuple(sorted(gates, key=lambda gate: (gate.role, gate.from_region, gate.to_region)))


def _staging_points(value: object, spatial: SpatialWorld) -> tuple[SpatialStagingPoint, ...]:
    """Validate and sort legal deterministic staging points."""
    points: list[SpatialStagingPoint] = []
    seen: set[str] = set()
    for index, raw in enumerate(_sequence(value, "spawn_points")):
        entry = _mapping(raw, f"spawn_points[{index}]")
        supplied_id = entry.get("id")
        point_id = (
            _identifier(supplied_id, f"spawn_points[{index}].id")
            if supplied_id is not None
            else f"spawn-{index:04d}"
        )
        if point_id in seen:
            raise SpatialConfigError(f"Duplicate staging point id {point_id!r}.")
        seen.add(point_id)
        point = SpatialPoint(
            _finite(entry.get("x"), f"spawn_points[{index}].x"),
            _finite(entry.get("y"), f"spawn_points[{index}].y"),
        )
        if not spatial.is_walkable(point.x, point.y):
            raise SpatialConfigError(f"Spawn point {point_id!r} must be on a walkable tile.")
        points.append(SpatialStagingPoint(point_id, point.x, point.y))
    return tuple(sorted(points, key=lambda item: item.id))


def _home_footprints(value: object) -> tuple[SpatialHomeFootprint, ...]:
    """Validate optional explicit hard home-footprint rectangles."""
    if value is None:
        return ()
    return _footprints(_sequence(value, "home_footprints"), "home_footprints")


def _home_plots(value: object, spatial: SpatialWorld) -> tuple[SpatialHomePlot, ...]:
    """Validate dormant exported shelter plots and their production hard geometry."""
    if value is None:
        return ()
    plots: list[SpatialHomePlot] = []
    seen: set[str] = set()
    for index, raw in enumerate(_sequence(value, "home_plots")):
        entry = _mapping(raw, f"home_plots[{index}]")
        plot_id = _identifier(entry.get("id"), f"home_plots[{index}].id")
        if plot_id in seen:
            raise SpatialConfigError(f"Duplicate home plot id {plot_id!r}.")
        seen.add(plot_id)
        point = SpatialPoint(
            _finite(entry.get("x"), f"home_plots[{index}].x"),
            _finite(entry.get("y"), f"home_plots[{index}].y"),
        )
        door_raw = _mapping(entry.get("door"), f"home_plots[{index}].door")
        door = SpatialPoint(
            _finite(door_raw.get("x"), f"home_plots[{index}].door.x"),
            _finite(door_raw.get("y"), f"home_plots[{index}].door.y"),
        )
        if not spatial.is_walkable(door.x, door.y):
            raise SpatialConfigError(f"Home plot {plot_id!r} door must be on walkable terrain.")
        hard_rects = _footprints(
            _sequence(entry.get("hard_rects"), f"home_plots[{index}].hard_rects"),
            f"home_plots[{index}].hard_rects",
            identifier_prefix=f"{plot_id}:rect",
        )
        if not hard_rects:
            raise SpatialConfigError(f"Home plot {plot_id!r} requires at least one hard rectangle.")
        plots.append(SpatialHomePlot(plot_id, point.x, point.y, door, hard_rects))
    return tuple(sorted(plots, key=lambda item: item.id))


def _footprints(
    values: Sequence[object],
    label: str,
    *,
    identifier_prefix: str | None = None,
) -> tuple[SpatialHomeFootprint, ...]:
    """Validate one sequence of hard rectangles with stable distinct ids."""
    footprints: list[SpatialHomeFootprint] = []
    seen: set[str] = set()
    for index, raw in enumerate(values):
        entry = _mapping(raw, f"{label}[{index}]")
        supplied_id = entry.get("id")
        footprint_id = (
            _identifier(supplied_id, f"{label}[{index}].id")
            if supplied_id is not None
            else f"{identifier_prefix}:{index:04d}"
            if identifier_prefix is not None
            else ""
        )
        if not footprint_id:
            raise SpatialConfigError(f"{label}[{index}].id must be a non-empty string.")
        if footprint_id in seen:
            raise SpatialConfigError(f"Duplicate home footprint id {footprint_id!r}.")
        seen.add(footprint_id)
        footprints.append(
            SpatialHomeFootprint(
                footprint_id,
                _finite(entry.get("x"), f"{label}[{index}].x"),
                _finite(entry.get("y"), f"{label}[{index}].y"),
                _positive_finite(entry.get("width"), f"{label}[{index}].width"),
                _positive_finite(entry.get("height"), f"{label}[{index}].height"),
            )
        )
    return tuple(sorted(footprints, key=lambda item: item.id))


def _export_metadata(data: Mapping[str, object]) -> SpatialJson:
    """Detach optional exporter metadata while leaving navigation fields typed."""
    retained = {
        key: value
        for key, value in data.items()
        if key in {"gates", "shelters", "home_plots", "hashes", "source"}
    }
    return cast(SpatialJson, json.loads(json.dumps(retained, allow_nan=False, sort_keys=True)))


def _manhattan(left: tuple[int, int], right: tuple[int, int]) -> int:
    """Return the cardinal-grid distance between two tiles."""
    return abs(left[0] - right[0]) + abs(left[1] - right[1])


def _reconstruct_path(
    came_from: Mapping[tuple[int, int], tuple[int, int] | None],
    current: tuple[int, int],
) -> tuple[tuple[int, int], ...]:
    """Rebuild a start-to-current A* path from predecessor links."""
    path: list[tuple[int, int]] = [current]
    while (previous := came_from[current]) is not None:
        path.append(previous)
        current = previous
    path.reverse()
    return tuple(path)


def _append_point(points: list[SpatialPoint], candidate: SpatialPoint) -> None:
    """Append a point unless it is already the exact final route point."""
    if not points or points[-1].distance_to(candidate) > 0.000_001:
        points.append(candidate)


def _segment_intersects_footprint(
    start: SpatialPoint,
    end: SpatialPoint,
    footprint: SpatialHomeFootprint,
) -> bool:
    """Return whether a closed continuous segment intersects a hard rectangle."""
    dx = end.x - start.x
    dy = end.y - start.y
    lower = 0.0
    upper = 1.0
    bounds = (
        (-dx, start.x - footprint.x),
        (dx, footprint.x + footprint.width - start.x),
        (-dy, start.y - footprint.y),
        (dy, footprint.y + footprint.height - start.y),
    )
    for coefficient, distance in bounds:
        if coefficient == 0.0:
            if distance < 0.0:
                return False
            continue
        parameter = distance / coefficient
        if coefficient < 0.0:
            if parameter > upper:
                return False
            lower = max(lower, parameter)
        else:
            if parameter < lower:
                return False
            upper = min(upper, parameter)
    return lower <= upper

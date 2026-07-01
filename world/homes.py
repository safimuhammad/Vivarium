"""Home domain model: the :class:`Home` dataclass.

``Home`` is the single record describing one built home: who owns it, where it
stands, how sound it is, and when it last drew upkeep. It is a stdlib dataclass
with ``slots=True`` for a small memory/access win on the hot path, and is
deliberately **mutable** (NOT frozen): the :class:`~world.world.WorldState`
mutates these records in place (see ``CLAUDE.md`` Section 3). All mutation goes
through :class:`~world.world.WorldState` methods, never by reaching into the fields
directly from outside the world.

Forward-compatible with Layer 2 (shared ownership, health-from-stakeholders, vault):
homes are keyed by a stable ``home_id`` with ``owner_id`` as a plain, reassignable
field, so an L2 colonize is a single field write rather than a painful re-key.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Home:
    """A private home a being has raised in a region.

    A mutable hot-path record; the :class:`~world.world.WorldState` owns and
    mutates instances in place. Not frozen by design.

    Attributes:
        home_id: Stable unique identifier (the world's map key for this home).
        owner_id: Id of the being that owns the home (reassignable — L2 colonize).
        region: Name of the region the home stands in.
        integrity: Structural soundness in ``[0.0, HOME_MAX_INTEGRITY]``; unpaid
            upkeep erodes it and the home collapses at ``<= 0.0``.
        built_at: World-clock time (seconds) the home was raised.
        last_upkeep_at: World-clock time (seconds) upkeep was last drawn; the
            world-tick accrues ``rate * (now - last_upkeep_at)`` materials from the
            owner's stock each step it can pay.
    """

    home_id: str
    owner_id: str
    region: str
    integrity: float
    built_at: float
    last_upkeep_at: float

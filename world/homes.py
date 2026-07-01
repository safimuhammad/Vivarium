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

from dataclasses import dataclass, field

from core.constants import (
    HOARDING_MATERIALS_THRESHOLD,
    HOME_HEALTH_BASE,
    HOME_HEALTH_CEIL,
    HOME_HEALTH_DIMINISH,
)


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
        stakeholders: Ids of every being bought into the home (Layer 2). The builder
            is the owner AND the first stakeholder; others join via ``pledge_home``.
            Upkeep is drawn across this pool and the integrity ceiling scales with its
            length (:func:`max_integrity`).
        vault_materials: The home's shared, materials-only store (Layer 2b). Stakeholders
            bank materials in via ``deposit_to_home`` and draw them out via
            ``withdraw_from_home``; the balance counts toward hoarding at the HOME level
            (:func:`home_is_hoarding`). There is no energy vault (the hearth supplies energy).
    """

    home_id: str
    owner_id: str
    region: str
    integrity: float
    built_at: float
    last_upkeep_at: float
    stakeholders: list[str] = field(default_factory=list)
    vault_materials: float = 0.0


def max_integrity(stakeholder_count: int) -> float:
    """Return a home's integrity ceiling for a given number of stakeholders.

    Pure (no side effects). A communal home is sounder than a lone shelter, but with
    diminishing returns and a hard ceiling (spec §12, fork 2): a home with more beings
    tending it is harder to wear down, yet no size makes it an unraidable blob. The
    formula asymptotically approaches :data:`~core.constants.HOME_HEALTH_CEIL` from
    below, in the mathematical limit as ``s`` grows without bound::

        max_integrity(s) = BASE + (CEIL - BASE) * (1 - DIMINISH ** (s - 1))   for s >= 1

    In exact real arithmetic no finite ``s`` reaches the ceiling, but in float64 the
    ``DIMINISH ** (s - 1)`` term underflows below representable precision once
    ``s >= 54`` (with the current constants), so ``max_integrity`` returns exactly
    :data:`~core.constants.HOME_HEALTH_CEIL` from that point on — the practical ceiling
    is reached, even though the underlying curve never truly does. A count ``<= 1`` (a
    lone home, or the degenerate/empty case after the last stakeholder departs) returns
    :data:`~core.constants.HOME_HEALTH_BASE`, so the ceiling is never a 0-cap and a solo
    home is exactly the L1 home.

    Args:
        stakeholder_count: The home's number of stakeholders (``len(home.stakeholders)``).

    Returns:
        The integrity ceiling (a float in ``[HOME_HEALTH_BASE, HOME_HEALTH_CEIL]``).
    """
    if stakeholder_count <= 1:
        return HOME_HEALTH_BASE
    return HOME_HEALTH_BASE + (HOME_HEALTH_CEIL - HOME_HEALTH_BASE) * (
        1.0 - HOME_HEALTH_DIMINISH ** (stakeholder_count - 1)
    )


def home_is_hoarding(home: Home) -> bool:
    """Return whether a home's vault holds a hoard of materials.

    Pure (no side effects). The vault counts toward hoarding at the HOME level (spec §12,
    fork 3): banking materials into a home moves the hoard-signal from the depositor to the
    home (a raid target) rather than hiding it — no laundering. Reuses the same materials
    dial as the per-agent :func:`~world.agents.is_hoarding`, so a home and a being are judged
    against one threshold.

    Args:
        home: The home whose vault to inspect.

    Returns:
        ``True`` if ``home.vault_materials`` is at or above
        :data:`~core.constants.HOARDING_MATERIALS_THRESHOLD`.
    """
    return home.vault_materials >= HOARDING_MATERIALS_THRESHOLD

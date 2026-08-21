"""The knobs a viewer may turn before pressing play -- bounds and labels, in one place.

The configuration screen must not hardcode a single number or sentence. Every bound
here is also the bound the API validates against (:mod:`server.run_config` imports
these constants), so the screen and the server can never disagree, and a tuning change
moves both at once. The labels live beside the bounds for the same reason: the copy
describing a knob is part of the knob.

Everything here is a *presentation and validation* concern. The world rules themselves
stay in :mod:`core.constants`; the values a run derives rather than accepts stay in
:mod:`core.run_settings`. Nothing in this module is read by the simulation.

Deliberately absent (spec Section 3.2): every compaction constant, every conservation
invariant, memory scoring weights, the embedding model, region names/descriptions/
connections, agent ids, temperature and thinking level, and all break-in dials. A lever
attached to nothing is worse than no lever.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from core.constants import (
    GENESIS_SEED,
    HOARDING_ENERGY_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    MATING_MAX_OFFSPRING,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    PARALYSIS_ENERGY_THRESHOLD,
    REFLECT_EVERY_N_BREATHS,
)

__all__ = [
    "ABUNDANCE_DEFAULT",
    "ABUNDANCE_MAX",
    "ABUNDANCE_MIN",
    "BEING_COUNT_MAX",
    "BEING_COUNT_MIN",
    "BEING_ENERGY_DEFAULT",
    "BEING_ENERGY_MAX",
    "BEING_ENERGY_MIN",
    "BEING_MATERIALS_DEFAULT",
    "BEING_MATERIALS_MAX",
    "BEING_MATERIALS_MIN",
    "BEING_NAME_MAX_LENGTH",
    "COST_ESTIMATE_CAVEAT",
    "DEFAULT_BEING_NAMES",
    "DURATION_CHOICES_SECONDS",
    "DURATION_DEFAULT_SECONDS",
    "DURATION_MAX_SECONDS",
    "DURATION_MIN_SECONDS",
    "DURATION_OPTIONS",
    "ESTIMATED_COST_PER_BEING_HOUR_USD",
    "GENESIS_SEED",
    "MAX_OFFSPRING_MAX",
    "MAX_OFFSPRING_MIN",
    "PERSONA_DISCLAIMER",
    "PERSONA_MAX_LENGTH",
    "PROVIDER_CHOICES",
    "PROVIDER_DEFAULT",
    "PROVIDER_OPTIONS",
    "REFLECT_CHOICES",
    "REFLECT_MAX",
    "REFLECT_MIN",
    "REFLECT_OPTIONS",
    "SEED_DEFAULT",
    "SEED_LABEL",
    "SEED_MAX",
    "SEED_MIN",
    "Choice",
    "ProviderChoice",
    "ProviderName",
    "run_knob_catalog",
]

# --- 1. Number of beings ----------------------------------------------------
BEING_COUNT_MIN: Final[int] = 1
BEING_COUNT_MAX: Final[int] = 12
BEING_COUNT_DEFAULT: Final[int] = 4
ESTIMATED_COST_PER_BEING_HOUR_USD: Final[float] = 3.0
"""Measured hosted-inference cost of one being breathing for one hour, in USD.

Measured, not guessed: a real hosted run of 5 beings made 416 decisions in 222
seconds for 9.07M prompt and 32,963 completion tokens (a 275:1 input-dominated
ratio), priced through :data:`observability.usage.MODEL_PRICES`. Read
:data:`COST_ESTIMATE_CAVEAT` before showing it as money.
"""

COST_ESTIMATE_CAVEAT: Final[str] = (
    "Indicative, not a quote. The per-token prices behind this are not confirmed "
    "against the provider's current published rates, and a being's prompt grows as "
    "its life lengthens -- measured at about 4,500 tokens on its first breath and "
    "about 43,000 by its eightieth -- so a long run costs more per hour at the end "
    "than at the start. Read it as an order of magnitude, not a bill."
)
"""Why the cost estimate is a magnitude rather than a price.

Two measured reasons, both of which make a bare number a quiet lie:

1. ``observability.usage.MODEL_PRICES`` carries an explicit
   ``TODO: confirm against current Gemini pricing`` -- the rates are placeholders.
2. Cost per hour is **not** flat within a run. Lifecycle history accumulates into
   every prompt, so measured prompt size grew roughly tenfold (about 4,476 tokens
   at a being's first breath to about 43,076 by its eightieth) inside a single run.
"""

DEFAULT_BEING_NAMES: Final[tuple[str, ...]] = ("Joe", "Mae", "Dick", "Allen")
"""The founders' names. Labels only -- they do not shape who a being becomes."""

BEING_NAME_MAX_LENGTH: Final[int] = 40

# --- 2. World abundance -----------------------------------------------------
ABUNDANCE_MIN: Final[float] = 0.25
ABUNDANCE_MAX: Final[float] = 3.0
ABUNDANCE_DEFAULT: Final[float] = 1.0
ABUNDANCE_STEP: Final[float] = 0.05

# --- 3. Seed ----------------------------------------------------------------
SEED_MIN: Final[int] = 0
SEED_MAX: Final[int] = 2**31 - 1
SEED_DEFAULT: Final[int] = 7
SEED_LABEL: Final[str] = "The shape of the land"
SEED_HELP: Final[str] = (
    "The seed shapes the land itself -- where the paths run, where the water gathers, "
    "where things grow. The same seed always draws the same world. What the beings then "
    "choose to do in it is never the same twice."
)

# --- 4/5. Starting resources ------------------------------------------------
BEING_ENERGY_MIN: Final[float] = 50.0
BEING_ENERGY_MAX: Final[float] = 200.0
BEING_ENERGY_DEFAULT: Final[float] = 100.0

BEING_MATERIALS_MIN: Final[float] = 0.0
BEING_MATERIALS_MAX: Final[float] = 100.0
BEING_MATERIALS_DEFAULT: Final[float] = 45.0

# --- 7. Persona -------------------------------------------------------------
PERSONA_MAX_LENGTH: Final[int] = 4000
PERSONA_DISCLAIMER: Final[str] = (
    "Your words stay. What the being adds to them is its own. The text you write is "
    "this being's birth nature and remains at the top of its mind for the entire run, "
    f"unchanged. From its {REFLECT_EVERY_N_BREATHS - 1}th breath onward, and every "
    f"{REFLECT_EVERY_N_BREATHS} breaths after, the being pauses and may write a second "
    "passage about who it has become -- appended beneath your words. Over a long run "
    "that self-written passage is what drives its behaviour. It can contradict you. It "
    "cannot delete you."
)

# --- 9. Run length ----------------------------------------------------------
DURATION_MIN_SECONDS: Final[float] = 60.0
DURATION_MAX_SECONDS: Final[float] = 86_400.0
DURATION_DEFAULT_SECONDS: Final[float] = 1800.0
DURATION_CHOICES_SECONDS: Final[tuple[float | None, ...]] = (900.0, 3600.0, 14400.0, None)
"""15 minutes / 1 hour / 4 hours / unbounded (``None``)."""

# --- 10. Where the minds run ------------------------------------------------
type ProviderName = Literal["gemini", "ollama"]
"""Where a run's minds may be hosted."""

PROVIDER_DEFAULT: Final[ProviderName] = "gemini"
"""The cloud. Gemini is the performance target; local Ollama is a different product."""

PROVIDER_CHOICES: Final[tuple[ProviderName, ...]] = ("gemini", "ollama")

# --- 11. Reflection cadence -------------------------------------------------
REFLECT_MIN: Final[int] = 2
REFLECT_MAX: Final[int] = 48
REFLECT_CHOICES: Final[tuple[int, ...]] = (6, 12, 24)

# --- 12. Children per being (advanced) --------------------------------------
MAX_OFFSPRING_MIN: Final[int] = 0
MAX_OFFSPRING_MAX: Final[int] = 10


@dataclass(frozen=True, slots=True)
class Choice:
    """One selectable option on the screen.

    Attributes:
        value: The value submitted in the ``RunConfig``. ``None`` is legal and means
            "unbounded" for the run-length knob.
        label: The words shown for it.
        help: Optional consequence the viewer should know before choosing.
    """

    value: object
    label: str
    help: str = ""

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-ready mapping for the configuration screen."""
        return {"value": self.value, "label": self.label, "help": self.help}


@dataclass(frozen=True, slots=True)
class ProviderChoice(Choice):
    """One place the minds can run, carrying its own cost and its own cadence.

    The rate must live **per option**, not once on the roster knob: a screen
    multiplying a single published figure by the roster would print a price on
    whichever place happened to be selected, including the one that is free.

    Attributes:
        cost_per_being_hour_usd: USD for one being to breathe for one hour here.
            Exactly ``0.0`` where inference is local and costs nothing.
        cadence: Short phrase for how fast a being thinks here, read inline in a
            sentence ("$12 an hour for 4 beings -- a breath every second or two").
    """

    cost_per_being_hour_usd: float = 0.0
    cadence: str = ""

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-ready mapping including this place's rate and cadence.

        Calls :meth:`Choice.to_dict` explicitly rather than through a zero-argument
        ``super()``: ``@dataclass(slots=True)`` rebuilds the class object, so the
        implicit ``__class__`` cell would point at the pre-slots class and raise.
        """
        return {
            **Choice.to_dict(self),
            "cost_per_being_hour_usd": self.cost_per_being_hour_usd,
            "cadence": self.cadence,
        }


PROVIDER_OPTIONS: Final[tuple[ProviderChoice, ...]] = (
    ProviderChoice(
        "gemini",
        "The cloud",
        "Every being thinks at once, so the world moves at the pace it was tuned for. "
        "This is the only place that costs money.",
        cost_per_being_hour_usd=ESTIMATED_COST_PER_BEING_HOUR_USD,
        cadence="a breath every second or two",
    ),
    ProviderChoice(
        "ollama",
        "This machine",
        "One shared model thinks for one being at a time, so each being waits its turn. "
        "Free, and it does not get faster with a bigger roster -- it gets slower.",
        cost_per_being_hour_usd=0.0,
        cadence="minutes between breaths, one being at a time",
    ),
)

DURATION_OPTIONS: Final[tuple[Choice, ...]] = (
    Choice(900.0, "15 minutes", "Long enough to meet, not to build."),
    Choice(3600.0, "1 hour", "Long enough for homes and for a first child."),
    Choice(14400.0, "4 hours", "Long enough for a second generation."),
    Choice(None, "Unbounded", "It runs until you stop it. This is the piece as intended."),
)

REFLECT_OPTIONS: Final[tuple[Choice, ...]] = (
    Choice(6, "Often -- every 6 breaths", "A being's self-narrative moves fastest here."),
    Choice(12, "Balanced -- every 12 breaths", "The measured default."),
    Choice(24, "Rarely -- every 24 breaths", "Beings stay closer to the words you wrote."),
)


def run_knob_catalog() -> dict[str, object]:
    """Return every knob's bounds and labels, JSON-ready, for ``/api/run/defaults``.

    Region-dependent facts (the four locked regions, and the effective per-second
    regeneration the abundance slider scales) are added by the server, which is the
    only layer that has read ``world.yaml``.

    Returns:
        A mapping of knob key -> its bounds, default, labels and help text.
    """
    return {
        "beings": {
            "label": "The beings",
            "help": (
                "The biggest lever on cost, on how often anything happens, and on "
                "whether anything social happens at all."
            ),
            "min_count": BEING_COUNT_MIN,
            "max_count": BEING_COUNT_MAX,
            "default_count": BEING_COUNT_DEFAULT,
            "estimated_cost_per_being_hour_usd": ESTIMATED_COST_PER_BEING_HOUR_USD,
            "cost_estimate_note": COST_ESTIMATE_CAVEAT,
            "fields": {
                "name": {
                    "label": "Name",
                    "help": "A label, not a character. It does not shape who a being becomes.",
                    "max_length": BEING_NAME_MAX_LENGTH,
                    "defaults": list(DEFAULT_BEING_NAMES),
                },
                "start_region": {
                    "label": "Where it begins",
                    "help": (
                        "Beings that begin alone in separate regions may never meet. The "
                        "default is two co-located pairs."
                    ),
                },
                "energy": {
                    "label": "Starting energy",
                    "min": BEING_ENERGY_MIN,
                    "max": BEING_ENERGY_MAX,
                    "default": BEING_ENERGY_DEFAULT,
                    "help": (
                        f"Below {PARALYSIS_ENERGY_THRESHOLD:.0f} a being is frozen the "
                        f"moment it loses anything; at {HOARDING_ENERGY_THRESHOLD:.0f} or "
                        "more it is born flagged as a hoarder."
                    ),
                },
                "materials": {
                    "label": "Starting materials",
                    "min": BEING_MATERIALS_MIN,
                    "max": BEING_MATERIALS_MAX,
                    "default": BEING_MATERIALS_DEFAULT,
                    "help": (
                        f"Mating needs {MATING_MIN_MATERIALS_CONTRIBUTION:.0f}; a home "
                        f"costs {HOME_BUILD_MATERIALS_COST:.0f}. That gap is the "
                        "nest-versus-child tension."
                    ),
                    "markers": [
                        {
                            "at": MATING_MIN_MATERIALS_CONTRIBUTION,
                            "label": "a child",
                        },
                        {"at": HOME_BUILD_MATERIALS_COST, "label": "a home"},
                    ],
                },
                "persona": {
                    "label": "Who it is born as",
                    "help": PERSONA_DISCLAIMER,
                    "max_length": PERSONA_MAX_LENGTH,
                    "default": GENESIS_SEED,
                    "optional": True,
                },
            },
        },
        "abundance": {
            "label": "World abundance",
            "help": (
                "One slider on every region's regeneration at once. The authored "
                "gradient between the four regions is preserved."
            ),
            "min": ABUNDANCE_MIN,
            "max": ABUNDANCE_MAX,
            "default": ABUNDANCE_DEFAULT,
            "step": ABUNDANCE_STEP,
            "min_label": "the land is dying",
            "max_label": "the land provides",
        },
        "seed": {
            "label": SEED_LABEL,
            "help": SEED_HELP,
            "min": SEED_MIN,
            "max": SEED_MAX,
            "default": SEED_DEFAULT,
        },
        "duration_seconds": {
            "label": "How long it runs",
            "help": "You can stop it at any time whatever you choose here.",
            "min": DURATION_MIN_SECONDS,
            "max": DURATION_MAX_SECONDS,
            "default": DURATION_DEFAULT_SECONDS,
            "nullable": True,
            "choices": [choice.to_dict() for choice in DURATION_OPTIONS],
        },
        "provider": {
            "label": "Where the minds run",
            "help": "This changes cost, cadence, and how long a proposal is allowed to stand.",
            "default": PROVIDER_DEFAULT,
            "choices": [choice.to_dict() for choice in PROVIDER_OPTIONS],
        },
        "reflect_every_n_breaths": {
            "label": "How often a being reflects",
            "help": (
                "How fast a being's own words appear beneath the ones you wrote. It "
                "cannot delete yours."
            ),
            "min": REFLECT_MIN,
            "max": REFLECT_MAX,
            "default": REFLECT_EVERY_N_BREATHS,
            "choices": [choice.to_dict() for choice in REFLECT_OPTIONS],
        },
        "max_offspring": {
            "label": "Children per being",
            "help": "The population ceiling. Every being is told the number you choose.",
            "min": MAX_OFFSPRING_MIN,
            "max": MAX_OFFSPRING_MAX,
            "default": MATING_MAX_OFFSPRING,
            "advanced": True,
        },
    }

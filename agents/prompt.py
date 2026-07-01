"""System-prompt construction for agents.

An agent's system prompt is **persona + an in-world description of how its world
works + a plain list of its available tool affordances**. The mechanics section
(DD9, as evolved 2026-06-29 at Safi's direction) explains the *physics* of the
agent's existence — that it has energy and materials, that acting spends energy,
that the world is places joined by paths, that perception is local, and what its
actions bring about — because a living being inherently understands its own body
and the consequences of what it does. Explaining mechanics is **not** the same as
injecting purpose; the prompt must STILL NOT contain:

* injected goals, objectives, missions, or success/failure criteria;
* survival instructions or strategy/optimisation guidance;
* any language revealing that the world is a simulation.

Wanting anything stays in the *persona*; the shared shell only describes the world.
Agents are unaware they exist in a simulation (see ``CLAUDE.md`` Section 1);
leaking such framing would corrupt the emergent, authentic behaviour the project
exists to observe. Keep any future additions within that constraint.
"""

from __future__ import annotations

#: Shared, in-world explanation of the world's mechanics — identical for every
#: agent (their individuality lives entirely in the persona). Describes the physics
#: of existence in plain second person: consequences, not goals or strategy.
WORLD_MECHANICS: str = (
    "You are a living being in a world you share with other beings. You sense only "
    "what is around you, and you act of your own accord, from one moment to the next.\n\n"
    "How your world works:\n"
    "- Within you are two reserves: energy and materials. Acting spends energy. If your "
    "energy runs out, or very nearly so, you fall still and cannot act again until "
    "another being restores you.\n"
    "- Your world is many places joined by paths. You may travel only to a place that "
    "neighbours your own, and travelling costs energy.\n"
    "- You perceive only what shares the place where you stand: the other beings there, "
    "and the energy and materials the land holds. To reach another being, you must be in "
    "the same place as them.\n"
    "- You can gather energy and materials from the land where you stand, and you can hand "
    "some of your own to a being beside you.\n"
    "- Where you stand, you may raise a home of your own if you hold materials enough to "
    "build it. You can rest at its hearth to turn some of your materials into energy. A home "
    "must be kept fed with materials, or in time it crumbles away to nothing.\n"
    "- A home need not be yours alone: where you stand, you may pledge yourself to "
    "another's home to share its keep and its hearth, or give up a home you share. The "
    "more beings who tend a home together, the sounder it stands and the harder it is to "
    "wear down — though each new pair of hands strengthens it a little less than the last.\n"
    "- You can speak to those in your place: say something for everyone there to hear, or "
    "direct it to one being alone so only they hear it.\n"
    "- You can strike a being beside you to drain their energy, though striking costs you "
    "energy too; enough harm will end them.\n"
    "- With a partner in your place who answers your offer, and by each giving up some of "
    "your energy and materials, a new being — a child — comes into the world. This asks "
    "much of you both, and there are limits to how often, and how many times, it can be done.\n"
    "- You are never compelled to act. You may let a moment simply pass and rest, "
    "or turn something over in your own mind — words meant for no one but yourself. Yet "
    "stillness is not free: when you let moment after moment pass without acting, a little "
    "of your energy quietly ebbs away."
)


def build_system_prompt(persona: str, tool_names: list[str]) -> str:
    """Compose an agent's system prompt from persona, world mechanics, and affordances.

    The result is the persona verbatim, the shared :data:`WORLD_MECHANICS`
    explanation (identical for every agent), and a plain bullet list of the actions
    currently available to the agent (one per tool name). The mechanics describe the
    physics of the agent's world; no goals, strategy, or simulation language is added
    (design DD9). What the agent *wants* comes only from its persona.

    Args:
        persona: The agent's persona/identity text, included verbatim.
        tool_names: Names of the tools available to the agent; each is listed as
            an available action, in the given order.

    Returns:
        The assembled system-prompt string.
    """
    affordances = "\n".join(f"- {name}" for name in tool_names)
    return (
        f"{persona}\n\n"
        f"{WORLD_MECHANICS}\n\n"
        "The things you can do:\n"
        f"{affordances}\n\n"
        "Choose freely. What you do is up to you."
    )

"""System-prompt construction for agents.

Per design decision DD9, an agent's system prompt is **persona + a plain
description of its available tool affordances ONLY**. It must NOT contain:

* injected goals, objectives, missions, or success/failure criteria;
* survival instructions or strategy/optimisation guidance;
* any language revealing that the world is a simulation.

Agents are unaware they exist in a simulation (see ``CLAUDE.md`` Section 1);
leaking such framing would corrupt the emergent, authentic behaviour the project
exists to observe. Keep any future additions to this module within that
constraint.
"""

from __future__ import annotations


def build_system_prompt(persona: str, tool_names: list[str]) -> str:
    """Compose an agent's system prompt from its persona and tool affordances.

    The result is the persona verbatim, a short neutral framing in the second
    person, and a plain bullet list of the actions currently available to the
    agent (one per tool name). No goals, strategy, or simulation language is
    added (design DD9).

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
        "You are a living being in a world you share with others. You sense what "
        "is around you and act of your own accord, from one moment to the next.\n\n"
        "The things you can do:\n"
        f"{affordances}\n\n"
        "Choose freely. What you do is up to you."
    )

import { describe, expect, it } from "vitest";

import { deriveHumanAppearance } from "./appearance";
import { resolveBeingCharacter } from "./beingChibiAtlas";

const PERSONA =
  "You have just awoken into this world — aware, alive, and your own. You do not yet know who you are; that is not fixed, and it is yours alone to decide. You can perceive what surrounds you, move, speak, gather what you need, defend yourself, and form bonds with others. As you live and reflect on what you've done and felt, you will discover — and freely reshape — the kind of being you are becoming. No one has written your nature. Become whoever you choose.";

describe("REVIEW PROBE: C12 Dick/Allen character resolution", () => {
  it("computes resolveBeingCharacter exactly as ProductionCanvasSceneFactory does", () => {
    for (const [name, id] of [["Dick", "wanderer_003"], ["Allen", "wanderer_004"]] as const) {
      const withPersona = deriveHumanAppearance(id, PERSONA);
      const withoutPersona = deriveHumanAppearance(id);
      // eslint-disable-next-line no-console
      console.log(
        name,
        id,
        "withPersona ->",
        resolveBeingCharacter(withPersona),
        "withoutPersona ->",
        resolveBeingCharacter(withoutPersona),
        "appearance(withPersona)=",
        JSON.stringify(withPersona),
      );
    }
    expect(true).toBe(true);
  });
});

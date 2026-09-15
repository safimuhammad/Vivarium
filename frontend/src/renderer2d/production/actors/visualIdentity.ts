/**
 * Stable v2 visual identity for a production being.
 *
 * This is deliberately a presentation-only resolver. The server does not
 * persist these fields: the stable agent id is enough to reproduce the same
 * roster shape, garment family, and small accessory on a newborn projection,
 * its later exact checkpoint, and a saved-run portrait.
 */

import { deriveHumanAppearance } from "./appearance";
import { resolveBeingCharacter, type BeingCharacterId } from "./beingChibiAtlas";
import {
  BEING_ACCESSORIES,
  resolveBeingVisualPaletteVariant,
  type BeingAccessory,
  type BeingVisualPaletteVariant,
} from "./beingPalette";

export interface BeingVisualIdentity {
  readonly characterId: BeingCharacterId;
  readonly paletteVariant: BeingVisualPaletteVariant;
  readonly accessory: BeingAccessory;
}

/** FNV-1a hash used only for the accessory channel's stable id partition. */
function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Resolve all presentation choices from `agentId` alone. In particular,
 * `persona` is intentionally absent from this API so a projected newborn
 * cannot be remapped when a later checkpoint supplies more fields.
 */
export function resolveBeingVisualIdentity(agentId: string): BeingVisualIdentity {
  const characterId = resolveBeingCharacter(deriveHumanAppearance(agentId));
  const accessory = BEING_ACCESSORIES[
    stableHash(["being-accessory-v2", agentId, characterId].join("\0")) % BEING_ACCESSORIES.length
  ]!;
  return Object.freeze({
    characterId,
    paletteVariant: resolveBeingVisualPaletteVariant(agentId, characterId),
    accessory,
  });
}

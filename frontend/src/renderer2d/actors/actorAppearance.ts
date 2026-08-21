/** Stable, non-semantic visual choices derived from an agent's complete ID. */
export interface ActorAppearance {
  readonly skin: string;
  readonly face: string;
  readonly hair: string;
  readonly clothing: string;
  readonly palette: string;
}

const SKINS = ["golden", "copper", "umber", "rose", "olive", "warm-light"] as const;
const FACES = ["long-gentle", "soft-round", "broad", "angular", "small-round", "oval"] as const;
const HAIR = ["cropped-black", "wavy-auburn", "coiled-dark", "short-sand", "straight-plum", "silver-crop", "tousled-brown", "dark-bob"] as const;
const CLOTHING = [
  "clay-shirt-slate-trousers",
  "sage-shirt-brown-trousers",
  "cream-shirt-green-trousers",
  "blue-shirt-ochre-trousers",
  "plum-shirt-cream-trousers",
  "rust-shirt-charcoal-trousers",
] as const;
const PALETTES = ["river-morning", "warm-hearth", "pond-reed", "nirvana-field", "orchard-dusk", "stone-path"] as const;

function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function choose<const T extends readonly string[]>(agentId: string, channel: string, values: T): T[number] {
  return values[hashId(`${agentId}\u0000${channel}`) % values.length]!;
}

/** Derives a repeatable appearance without assigning meaning to an ID prefix. */
export function deriveActorAppearance(agentId: string): ActorAppearance {
  return {
    skin: choose(agentId, "skin", SKINS),
    face: choose(agentId, "face", FACES),
    hair: choose(agentId, "hair", HAIR),
    clothing: choose(agentId, "clothing", CLOTHING),
    palette: choose(agentId, "palette", PALETTES),
  };
}

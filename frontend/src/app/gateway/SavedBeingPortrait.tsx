/** A saved being's deterministic production sprite, with no renderer or model runtime. */
import { deriveHumanAppearance } from "../../renderer2d/production/actors/appearance";
import { BEING_CHIBI_GEOMETRY, resolveBeingCharacter } from "../../renderer2d/production/actors/beingChibiAtlas";
import atlasUrl from "../../assets/renderer2d/core/being-chibi.png";

export function SavedBeingPortrait({ id, persona }: Readonly<{ id: string; persona?: string | null }>) {
  const character = resolveBeingCharacter(deriveHumanAppearance(id, persona ?? undefined));
  const group = BEING_CHIBI_GEOMETRY.characters[character];
  const frame = group.frames[group.idleFrame]!;
  return <span aria-hidden="true" style={{ display: "grid", width: 44, height: 76, placeItems: "end center", flexShrink: 0 }}>
    <span style={{ display: "block", width: BEING_CHIBI_GEOMETRY.frameWidth, height: BEING_CHIBI_GEOMETRY.frameHeight,
      backgroundImage: `url(${atlasUrl})`, backgroundPosition: `${-frame.x}px ${-frame.y}px`,
      backgroundRepeat: "no-repeat", imageRendering: "pixelated", transform: "scale(1.5)", transformOrigin: "bottom center" }} />
  </span>;
}

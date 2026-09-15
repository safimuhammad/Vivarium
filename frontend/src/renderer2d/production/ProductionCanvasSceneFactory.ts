import type { ObserverRendererPort } from "../../presentation/rendererPort";
import { deriveHumanAppearance } from "./actors/appearance";
import { resolveBeingVisualIdentity } from "./actors/visualIdentity";
import { SpriteSheetHumanActor } from "./actors/SpriteSheetHumanActor";
import { PRODUCTION_ASSET_MANIFEST } from "./assets/productionManifest";
import {
  createCanvasPresentationRenderer,
  type CanvasPresentationRendererOptions,
} from "./CanvasPresentationRenderer";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import { withDepthSceneryManifest } from "./depth/DepthSceneryAssets";
import { withAtlasBridgeManifest } from "./world/AtlasBridgeAssets";
import { HomeActor } from "./homes/HomeActor";
import { createNirvanaProductionManifest } from "./nirvana/NirvanaAssetProfile";
import { NIRVANA_STATIC_SCENE_PROVIDER } from "./nirvana/NirvanaStaticSceneProvider";
import { createNirvanaEastProductionManifest } from "./nirvanaEast/NirvanaEastAssetProfile";
import { NIRVANA_EAST_STATIC_SCENE_PROVIDER } from "./nirvanaEast/NirvanaEastStaticSceneProvider";
import { createNirvanaWestProductionManifest } from "./nirvanaWest/NirvanaWestAssetProfile";
import { NIRVANA_WEST_STATIC_SCENE_PROVIDER } from "./nirvanaWest/NirvanaWestStaticSceneProvider";
import { createWarmSpringsProductionManifest } from "./warmSprings/WarmSpringsAssetProfile";
import { WARM_SPRINGS_STATIC_SCENE_PROVIDER } from "./warmSprings/WarmSpringsStaticSceneProvider";
import type {
  ProductionActorFactoryInput,
  ProductionEnvironmentFactoryInput,
  ProductionHomeFactoryInput,
  ProductionSceneFactories,
} from "./ProductionSceneGraph";
import { createProductionSceneCommandResolver } from "./ProductionSceneCommandResolver";
import type { ProductionStaticSceneProvider } from "./staticScene/ProductionStaticScene";

export type ProductionCanvasSceneRendererOptions = Omit<
  CanvasPresentationRendererOptions,
  "factories" | "manifest" | "resolveSceneCommands" | "staticSceneProviders"
>;

/**
 * The stable, frozen concrete factory set the production Canvas renderer is
 * built from. Exported (in addition to {@link createProductionCanvasSceneRenderer})
 * so `createActor`'s atlas-lease and construction behavior can be unit
 * tested directly, without booting a full renderer.
 */
export const PRODUCTION_SCENE_FACTORIES: ProductionSceneFactories = Object.freeze({
  createActor(input: ProductionActorFactoryInput) {
    const id = input.record.value.id;
    if (typeof id !== "string" || id.length === 0) throw new Error("Actor id is unavailable.");
    const name = input.record.value.name;
    const persona = input.record.value.persona;
    const personaValue = typeof persona === "string" ? persona : undefined;
    // The v2 identity is resolved from the stable id alone. Projected newborns
    // do not have a persona yet, and the later exact checkpoint must therefore
    // keep the same roster shape, garment family, and accessory. Passing both
    // values explicitly keeps the factory and actor in lockstep while persona
    // remains available for the actor's semantic snapshot.
    const appearance = deriveHumanAppearance(id, personaValue);
    const visualIdentity = resolveBeingVisualIdentity(id);
    return new SpriteSheetHumanActor({
      id,
      name: typeof name === "string" && name.length > 0 ? name : id,
      persona: personaValue,
      appearance,
      characterId: visualIdentity.characterId,
      visualIdentity,
      position: input.position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      reducedMotion: input.reducedMotion,
    });
  },
  createHome(input: ProductionHomeFactoryInput) {
    return new HomeActor({
      id: input.id,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      initial: input.presented,
    });
  },
  createEnvironment(input: ProductionEnvironmentFactoryInput) {
    return new EnvironmentSystem(input);
  },
});

/**
 * The manifest every exact region's art is registered into. Each profile validates its
 * own generation and re-checks the shared active-atlas ceiling as it is added, so a kit
 * that would push the world over budget fails at module load rather than at paint time.
 */
export const PRODUCTION_SCENE_MANIFEST = withAtlasBridgeManifest(withDepthSceneryManifest(
  createNirvanaWestProductionManifest(
    createNirvanaEastProductionManifest(
      createWarmSpringsProductionManifest(
        createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      ),
    ),
  ),
));
const PRODUCTION_STATIC_SCENE_PROVIDERS: ReadonlyMap<string, ProductionStaticSceneProvider> =
  Object.freeze(new Map([
    [NIRVANA_STATIC_SCENE_PROVIDER.kind, NIRVANA_STATIC_SCENE_PROVIDER],
    [WARM_SPRINGS_STATIC_SCENE_PROVIDER.kind, WARM_SPRINGS_STATIC_SCENE_PROVIDER],
    [NIRVANA_EAST_STATIC_SCENE_PROVIDER.kind, NIRVANA_EAST_STATIC_SCENE_PROVIDER],
    [NIRVANA_WEST_STATIC_SCENE_PROVIDER.kind, NIRVANA_WEST_STATIC_SCENE_PROVIDER],
  ]));

/** Create one production Canvas renderer from the stable, lazily loaded scene factory. */
export function createProductionCanvasSceneRenderer(
  options: ProductionCanvasSceneRendererOptions,
): Promise<ObserverRendererPort> {
  return createCanvasPresentationRenderer({
    ...options,
    manifest: PRODUCTION_SCENE_MANIFEST,
    factories: PRODUCTION_SCENE_FACTORIES,
    staticSceneProviders: PRODUCTION_STATIC_SCENE_PROVIDERS,
    resolveSceneCommands: createProductionSceneCommandResolver({
      getPlacement: () => options.placement.snapshot(),
      getNavigationGrid: (regionId) => options.placement.navigationGridFor(regionId),
    }),
  });
}

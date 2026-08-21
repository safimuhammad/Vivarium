import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { Vivarium2DApp } from "../app/Vivarium2DApp";
import { ChronicleValidationApp } from "./ChronicleValidationApp";
import {
  createProductionChronicleQaOwner,
  type CooperativePresentationClockScheduler,
  type ProductionComposition,
  type ProductionChronicleQaOwner,
} from "./chronicleValidationProduction";
import {
  parseChronicleValidationQuery,
  type ChronicleValidationQuery,
} from "./chronicleValidationModel";
import type { ValidationScheduler } from "./chronicleValidationRuntime";

export interface MountedChronicleValidationRoute {
  readonly owner: ProductionChronicleQaOwner;
  unmount(): Promise<void>;
}

export interface ChronicleValidationRouteScheduling {
  readonly scheduler?: ValidationScheduler;
  readonly presentationClockScheduler?: CooperativePresentationClockScheduler;
}

export interface ChronicleValidationBootInjection extends ChronicleValidationRouteScheduling {
  readonly composition: ProductionComposition;
  readonly parseQuery: (search: string) => ChronicleValidationQuery;
  readonly onMounted: (mounted: MountedChronicleValidationRoute) => void;
}

/** Mounts one strict-query, provider-free production Chronicle validator. */
export async function mountChronicleValidationRoute(options: Readonly<{
  root: HTMLElement;
  composition?: ProductionComposition;
  parseQuery?: (search: string) => ChronicleValidationQuery;
}> & ChronicleValidationRouteScheduling): Promise<MountedChronicleValidationRoute> {
  const query = (options.parseQuery ?? parseChronicleValidationQuery)(window.location.search);
  const owner = createProductionChronicleQaOwner({
    initialChronicleId: query.chronicleId,
    ...(options.composition === undefined ? {} : { composition: options.composition }),
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.presentationClockScheduler === undefined
      ? {}
      : { presentationClockScheduler: options.presentationClockScheduler }),
  });
  let reactRoot: ReturnType<typeof createRoot> | null = null;
  try {
    reactRoot = createRoot(options.root);
    reactRoot.render(createElement(ChronicleValidationApp, {
      owner,
      WorldApp: Vivarium2DApp,
    }));
    await owner.ready;
  } catch (primary) {
    const cleanupErrors = await cleanupRoute(reactRoot, owner);
    throw withCleanupErrors(primary, cleanupErrors, "Chronicle route mount failed");
  }
  const mountedRoot = reactRoot;
  let unmounted = false;
  return Object.freeze({
    owner,
    async unmount(): Promise<void> {
      if (unmounted) return;
      unmounted = true;
      const cleanupErrors = await cleanupRoute(mountedRoot, owner);
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, "Chronicle route unmount failed", {
          cause: cleanupErrors[0],
        });
      }
    },
  });
}

/** Resolves #root and boots the isolated Chronicle validation route. */
export async function bootChronicleValidationRoute(options: Readonly<{
  composition?: ProductionComposition;
  parseQuery?: (search: string) => ChronicleValidationQuery;
  onMounted?(mounted: MountedChronicleValidationRoute): void;
}> & ChronicleValidationRouteScheduling = {}): Promise<MountedChronicleValidationRoute> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Chronicle QA requires #root");
  const mounted = await mountChronicleValidationRoute({
    root,
    ...(options.composition === undefined ? {} : { composition: options.composition }),
    ...(options.parseQuery === undefined ? {} : { parseQuery: options.parseQuery }),
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.presentationClockScheduler === undefined
      ? {}
      : { presentationClockScheduler: options.presentationClockScheduler }),
  });
  try {
    options.onMounted?.(mounted);
    return mounted;
  } catch (primary) {
    const cleanupErrors: unknown[] = [];
    try {
      await mounted.unmount();
    } catch (error) {
      if (error instanceof AggregateError) cleanupErrors.push(...error.errors);
      else cleanupErrors.push(error);
    }
    throw withCleanupErrors(primary, cleanupErrors, "Chronicle route onMounted failed");
  }
}

async function cleanupRoute(
  reactRoot: ReturnType<typeof createRoot> | null,
  owner: ProductionChronicleQaOwner,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  try {
    reactRoot?.unmount();
  } catch (error) {
    errors.push(error);
  }
  await Promise.resolve();
  try {
    owner.dispose();
  } catch (error) {
    if (error instanceof AggregateError) errors.push(...error.errors);
    else errors.push(error);
  }
  return errors;
}

function withCleanupErrors(
  primary: unknown,
  cleanupErrors: readonly unknown[],
  message: string,
): unknown {
  if (cleanupErrors.length === 0) return primary;
  return new AggregateError([primary, ...cleanupErrors], message, { cause: primary });
}

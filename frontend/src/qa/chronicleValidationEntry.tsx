import {
  bootChronicleValidationRoute,
  type ChronicleValidationBootInjection,
} from "./chronicleValidationRoute";

declare global {
  interface Window {
    __vivariumChronicleValidationBootForTest?: ChronicleValidationBootInjection;
  }
}

const injected = typeof window === "undefined"
  ? undefined
  : window.__vivariumChronicleValidationBootForTest;

export const chronicleValidationBoot = typeof document === "undefined"
  ? null
  : bootChronicleValidationRoute(injected ?? {});

export function canonicalJson(value: unknown): string;
export function writeNormalizedJson(filename: string, value: unknown): Promise<void>;
export function readNormalizedJson(filename: string): Promise<unknown>;
export function sha256Buffer(buffer: Uint8Array): string;

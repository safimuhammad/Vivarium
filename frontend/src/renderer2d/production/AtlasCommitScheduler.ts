/** Cancellable task boundary between atlas decoding and atomic scene adoption. */
export interface AtlasCommitScheduler {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

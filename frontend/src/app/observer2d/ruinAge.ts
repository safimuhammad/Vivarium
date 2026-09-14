/** Formats ruin age from the presented world's clock, including paused replay. */
export function formatRuinAge(worldTime: number, ruinedAt: number | null | undefined): string {
  if (ruinedAt == null || !Number.isFinite(ruinedAt) || !Number.isFinite(worldTime)) {
    return "Unknown";
  }
  const seconds = Math.floor(Math.max(0, worldTime - ruinedAt));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

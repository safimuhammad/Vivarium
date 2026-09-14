/** Public narrative quantities use at most one decimal, without a trailing ".0". */
export function formatPublicNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

export function cleanVisibleText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bsimulations\b/gi, (match) => matchCase(match, "worlds"))
    .replace(/\bsimulation\b/gi, (match) => matchCase(match, "world"))
    .replace(/\bagents\b/gi, (match) => matchCase(match, "beings"))
    .replace(/\bagent\b/gi, (match) => matchCase(match, "being"))
    .replace(/\ban LLM\b/gi, (match) => matchCase(match, "a mind"))
    .replace(/\bLLMs\b/gi, (match) => matchCase(match, "minds"))
    .replace(/\bLLM\b/gi, (match) => matchCase(match, "mind"))
    .replace(/\bspawned\b/gi, (match) => matchCase(match, "was born"))
    .replace(/\bspawning\b/gi, (match) => matchCase(match, "being born"))
    .replace(/\bspawns\b/gi, (match) => matchCase(match, "is born"))
    .replace(/\bspawn\b/gi, (match) => matchCase(match, "birth"))
    .replace(/\bNPCs\b/gi, (match) => matchCase(match, "beings"))
    .replace(/\bNPC\b/gi, (match) => matchCase(match, "being"))
    .trim();
}

function matchCase(source: string, replacement: string): string {
  return source[0] === source[0]?.toUpperCase()
    ? `${replacement[0].toUpperCase()}${replacement.slice(1)}`
    : replacement;
}

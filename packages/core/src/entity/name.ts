// Generic words that vary between listings of the same project ("Ink", "Ink Chain").
const STOP_WORDS: ReadonlySet<string> = new Set([
  "airdrop",
  "chain",
  "network",
  "protocol",
  "labs",
  "finance",
  "exchange",
]);

/**
 * Builds a stable comparison key for a project name: NFKC + lowercase, `$`, emoji and
 * punctuation removed, generic stop-word tokens dropped, remaining tokens joined with
 * no separator. If dropping stop words would leave nothing, the original tokens are kept.
 */
export function normalizeName(name: string): string {
  const tokens = name
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  const kept = tokens.filter((t) => !STOP_WORDS.has(t));
  return (kept.length > 0 ? kept : tokens).join("");
}

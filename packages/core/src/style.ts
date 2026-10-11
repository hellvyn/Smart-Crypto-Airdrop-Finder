// Shared writing style for user-facing text (Plan 6 and Plan 9 Global Constraints): the banned word list that the
// web copy gate and the Coach output checks share, and the em dash rule.

/** Banned words and phrases, matched as whole words, case-insensitive. */
export const BANNED_WORDS: readonly string[] = [
  "delve",
  "testament",
  "realm",
  "crucial",
  "multifaceted",
  "in conclusion",
  "furthermore",
  "krusial",
  "esensial",
  "komprehensif",
  "holistik",
  "inovatif",
  "revolusioner",
  "seamless",
  "selain itu",
  "lebih lanjut",
  "kesimpulannya",
  "di era",
  "mari kita",
  "tak hanya",
  "aman",
  "safe",
  "dijamin",
  "pasti untung",
];

const BANNED_PATTERNS = BANNED_WORDS.map((word) => ({
  word,
  pattern: new RegExp(`\\b${word.replace(" ", "\\s+")}\\b`, "i"),
}));

/** The banned words and phrases `text` uses (each once, in `BANNED_WORDS` order), as whole words, any case. */
export function findBanned(text: string): string[] {
  return BANNED_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ word }) => word);
}

/**
 * Replaces each em dash (with the spaces around it) by ", ", the punctuation the style rules allow instead.
 * Same rule as `replaceEmDash` in curate/ai-style.ts; one of the two should absorb the other.
 */
/**
 * Chat text as the plain text the page shows (spec §7: "teks biasa, tanpa markdown"): markdown emphasis, code ticks and
 * heading marks are removed (their words stay), a "* " bullet becomes "- ", and lines that are JSON structure (a lone
 * brace or bracket, or a `"key":` line) are dropped, so a model that answers a chat with markdown or a JSON plan still
 * reads as normal text. Works line by line, so it is safe on any slice that ends at a line or sentence end.
 */
export function plainChatText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*[{}[\]],?\s*$/.test(line) && !/^\s*"[^"\n]*"\s*:/.test(line))
    .map((line) =>
      line
        .replace(/^(\s{0,3})#{1,6}\s+/, "$1")
        .replace(/^(\s*)\*\s+/, "$1- ")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/(^|[^\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}])/gu, "$1$2")
        .replace(/\*\*/g, "")
        .replace(/`+/g, ""),
    )
    .join("\n");
}

export function cleanStyle(text: string): string {
  return text.replace(/\s*—\s*/g, ", ");
}

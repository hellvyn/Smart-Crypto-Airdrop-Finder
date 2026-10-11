// Writing style rules for Indonesian AI output (curation spec §16 "Gaya tulisan", Plan 6 Global Constraints).
// Every analysis prompt lists these phrases; `forbiddenPhrases` finds them in an answer so a run can count them
// (`ai_style_violations`). A forbidden phrase never removes a point: facts matter more than style.

/** Words and phrases AI output must not use, as the prompts list them. */
export const FORBIDDEN_PHRASES: readonly string[] = [
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
  "tak hanya … tetapi juga",
];

const NOT_AFTER_WORD = "(?<![\\p{L}\\p{N}])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}])";

/** A whole-word, whitespace-tolerant pattern for one phrase; "a … b" means a then b in the same sentence. */
function phrasePattern(phrase: string): RegExp {
  const words = (part: string): string =>
    NOT_AFTER_WORD +
    part
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+") +
    NOT_BEFORE_WORD;
  return new RegExp(phrase.split("…").map(words).join("[^.!?]*?"), "iu");
}

const PATTERNS = FORBIDDEN_PHRASES.map((phrase) => ({ phrase, pattern: phrasePattern(phrase) }));

/** The forbidden phrases `text` uses (each once, in `FORBIDDEN_PHRASES` order), matched as whole words, any case. */
export function forbiddenPhrases(text: string): string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ phrase }) => phrase);
}

/** Replaces each em dash (with the spaces around it) by ", ", the punctuation the style rules allow instead. */
export function replaceEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, ", ");
}

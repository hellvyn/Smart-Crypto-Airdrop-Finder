import type { RiskReason } from "../types.js";

const SECRET_RE = /seed phrase|recovery phrase|mnemonic|private key|secret phrase/gi;
// Verbs only: no "deposit" (legit onchain task), no bare "gas fee".
const PAYMENT_RE =
  /\b(send|transfer|pay)\b.{0,40}(to (claim|unlock|receive).{0,20}(airdrop|allocation|tokens?|rewards?)|fee to claim|(gas|fee).{0,20}to claim)/i;
const NEGATION_RE = /\b(never|don't|dont|do not|not)\b/i;
// Whole words in base, third-person (-s/-es/-ies) and -ing forms only, spelled per verb so that final-e verbs
// ("providing", "sharing"), -y verbs ("verifies", "verifying") and doubled consonants ("submitting") match:
// "important" and "typical" are not verbs, and past participles are left out because they read as adjectives
// ("your connected wallet"), not as asks.
const ACTION_VERB_RE = new RegExp(
  "\\b(" +
    [
      "enter(s|ing)?",
      "submit(s|ting)?",
      "provid(e|es|ing)",
      "shar(e|es|ing)",
      "import(s|ing)?",
      "past(e|es|ing)",
      "typ(e|es|ing)",
      "input(s|ting)?",
      "verif(y|ies|ying)",
      "sync(s|ing)?",
      "validat(e|es|ing)",
      "send(s|ing)?",
      "upload(s|ing)?",
      "connect(s|ing)?",
    ].join("|") +
    ")\\b",
  "i",
);
// Sentence/clause boundaries stop the look-back window. A "." only counts when
// followed by whitespace or the end, so decimals like "0.1" are not cut.
const BOUNDARY_RE = /[.?!]+(?=\s|$)|[;:,\u2013\u2014]/g;
const NEGATION_WINDOW_WORDS = 5;
const ACTION_WINDOW_WORDS = 4;

/** The last `n` words before `index`, not crossing the last sentence/clause boundary. */
function wordsBefore(text: string, index: number, n: number): string {
  let before = text.slice(0, index).replace(/[\u2018\u2019]/g, "'");
  let cut = 0;
  for (const m of before.matchAll(BOUNDARY_RE)) cut = (m.index ?? 0) + m[0].length;
  before = before.slice(cut);
  return before
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(-n)
    .join(" ");
}

/** True when the phrase at `index` is an ask: an action verb nearby and no negation before it. */
function isSecretAsk(text: string, index: number): boolean {
  if (NEGATION_RE.test(wordsBefore(text, index, NEGATION_WINDOW_WORDS))) return false;
  return ACTION_VERB_RE.test(wordsBefore(text, index, ACTION_WINDOW_WORDS));
}

function snippet(task: string): string {
  const t = task.trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

/**
 * Scans extracted task strings (not full page text) for requests that are
 * scam signals: asking for a seed phrase / private key, or asking for a
 * payment in order to claim. Warnings such as "Never share your seed phrase"
 * are not flagged. At most one reason per code is returned.
 */
export function detectDangerousAsks(tasks: string[]): RiskReason[] {
  const reasons: RiskReason[] = [];

  const secretTask = tasks.find((task) => {
    for (const m of task.matchAll(SECRET_RE)) {
      if (isSecretAsk(task, m.index ?? 0)) return true;
    }
    return false;
  });
  if (secretTask !== undefined) {
    reasons.push({
      code: "asks_secret",
      severity: "critical",
      message: `A task asks for a seed phrase or private key: "${snippet(secretTask)}"`,
      source: "extraction",
    });
  }

  const paymentTask = tasks.find((task) => PAYMENT_RE.test(task));
  if (paymentTask !== undefined) {
    reasons.push({
      code: "asks_payment",
      severity: "critical",
      message: `A task asks you to send crypto in order to claim: "${snippet(paymentTask)}"`,
      source: "extraction",
    });
  }

  return reasons;
}

export type DangerousAskCode = "asks_secret" | "asks_payment";

export const DANGEROUS_ASK_CODES: readonly DangerousAskCode[] = ["asks_secret", "asks_payment"];

const MAX_SENTENCE_LENGTH = 280;
// A sentence ends at ".", "!" or "?" followed by whitespace (so URLs and decimals stay whole), or at a newline.
const SENTENCE_END_RE = /(?<=[.!?])\s+|\n+/;

function capSentence(sentence: string): string {
  return sentence.length > MAX_SENTENCE_LENGTH ? `${sentence.slice(0, MAX_SENTENCE_LENGTH - 3)}...` : sentence;
}

/**
 * Scans full source text sentence by sentence with the same rules as `detectDangerousAsks`.
 * Returns the first matching sentence per ask code (capped at 280 characters), in code order.
 */
export function findDangerousAskSentences(text: string): { code: DangerousAskCode; sentence: string }[] {
  const sentences = text
    .split(SENTENCE_END_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const found = new Map<string, string>();
  for (const sentence of sentences) {
    for (const reason of detectDangerousAsks([sentence])) {
      if (!found.has(reason.code)) found.set(reason.code, capSentence(sentence));
    }
  }
  return DANGEROUS_ASK_CODES.flatMap((code) => {
    const sentence = found.get(code);
    return sentence === undefined ? [] : [{ code, sentence }];
  });
}

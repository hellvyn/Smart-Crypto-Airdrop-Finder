import type { RiskReason } from "../types.js";

const SECRET_RE = /seed phrase|recovery phrase|mnemonic|private key|secret phrase/gi;
const PAYMENT_RE =
  /(send|deposit|transfer|pay).{0,40}(to (claim|receive|unlock)|fee to claim|gas fee)/i;
const NEGATION_RE = /\b(never|don't|dont|do not|not)\b/i;
const NEGATION_WINDOW_WORDS = 5;

/** True when a negation word sits within the 5 words before `index` ("Never share your seed phrase"). */
function isNegated(text: string, index: number): boolean {
  const before = text
    .slice(0, index)
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(-NEGATION_WINDOW_WORDS)
    .join(" ");
  return NEGATION_RE.test(before);
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
      if (!isNegated(task, m.index ?? 0)) return true;
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

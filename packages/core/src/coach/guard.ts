// Grounding guard for free text the AI writes (curation spec §13, coach and briefing spec §6): nothing may reach a
// reader that sends them somewhere, makes them pay or asks for a secret unless the text it was written from said so.
// `groundedAgainst` refuses; `redactSensitive` removes. Both use the same token patterns.

const HOST_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const HANDLE_RE = /@[a-z0-9_]{2,}/gi;
const ADDRESS_RE = /\b0x[0-9a-fA-F]{6,}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const SECRET_TERM_RE = /seed phrase|recovery phrase|secret phrase|mnemonic|private key|kunci (?:privat|pribadi|rahasia)|frasa (?:seed|pemulihan|rahasia)/i;
const PAYMENT_TERM_RE = /\b(?:send|transfer|pay|deposit|kirim|bayar|setor)/i;

/** What replaces a sensitive token in redacted text. */
const REDACTED = "[dihapus: info sensitif]";

/** A number as its digits only, so "0.01" and "0,01" or "1,000" and "1.000" compare equal. */
const digitsOf = (n: string): string => n.replace(/\D/g, "");

const hostToken = (host: string): string => `host:${host.toLowerCase()}`;
const handleToken = (handle: string): string => `handle:${handle.toLowerCase()}`;
const addressToken = (address: string): string => `addr:${address.startsWith("0x") ? address.toLowerCase() : address}`;

/**
 * The hosts, `@handles` and addresses in `text`, normalised for exact comparison: hosts, handles and `0x` addresses
 * lowercased (they are case-insensitive), base58 addresses untouched (case-sensitive: a case change names another
 * address). Each token is prefixed with its kind so one kind never grounds another.
 */
function tokensOf(text: string): string[] {
  return [
    ...(text.match(HOST_RE) ?? []).map(hostToken),
    ...(text.match(HANDLE_RE) ?? []).map(handleToken),
    ...(text.match(ADDRESS_RE) ?? []).map(addressToken),
  ];
}

/**
 * Whether `text` adds nothing that `context` does not say that could send a reader somewhere or make them pay or give
 * away a secret. Every host or URL, `@handle`, `0x`/base58 address and number in `text` must be one of those the same
 * patterns find in `context` (whole tokens, not substrings; `0x` addresses, hosts and handles ignoring case, base58
 * addresses exact; numbers compared by digits), and a secret term (seed phrase, private key, kunci privat, ...) or a
 * payment verb (send, pay, kirim, bayar, ...) may appear only when the context has one too. Built for refusal: a
 * reworded but harmless text can be refused, never the other way round.
 */
export function groundedAgainst(text: string, context: string): boolean {
  const contextTokens = new Set(tokensOf(context));
  if (tokensOf(text).some((token) => !contextTokens.has(token))) return false;
  const contextNumbers = new Set((context.match(NUMBER_RE) ?? []).map(digitsOf));
  if ((text.match(NUMBER_RE) ?? []).some((n) => !contextNumbers.has(digitsOf(n)))) return false;
  for (const term of [SECRET_TERM_RE, PAYMENT_TERM_RE]) {
    if (term.test(text) && !term.test(context)) return false;
  }
  return true;
}

/** A URL or bare host with its port and path, so a redacted link leaves no path behind. */
const LINK_RE = new RegExp(
  `(?:https?://)?(${HOST_RE.source})(?::\\d+)?(?:[/?#][^\\s]*[^\\s.,;:!?)\\]'"])?`,
  "gi",
);
const SECRET_PHRASE_RE = new RegExp(SECRET_TERM_RE.source, "gi");
const PAYMENT_WORD_RE = new RegExp(`${PAYMENT_TERM_RE.source}[\\p{L}]*`, "giu");

/**
 * Replaces with `[dihapus: info sensitif]` every host or URL, `@handle`, address, secret phrase and payment verb in
 * `text` that `context` does not have (the same patterns and comparison as `groundedAgainst`). A URL goes whole, path
 * included; a secret phrase such as "seed phrase" goes as one unit. `redactions` counts the replacements. Numbers are
 * not redacted: a figure is wrong, not dangerous, and `groundedAgainst` is the check for it.
 */
export function redactSensitive(text: string, context: string): { text: string; redactions: number } {
  const contextTokens = new Set(tokensOf(context));
  let redactions = 0;
  const replaceWhen = (pattern: RegExp, absent: (match: string, group: string | undefined) => boolean) => {
    text = text.replace(pattern, (match: string, group?: string) => {
      if (!absent(match, group)) return match;
      redactions += 1;
      return REDACTED;
    });
  };
  replaceWhen(SECRET_PHRASE_RE, () => !SECRET_TERM_RE.test(context));
  replaceWhen(PAYMENT_WORD_RE, () => !PAYMENT_TERM_RE.test(context));
  replaceWhen(LINK_RE, (_match, host) => !contextTokens.has(hostToken(host ?? "")));
  replaceWhen(ADDRESS_RE, (match) => !contextTokens.has(addressToken(match)));
  replaceWhen(HANDLE_RE, (match) => !contextTokens.has(handleToken(match)));
  return { text, redactions };
}

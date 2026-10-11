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

interface Span {
  start: number;
  end: number;
}

/** A URL or bare host: the head (scheme, host, port) kept apart from the path and query. */
const LINK_RE = new RegExp(
  `((?:https?://)?(${HOST_RE.source})(?::\\d+)?)([/?#](?:[^\\s]*[^\\s.,;:!?)\\]'"])?)?`,
  "gi",
);
const SECRET_PHRASE_RE = new RegExp(`\\b(?:${SECRET_TERM_RE.source.replace(/ /g, "\\s+")})\\p{L}*`, "giu");
/** Indonesian verb prefixes; the k of kirim and the s of setor drop out after meng-, peng-, meny- and peny-. */
const VERB_PREFIX = "(?:di|me(?:m|n|ng)?|pe(?:m|n|ng)?)?";
/** Payment verbs as whole words, suffixes included. send and pay are anchored so payload and sender stay alone. */
const PAYMENT_WORD_RE = new RegExp(
  `\\b(?:${VERB_PREFIX}(?:kirim|bayar|setor|transfer|deposit)|(?:meng|peng)irim|(?:meny|peny)etor)\\p{L}*` +
    `|\\b(?:send|pay)(?:s|ing)?\\b|\\b(?:sent|paid)\\b`,
  "giu",
);
const PROHIBITION_RE = /\b(?:jangan|never|don['’]t|do\s+not|gak\s+boleh|tidak\s+boleh)\b/i;
const SENTENCE_SPLIT_RE = /((?<=[.!?])\s+|\n)/;

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

/** What `context` has, computed once per call. */
interface ContextFacts {
  tokens: Set<string>;
  numbers: Set<string>;
  hasSecretTerm: boolean;
}

/**
 * The hosts, URLs, addresses and handles of `text` that `context` does not have, as spans (offsets shifted by `base`),
 * and the spans of every URL found (`links`, so other passes can stay out of them). A URL whose host is not in the
 * context is one span. For one whose host is, scheme, host and port stay and its path and query are scanned again.
 */
function scanLinks(text: string, base: number, facts: ContextFacts, redacted: Span[], links: Span[]): void {
  for (const m of text.matchAll(LINK_RE)) {
    const start = base + m.index;
    const link = { start, end: start + m[0].length };
    links.push(link);
    if (!facts.tokens.has(hostToken(m[2]!))) {
      redacted.push(link);
    } else if (m[3]) {
      scanPath(m[3], start + m[1]!.length, facts, redacted);
    }
  }
}

/** The path and query of a kept URL: hosts, addresses and handles in it are judged like those anywhere else. */
function scanPath(path: string, base: number, facts: ContextFacts, redacted: Span[]): void {
  const nested: Span[] = [];
  scanLinks(path, base, facts, redacted, nested);
  for (const [pattern, tokenOf] of [
    [ADDRESS_RE, addressToken],
    [HANDLE_RE, handleToken],
  ] as const) {
    for (const m of path.matchAll(pattern)) {
      const span = { start: base + m.index, end: base + m.index + m[0].length };
      if (!nested.some((n) => overlaps(n, span)) && !facts.tokens.has(tokenOf(m[0]))) redacted.push(span);
    }
  }
}

/** The spans of `pattern` in `text` that overlap none of `taken`. */
function spansOutside(text: string, pattern: RegExp, taken: Span[]): Span[] {
  return [...text.matchAll(pattern)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length }))
    .filter((span) => !taken.some((t) => overlaps(t, span)));
}

/** Drops each span that overlaps an earlier one (earliest start wins, then the longest). */
function nonOverlapping(spans: Span[]): Span[] {
  const kept: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))) {
    if (kept.length === 0 || span.start >= kept[kept.length - 1]!.end) kept.push(span);
  }
  return kept;
}

/** `text` with the given spans (disjoint) replaced, and how many there were. */
function replaceSpans(text: string, spans: Span[]): { text: string; redactions: number } {
  let out = "";
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start) + REDACTED;
    at = span.end;
  }
  return { text: out + text.slice(at), redactions: spans.length };
}

/** One sentence, redacted by the rules of `redactSensitive`. */
function redactSentence(sentence: string, facts: ContextFacts): { text: string; redactions: number } {
  const redacted: Span[] = [];
  const links: Span[] = [];
  scanLinks(sentence, 0, facts, redacted, links);

  const addresses = spansOutside(sentence, ADDRESS_RE, links);
  const handles = spansOutside(sentence, HANDLE_RE, [...links, ...addresses]);
  const outside = (spans: Span[]): Span[] => spans.filter((s) => !handles.concat(addresses).some((t) => overlaps(t, s)));
  const secrets = nonOverlapping(outside(spansOutside(sentence, SECRET_PHRASE_RE, links)));
  const payments = nonOverlapping(outside(spansOutside(sentence, PAYMENT_WORD_RE, [...links, ...secrets])));

  const tokenOf = (kind: "addr" | "handle") => (kind === "addr" ? addressToken : handleToken);
  const unknown = (spans: Span[], kind: "addr" | "handle"): Span[] =>
    spans.filter((s) => !facts.tokens.has(tokenOf(kind)(sentence.slice(s.start, s.end))));
  const sensitiveTokens = [...redacted, ...unknown(addresses, "addr"), ...unknown(handles, "handle")];

  // Numbers count outside URLs, addresses and handles only.
  let numberText = sentence;
  for (const span of [...links, ...addresses, ...handles]) {
    numberText = numberText.slice(0, span.start) + " ".repeat(span.end - span.start) + numberText.slice(span.end);
  }
  const newNumber = (numberText.match(NUMBER_RE) ?? []).some((n) => !facts.numbers.has(digitsOf(n)));

  const prohibited = PROHIBITION_RE.test(sentence);
  const payRedacted = sensitiveTokens.length > 0 || (secrets.length > 0 && !prohibited) || newNumber;
  const secretRedacted = !facts.hasSecretTerm || (payments.length > 0 && !prohibited);

  return replaceSpans(
    sentence,
    nonOverlapping([...sensitiveTokens, ...(payRedacted ? payments : []), ...(secretRedacted ? secrets : [])]),
  );
}

/**
 * Replaces with `[dihapus: info sensitif]` what in `text` could send a reader somewhere, make them pay or ask for a
 * secret, unless `context` says it too (the same patterns and comparison as `groundedAgainst`). `redactions` counts
 * the spans replaced. Each sentence (split after . ! ? and at a newline, not at the dots inside hosts and numbers) is
 * judged on its own:
 * - a host or URL, `@handle` or address that `context` does not have is replaced; a URL goes whole, as one span.
 *   When the host of a URL is in `context`, scheme, host and port stay and its path and query are scanned again;
 * - a secret term (seed phrase, private key, kunci privat, ...) that `context` does not have is replaced, suffix
 *   included ("seed phrases", "kunci rahasianya");
 * - a payment verb (kirim, bayar, setor, transfer, deposit, send, pay, with Indonesian prefixes and suffixes, whole
 *   words only) is replaced only when the sentence also has a replaced host, URL, handle or address, or a secret
 *   term (unless the sentence forbids it: jangan, never, ...), or a number that `context` lacks. `context` never
 *   exempts a verb next to such a trigger;
 * - a secret term next to a payment verb in a sentence that forbids nothing is replaced even when `context` has it.
 */
export function redactSensitive(text: string, context: string): { text: string; redactions: number } {
  const facts: ContextFacts = {
    tokens: new Set(tokensOf(context)),
    numbers: new Set((context.match(NUMBER_RE) ?? []).map(digitsOf)),
    hasSecretTerm: SECRET_TERM_RE.test(context),
  };
  let redactions = 0;
  const parts = text.split(SENTENCE_SPLIT_RE).map((part, i) => {
    if (i % 2 === 1) return part;
    const result = redactSentence(part, facts);
    redactions += result.redactions;
    return result.text;
  });
  return { text: parts.join(""), redactions };
}

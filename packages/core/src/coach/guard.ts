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
const SECRET_CORE = SECRET_TERM_RE.source.replace(/ /g, "\\s+");
const SECRET_PHRASE_RE = new RegExp(`\\b(?:${SECRET_CORE})\\p{L}*`, "giu");
const SECRET_CORE_RE = new RegExp(SECRET_CORE, "gi");

/** The secret terms in `text`, lowercased, spaces collapsed, suffix dropped ("Seed  Phrases" gives "seed phrase"). */
const secretCores = (text: string): string[] =>
  (text.match(SECRET_CORE_RE) ?? []).map((core) => core.toLowerCase().replace(/\s+/g, " "));
/** Indonesian verb prefixes; the k of kirim and the s of setor drop out after meng-, peng-, meny- and peny-. */
const VERB_PREFIX = "(?:di|ter|me(?:m|n|ng)?|pe(?:m|n|ng)?)?";
/** Payment verbs as whole words, suffixes included. send and pay are anchored so payload and sender stay alone. */
const PAYMENT_WORD_RE = new RegExp(
  `\\b(?:${VERB_PREFIX}(?:kirim|bayar|setor|transfer|deposit)|(?:meng|peng)irim|(?:meny|peny)etor)\\p{L}*` +
    `|\\b(?:send(?:s|ing)?|pay(?:s|ing|ments?)?)\\b|\\b(?:sent|paid)\\b`,
  "giu",
);
const PROHIBITION_RE = /\b(?:jangan|never|don['’]t|do\s+not|gak\s+boleh|tidak\s+boleh)\b/i;
const SENTENCE_SPLIT_RE = /((?<=[.!?])\s+|\n)/;

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

/** What `context` has, computed once per call. */
interface ContextFacts {
  tokens: Set<string>;
  numbers: Set<string>;
  /** The secret terms (lowercased cores) the context has. */
  secretTerms: Set<string>;
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
  const forbiddenWithPayment = payments.length > 0 && !prohibited;

  return replaceSpans(
    sentence,
    nonOverlapping([...sensitiveTokens, ...(payRedacted ? payments : []), ...secrets.filter((s) => forbiddenWithPayment || !secretCores(sentence.slice(s.start, s.end)).every((c) => facts.secretTerms.has(c)))]),
  );
}

/**
 * Replaces with `[dihapus: info sensitif]` what in `text` could send a reader somewhere, make them pay or ask for a
 * secret, unless `context` says it too (the same patterns and comparison as `groundedAgainst`). `redactions` counts
 * the spans replaced. Each sentence (split after . ! ? and at a newline, not at the dots inside hosts and numbers) is
 * judged on its own:
 * - a host or URL, `@handle` or address that `context` does not have is replaced; a URL goes whole, as one span.
 *   When the host of a URL is in `context`, scheme, host and port stay and its path and query are scanned again;
 * - a secret term (seed phrase, private key, kunci privat, ...) is replaced, suffix included ("seed phrases",
 *   "kunci rahasianya"), unless `context` has the same term (case, spacing and suffix aside; another wording such as
 *   "kunci pribadi" for "kunci privat" is another term);
 * - a payment verb (kirim, bayar, setor, transfer, deposit, send, pay, payment, with Indonesian prefixes and suffixes, whole
 *   words only) is replaced only when the sentence also has a replaced host, URL, handle or address, or a secret
 *   term (unless the sentence forbids it: jangan, never, ...), or a number that `context` lacks. `context` never
 *   exempts a verb next to such a trigger;
 * - a secret term next to a payment verb in a sentence that forbids nothing is replaced even when `context` has it.
 */
export function redactSensitive(text: string, context: string): { text: string; redactions: number } {
  const facts: ContextFacts = {
    tokens: new Set(tokensOf(context)),
    numbers: new Set((context.match(NUMBER_RE) ?? []).map(digitsOf)),
    secretTerms: new Set(secretCores(context)),
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

// ---- Secrets in what a member types ----

/** Seed phrase lengths (BIP39). */
const SEED_LENGTHS = [12, 15, 18, 21, 24] as const;
const SEED_WORD_RE = /^[a-z]{3,8}$/;
const SEED_SEPARATOR_RE = /[\s,]+/;
const PRIVATE_KEY_RE = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
/**
 * Common Indonesian chat words. A seed phrase is made of English words, so a run that has one of these is a
 * sentence, however plain it is written. None of them is a BIP39 word.
 */
const CHAT_WORDS: ReadonlySet<string> = new Set(
  `yang dengan untuk dari atau pada dalam adalah akan juga sudah udah belum tidak bukan bisa mau apa kenapa gimana
  bagaimana dong deh sih nih banget aja saja ini itu dan ada gak nggak tolong saya aku kamu kita mereka dia anda buat
  bantu jelasin jelaskan langkah caranya cara kalau kalo karena tapi tetapi sama lagi masih lebih sangat semua setiap
  seperti sebagai terus lalu habis setelah sebelum supaya biar agar harus perlu boleh minta kasih tanya project proyek
  airdrop wallet modal berapa kapan dimana siapa mana bahasa gampang pemula aman`.split(/\s+/),
);

/**
 * Whether `text` looks like a secret a member must never send: a private key (64 hex characters, `0x` optional), or a
 * seed phrase, that is 12, 15, 18, 21 or 24 (or more) consecutive words of 3 to 8 lowercase letters a to z, split by
 * spaces, commas or newlines only. A word with a capital, a digit or any other punctuation ends the run, and so does
 * a run with an Indonesian chat word in it: ordinary chat is not blocked. Built to refuse, not to be exact: the
 * sender is told to rewrite the message.
 */
export function looksLikeSecret(text: string): boolean {
  if (PRIVATE_KEY_RE.test(text)) return true;
  let run: string[] = [];
  const phraseInRun = (): boolean => {
    const shortest = SEED_LENGTHS[0];
    if (run.length < shortest) return false;
    // Any window of a seed length without a chat word, so a phrase typed after a few words of chat is still found.
    for (const length of SEED_LENGTHS) {
      for (let start = 0; start + length <= run.length; start += 1) {
        if (!run.slice(start, start + length).some((word) => CHAT_WORDS.has(word))) return true;
      }
    }
    return false;
  };
  for (const token of text.split(SEED_SEPARATOR_RE)) {
    if (SEED_WORD_RE.test(token)) {
      run.push(token);
      continue;
    }
    if (phraseInRun()) return true;
    run = [];
  }
  return phraseInRun();
}

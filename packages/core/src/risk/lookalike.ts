import { distance } from "fastest-levenshtein";
import { getPublicSuffix } from "tldts";
import { normalizeName } from "../entity/name.js";
import { registrableDomain, toUnicodeDomain } from "../url/domain.js";

const CONFUSABLES: Readonly<Record<string, string>> = {
  "а": "a", // Cyrillic а
  "е": "e", // Cyrillic е
  "о": "o", // Cyrillic о
  "р": "p", // Cyrillic р
  "с": "c", // Cyrillic с
  "х": "x", // Cyrillic х
  "і": "i", // Cyrillic і
  "ј": "j", // Cyrillic ј
  "ѕ": "s", // Cyrillic ѕ
  "ο": "o", // Greek ο
  "α": "a", // Greek α
  "ρ": "p", // Greek rho
  "ı": "i", // Latin dotless i
  "ԁ": "d", // Cyrillic de
  "ɡ": "g", // Latin script g
};

const MIN_FUZZY_KEY_LENGTH = 5;
const MIN_FUZZY_TOKEN_LENGTH = 4;
const MIN_KEY_LENGTH = 3;

/** Registrable domain of a bare hostname or a full URL, lowercased. */
export function registrableOf(domainOrUrl: string): string | null {
  const url = domainOrUrl.includes("://") ? domainOrUrl : `https://${domainOrUrl}`;
  return registrableDomain(url)?.toLowerCase() ?? null;
}

function foldConfusables(s: string): string {
  let out = "";
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

/** Hostname labels left of the public suffix, confusables folded and lowercased. */
function nameLabels(domain: string): string[] {
  let host = domain.includes("://") ? (domain.split("://")[1] ?? "") : domain;
  host = host.split(/[/?#:]/)[0] ?? "";
  host = host.toLowerCase().replace(/\.$/, "");
  const suffix = getPublicSuffix(host, { allowPrivateDomains: true });
  const withoutSuffix =
    suffix !== null && host.endsWith(`.${suffix}`) ? host.slice(0, -(suffix.length + 1)) : host;
  return foldConfusables(toUnicodeDomain(withoutSuffix).toLowerCase())
    .split(".")
    .filter((l) => l.length > 0);
}

/**
 * True when `domain` is not an official domain of the project but contains
 * the project name (also across homograph characters and `-` separators) or
 * is within a small edit distance of it. Short names (3-4 chars) need an exact
 * label or `-`-separated token to avoid false positives.
 */
export function isLookalike(domain: string, projectName: string, officialDomains: string[]): boolean {
  const reg = registrableOf(domain);
  if (reg !== null) {
    for (const official of officialDomains) {
      if (registrableOf(official) === reg) return false;
    }
  }

  const key = normalizeName(projectName);
  if (key.length < MIN_KEY_LENGTH) return false;

  const labels = nameLabels(domain);
  if (key.length >= MIN_FUZZY_KEY_LENGTH) {
    // 1 edit for 5-6 letter names, 2 edits for longer ones.
    const maxDistance = key.length >= 7 ? 2 : 1;
    return labels.some((label) => {
      const squashed = label.replace(/-/g, "");
      if (squashed.includes(key) || distance(squashed, key) <= maxDistance) return true;
      // Typo plus affix: "uniswqp-airdrop" is caught on its own token.
      return label
        .split("-")
        .some((token) => token.length >= MIN_FUZZY_TOKEN_LENGTH && distance(token, key) <= maxDistance);
    });
  }
  return labels.some((label) => label === key || label.split("-").some((token) => token === key));
}

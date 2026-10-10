import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName, registrableDomain } from "@saf/core";
import type { RiskInput } from "@saf/core";
import { createHttp } from "../../src/http.js";

const SET_DIR = fileURLToPath(new URL(".", import.meta.url));
const SCAM_PATH = join(SET_DIR, "cases", "scam.json");

const METAMASK_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
const SCAMSNIFFER_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json";

/** Words that make a domain look like a fake airdrop even when no project name is in it. */
const AIRDROP_WORDS = /(airdrop|claim|drop|reward)/;
/** A project name shorter than this would match unrelated domains ("ens", "op"), so it is not used. */
const MIN_NAME_LENGTH = 4;
const DEFAULT_MAX_CASES = 60;
const DEFAULT_PER_BRAND = 3;

export interface LegitEntry {
  name: string;
  officialDomain: string;
  /** Where the real claim happens, when it is not the official domain. */
  claimDomain?: string;
}
export type LegitCase = { kind: "legit" } & LegitEntry;
export interface ScamCase {
  kind: "scam";
  /** A phishing-listed registrable domain. */
  domain: string;
  /** The legit project the domain imitates (its name as in `legit.json`). */
  brand: string;
}
export type EvalCase = ScamCase | LegitCase;

/** What the enrichment steps learned, keyed by registrable domain. Missing = not checked. */
export interface Enrichment {
  domainAgeDays: Record<string, number | null>;
  phishingFlags: Record<string, boolean | null>;
}

export type LegitIndex = ReadonlyMap<string, LegitEntry>;

/** Legit projects by `normalizeName(name)`. */
export function indexLegit(entries: readonly LegitEntry[]): LegitIndex {
  return new Map(entries.map((e) => [normalizeName(e.name), e]));
}

/**
 * Builds the risk input for one case the way the pipeline would see it. Everything that is not a link
 * check (sources, social, status) is held neutral and identical for scam and legit, so the engine is
 * measured on its domain, age and phishing-list checks only.
 * A scam is the brand's project name with one claim link on the scam domain; the brand's real domain is the
 * official domain when the brand is in the legit list, otherwise there is none.
 */
export function toRiskInput(c: EvalCase, legitIndex: LegitIndex, enrich: Enrichment): RiskInput {
  let name: string;
  let officialDomains: string[];
  let linkDomains: RiskInput["linkDomains"];
  if (c.kind === "scam") {
    name = c.brand;
    const official = legitIndex.get(normalizeName(c.brand))?.officialDomain;
    officialDomains = official === undefined ? [] : [official];
    linkDomains = [{ domain: c.domain, kind: "claim" }];
  } else {
    name = c.name;
    officialDomains = [c.officialDomain];
    linkDomains = [
      { domain: c.officialDomain, kind: "website" },
      { domain: c.claimDomain ?? c.officialDomain, kind: "claim" },
    ];
  }
  const domains = [...new Set(linkDomains.map((l) => l.domain))];
  return {
    project: {
      name,
      officialDomains,
      status: "live",
      tokenSymbol: null,
      conflict: false,
      sourceCount: 2,
      hasOfficialSocial: true,
      lookalikeOf: null,
      lookalikeOfName: null,
      lookalikeOfDomains: [],
    },
    tasks: [],
    sourceAsks: [],
    linkDomains,
    domainAgeDays: Object.fromEntries(domains.map((d) => [d, enrich.domainAgeDays[d] ?? null])),
    phishingFlags: Object.fromEntries(domains.map((d) => [d, enrich.phishingFlags[d] ?? null])),
    token: null,
    contractVerified: null,
    hackCount: null,
  };
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** From this length on a name inside a domain is distinctive enough to count wherever it sits. */
const DISTINCTIVE_NAME_LENGTH = 6;

/**
 * The legit project whose name the domain contains (first in list order), or null. A name of
 * `MIN_NAME_LENGTH` to 5 letters must start a word of the domain ("ondo" in "claim-ondofinance"), because
 * inside another word ("allocation-dopplerfinance") it is a coincidence, not an imitation.
 */
export function brandOf(domain: string, legitNames: readonly string[]): string | null {
  const flat = squash(domain);
  const words = domain.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "");
  for (const name of legitNames) {
    const key = normalizeName(name);
    if (key.length < MIN_NAME_LENGTH) continue;
    const found = key.length >= DISTINCTIVE_NAME_LENGTH ? flat.includes(key) : words.some((w) => w.startsWith(key));
    if (found) return name;
  }
  return null;
}

/**
 * Keeps the apex domains that look like a fake airdrop: an airdrop word in them, or a legit project name.
 * Lowercased, each once, in input order. Subdomains are dropped (enrichment works per registrable domain).
 */
export function selectAirdropLike(domains: readonly string[], legitNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of domains) {
    const domain = raw.trim().toLowerCase();
    if (domain === "" || seen.has(domain) || registrableDomain(`https://${domain}`) !== domain) continue;
    if (AIRDROP_WORDS.test(domain) || brandOf(domain, legitNames) !== null) {
      seen.add(domain);
      out.push(domain);
    }
  }
  return out;
}

/** The `blacklist` array of the MetaMask phishing config, or null if the file is not in that shape. */
export function parseMetaMaskBlacklist(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const list = (raw as { blacklist?: unknown }).blacklist;
  return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : null;
}

/** The ScamSniffer domain list (a JSON array of strings), or null if the file is not in that shape. */
export function parseScamSnifferDomains(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string") : null;
}

const hashOf = (s: string): string => createHash("sha1").update(s).digest("hex");

/**
 * Scam cases from airdrop-like domains that imitate a known brand. A domain with no known brand has no
 * project to impersonate, so it is not used. At most `perBrand` per brand and `max` in total; the choice is
 * by a hash of the domain, so it is stable for the same list and does not favour early letters.
 */
export function pickCases(
  domains: readonly string[],
  legitNames: readonly string[],
  limits: { perBrand: number; max: number },
): ScamCase[] {
  const candidates = selectAirdropLike(domains, legitNames)
    .map((domain) => ({ domain, brand: brandOf(domain, legitNames) }))
    .filter((c): c is { domain: string; brand: string } => c.brand !== null)
    .sort((a, b) => hashOf(a.domain).localeCompare(hashOf(b.domain)));
  const perBrand = new Map<string, number>();
  const out: ScamCase[] = [];
  for (const c of candidates) {
    if (out.length >= limits.max) break;
    const used = perBrand.get(c.brand) ?? 0;
    if (used >= limits.perBrand) continue;
    perBrand.set(c.brand, used + 1);
    out.push({ kind: "scam", domain: c.domain, brand: c.brand });
  }
  return out;
}

export function readLegit(): LegitEntry[] {
  return JSON.parse(readFileSync(join(SET_DIR, "legit.json"), "utf8")) as LegitEntry[];
}

async function build(): Promise<void> {
  const legitNames = readLegit().map((l) => l.name);
  const http = createHttp();
  const sources = [
    { label: "metamask", url: METAMASK_URL, parse: parseMetaMaskBlacklist },
    { label: "scamsniffer", url: SCAMSNIFFER_URL, parse: parseScamSnifferDomains },
  ];
  const all: string[] = [];
  for (const source of sources) {
    const res = await http.get(source.url);
    let parsed: string[] | null = null;
    if (res.status === 200) {
      try {
        parsed = source.parse(JSON.parse(res.body));
      } catch {
        parsed = null;
      }
    }
    if (parsed === null) {
      console.log(`${source.label}: unusable (HTTP ${res.status}, or the file is not in the expected format)`);
      continue;
    }
    console.log(`${source.label}: ${parsed.length} domains`);
    for (const d of parsed) all.push(d);
  }

  const airdropLike = selectAirdropLike(all, legitNames);
  const cases = pickCases(all, legitNames, { perBrand: DEFAULT_PER_BRAND, max: DEFAULT_MAX_CASES });
  console.log(`airdrop-like apex domains: ${airdropLike.length}; scam cases with a known brand: ${cases.length}`);
  if (cases.length < 30) console.log("Fewer than 30 scam cases: the set is too small for gate G7 (needs >= 30).");
  if (cases.length === 0) return;
  mkdirSync(dirname(SCAM_PATH), { recursive: true });
  writeFileSync(SCAM_PATH, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`wrote ${cases.length} cases (gitignored)`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build();
}

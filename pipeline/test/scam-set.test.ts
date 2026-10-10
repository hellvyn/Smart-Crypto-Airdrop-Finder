import { readFileSync } from "node:fs";
import { assessRisk } from "@saf/core";
import type { RiskLevel } from "@saf/core";
import { describe, expect, it } from "vitest";
import {
  brandOf,
  indexLegit,
  parseMetaMaskBlacklist,
  parseScamSnifferDomains,
  pickCases,
  selectAirdropLike,
  toRiskInput,
} from "../eval/scam-set/build.js";
import type { Enrichment, LegitEntry } from "../eval/scam-set/build.js";
import { summarize } from "../eval/scam-set/run.js";
import type { Result } from "../eval/scam-set/run.js";

const legit: LegitEntry[] = [
  { name: "Arbitrum", officialDomain: "arbitrum.io" },
  { name: "Jupiter", officialDomain: "jup.ag" },
  { name: "zkSync", officialDomain: "zksync.io", claimDomain: "zknation.io" },
];
const legitIndex = indexLegit(legit);
const legitNames = legit.map((l) => l.name);
const noEnrich: Enrichment = { domainAgeDays: {}, phishingFlags: {} };

describe("toRiskInput", () => {
  it("maps a scam case to a claim link on the scam domain with the brand's real domain", () => {
    const input = toRiskInput({ kind: "scam", domain: "arbitrum-claim.xyz", brand: "Arbitrum" }, legitIndex, noEnrich);
    expect(input.project.name).toBe("Arbitrum");
    expect(input.linkDomains).toContainEqual({ domain: "arbitrum-claim.xyz", kind: "claim" });
    expect(input.project.officialDomains).toEqual(["arbitrum.io"]);
  });

  it("leaves the official domains empty when the brand is not in the legit list", () => {
    const input = toRiskInput({ kind: "scam", domain: "unknownbrand-drop.xyz", brand: "UnknownBrand" }, legitIndex, noEnrich);
    expect(input.project.officialDomains).toEqual([]);
  });

  it("maps a legit case to its website and to a claim link on its claim domain, falling back to the official domain", () => {
    const withClaim = toRiskInput({ kind: "legit", name: "zkSync", officialDomain: "zksync.io", claimDomain: "zknation.io" }, legitIndex, noEnrich);
    expect(withClaim.project.officialDomains).toEqual(["zksync.io"]);
    expect(withClaim.linkDomains).toEqual([
      { domain: "zksync.io", kind: "website" },
      { domain: "zknation.io", kind: "claim" },
    ]);
    const withoutClaim = toRiskInput({ kind: "legit", name: "Jupiter", officialDomain: "jup.ag" }, legitIndex, noEnrich);
    expect(withoutClaim.linkDomains).toEqual([
      { domain: "jup.ag", kind: "website" },
      { domain: "jup.ag", kind: "claim" },
    ]);
  });

  it("carries only the enrichment of the case's own domains, and null where nothing was fetched", () => {
    const enrich: Enrichment = {
      domainAgeDays: { "arbitrum-claim.xyz": 4, "other.com": 9 },
      phishingFlags: { "arbitrum-claim.xyz": true },
    };
    const input = toRiskInput({ kind: "scam", domain: "arbitrum-claim.xyz", brand: "Arbitrum" }, legitIndex, enrich);
    expect(input.domainAgeDays).toEqual({ "arbitrum-claim.xyz": 4 });
    expect(input.phishingFlags).toEqual({ "arbitrum-claim.xyz": true });
  });

  it("makes the risk engine flag a lookalike claim domain of a known brand as high", () => {
    const input = toRiskInput({ kind: "scam", domain: "arbitrum-claim.xyz", brand: "Arbitrum" }, legitIndex, noEnrich);
    expect(assessRisk(input).level).toBe("high");
  });

  it("makes the risk engine flag a phishing-listed scam domain as critical", () => {
    const enrich: Enrichment = { domainAgeDays: {}, phishingFlags: { "claim-rewards.xyz": true } };
    const input = toRiskInput({ kind: "scam", domain: "claim-rewards.xyz", brand: "Jupiter" }, legitIndex, enrich);
    expect(assessRisk(input).level).toBe("critical");
  });

  it("keeps a legit case with a clean enrichment out of high and critical", () => {
    const enrich: Enrichment = {
      domainAgeDays: { "zksync.io": 1200, "zknation.io": 700 },
      phishingFlags: { "zksync.io": false, "zknation.io": false },
    };
    const input = toRiskInput({ kind: "legit", name: "zkSync", officialDomain: "zksync.io", claimDomain: "zknation.io" }, legitIndex, enrich);
    expect(["low", "medium"]).toContain(assessRisk(input).level);
  });
});

describe("selectAirdropLike", () => {
  it("selects airdrop-like domains from a blacklist", () => {
    expect(selectAirdropLike(["arb-airdrop.com", "random.site", "jup-claim.io"], legitNames)).toEqual(["arb-airdrop.com", "jup-claim.io"]);
  });

  it("selects a domain that contains a legit project name even without an airdrop word", () => {
    expect(selectAirdropLike(["arbitrumfoundation.xyz", "bank-login.com"], legitNames)).toEqual(["arbitrumfoundation.xyz"]);
  });

  it("ignores subdomains and keeps each domain once, lowercased", () => {
    expect(selectAirdropLike(["claim.evil.com", "Free-Airdrop.com", "free-airdrop.com"], legitNames)).toEqual(["free-airdrop.com"]);
  });

  it("does not let a very short project name match every domain", () => {
    expect(selectAirdropLike(["ensure-login.com", "opera-login.com"], [...legitNames, "ENS", "OP"])).toEqual([]);
  });
});

describe("blacklist parsers", () => {
  it("reads the blacklist array of the MetaMask config and rejects any other shape", () => {
    expect(parseMetaMaskBlacklist({ version: 2, whitelist: ["a.com"], blacklist: ["x.com", "y.com"] })).toEqual(["x.com", "y.com"]);
    expect(parseMetaMaskBlacklist({ version: 2, blacklist: "x.com" })).toBeNull();
    expect(parseMetaMaskBlacklist(["x.com"])).toBeNull();
  });

  it("reads the ScamSniffer domain array and rejects any other shape", () => {
    expect(parseScamSnifferDomains(["x.com", "y.com"])).toEqual(["x.com", "y.com"]);
    expect(parseScamSnifferDomains({ domains: ["x.com"] })).toBeNull();
  });

  it("drops non-string entries from a valid list", () => {
    expect(parseScamSnifferDomains(["x.com", 5, null])).toEqual(["x.com"]);
  });
});

describe("pickCases", () => {
  const names = ["Arbitrum", "Jupiter"];

  it("builds scam cases with their brand, at most perBrand per brand, branded domains only", () => {
    const domains = ["arbitrum-a.xyz", "arbitrum-b.xyz", "arbitrum-c.xyz", "jupiter-claim.io", "free-airdrop.com"];
    const cases = pickCases(domains, names, { perBrand: 2, max: 10 });
    expect(cases.filter((c) => c.brand === "Arbitrum")).toHaveLength(2);
    expect(cases.filter((c) => c.brand === "Jupiter")).toHaveLength(1);
    expect(cases.every((c) => c.kind === "scam")).toBe(true);
    expect(cases.map((c) => c.domain)).not.toContain("free-airdrop.com");
  });

  it("returns the same cases for the same input regardless of input order", () => {
    const a = ["arbitrum-a.xyz", "arbitrum-b.xyz", "arbitrum-c.xyz", "arbitrum-d.xyz"];
    const first = pickCases(a, names, { perBrand: 2, max: 10 });
    const second = pickCases([...a].reverse(), names, { perBrand: 2, max: 10 });
    expect(second).toEqual(first);
  });

  it("stops at max", () => {
    const domains = ["arbitrum-a.xyz", "jupiter-a.xyz", "jupiter-b.xyz"];
    expect(pickCases(domains, names, { perBrand: 5, max: 2 })).toHaveLength(2);
  });
});

describe("brandOf", () => {
  it("returns the legit project whose name the domain contains, or null", () => {
    expect(brandOf("arbitrum-claim.xyz", legitNames)).toBe("Arbitrum");
    expect(brandOf("zksync-airdrop.com", legitNames)).toBe("zkSync");
    expect(brandOf("free-airdrop.com", legitNames)).toBeNull();
  });

  it("needs a short project name to start a word of the domain, not sit inside another word", () => {
    const names = ["Ondo", "Jito"];
    expect(brandOf("claim-ondofinance.xyz", names)).toBe("Ondo");
    expect(brandOf("jitocoin-air.com", names)).toBe("Jito");
    expect(brandOf("allocation-dopplerfinance.com", names)).toBeNull();
  });
});

describe("summarize", () => {
  const results = (kind: "scam" | "legit", levels: RiskLevel[]): Result[] => levels.map((level) => ({ kind, level }));

  it("counts scams that pass risk (low or medium) separately from those with too little data", () => {
    const s = summarize([
      ...results("scam", ["low", "medium", "high", "critical", "insufficient_data", "critical"]),
      ...results("legit", ["low"]),
    ]);
    expect(s.scam).toEqual({ total: 6, passedRisk: 2, insufficientData: 1, caught: 3 });
  });

  it("counts legit cases the engine would hide (high or critical)", () => {
    const s = summarize([
      ...results("scam", ["critical"]),
      ...results("legit", ["low", "medium", "high", "critical", "insufficient_data"]),
    ]);
    expect(s.legit).toEqual({ total: 5, hidden: 2, insufficientData: 1 });
  });
});

describe("legit.json", () => {
  const entries = JSON.parse(readFileSync(new URL("../eval/scam-set/legit.json", import.meta.url), "utf8")) as LegitEntry[];

  it("lists at least 30 airdrops with unique names and valid domains", () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(new Set(entries.map((e) => e.name.toLowerCase())).size).toBe(entries.length);
    for (const e of entries) {
      expect(e.officialDomain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      if (e.claimDomain !== undefined) expect(e.claimDomain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
  });
});

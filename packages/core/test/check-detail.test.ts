// What each risk check found, for the security check block of the project page (#53): `assessRisk` fills
// `RiskCheck.detail` from its own input, never with a made-up number. `CHECK_OF_REASON` ties every warning back to the
// check that raised it, so a check can be shown as "found something" (public) without its member-only details (#54).
import { describe, expect, it } from "vitest";
import { CHECK_OF_REASON, assessRisk, storedAnalystSchema } from "../src/index.js";
import type { CheckId, RiskInput } from "../src/index.js";

const input: RiskInput = {
  project: {
    name: "Nebula",
    officialDomains: ["nebula.example", "nebula-docs.example"],
    status: "live",
    tokenSymbol: null,
    conflict: false,
    sourceCount: 3,
    hasOfficialSocial: true,
    lookalikeOf: null,
    lookalikeOfName: null,
    lookalikeOfDomains: [],
  },
  tasks: ["Swap on the app"],
  sourceAsks: [],
  linkDomains: [
    { domain: "nebula.example", kind: "website" },
    { domain: "claim-nebula.example", kind: "claim" },
  ],
  domainAgeDays: { "claim-nebula.example": 400, "nebula.example": 812, "nebula-docs.example": null },
  phishingFlags: { "nebula.example": false, "claim-nebula.example": false, "nebula-docs.example": null },
  token: null,
  contractVerified: null,
  hackCount: 0,
  claimLinks: [
    { url: "https://claim-nebula.example/claim", status: "different_domain" },
    { url: "https://app.nebula.example/", status: "official" },
    { url: "https://late.nebula.example/", status: "unchecked" },
  ],
  officialDomainCount: 1240,
  documentsRead: 4,
};

const detailOf = (i: RiskInput, id: CheckId) => assessRisk(i).checks.find((c) => c.id === id)?.detail;

describe("assessRisk check details (#53)", () => {
  it("gives domain_age the main official domain and the age RDAP reported for it", () => {
    expect(detailOf(input, "domain_age")).toEqual({ domain: "nebula.example", ageDays: 812 });
  });

  it("names the official domain without an age when RDAP had no answer for it", () => {
    const i: RiskInput = { ...input, domainAgeDays: { "claim-nebula.example": 400 } };
    expect(detailOf(i, "domain_age")).toEqual({ domain: "nebula.example", ageDays: null });
  });

  it("has no domain for domain_age when the project has no official domain", () => {
    const i: RiskInput = { ...input, project: { ...input.project, officialDomains: [] } };
    expect(detailOf(i, "domain_age")).toEqual({ domain: null, ageDays: null });
  });

  it("counts the official domains lookalike was compared with, and the documents the scanner read", () => {
    expect(detailOf(input, "lookalike")).toEqual({ compared: 1240 });
    expect(detailOf(input, "dangerous_asks")).toEqual({ sources: 4 });
  });

  it("leaves a count it was not given as null instead of guessing", () => {
    const { officialDomainCount: _c, documentsRead: _d, ...without } = input;
    expect(detailOf(without, "lookalike")).toEqual({ compared: null });
    expect(detailOf(without, "dangerous_asks")).toEqual({ sources: null });
  });

  it("counts the domains GoPlus answered plus the claim links it checked, and the domains on the list", () => {
    // 2 answered domains (one had no answer) + 2 checked links (one unchecked); nothing flagged.
    expect(detailOf(input, "phishing_list")).toEqual({ checked: 4, hits: 0 });
    const flagged: RiskInput = {
      ...input,
      phishingFlags: { ...input.phishingFlags, "claim-nebula.example": true },
      claimLinks: [{ url: "https://claim-nebula.example/claim", status: "phishing" }],
    };
    expect(detailOf(flagged, "phishing_list")).toEqual({ checked: 3, hits: 1 });
  });

  it("gives hack_history the hack count and corroboration the number of sources", () => {
    expect(detailOf({ ...input, hackCount: 2 }, "hack_history")).toEqual({ count: 2 });
    expect(detailOf({ ...input, hackCount: null }, "hack_history")).toEqual({ count: null });
    expect(detailOf(input, "corroboration")).toEqual({ sources: 3 });
  });

  it("gives no detail to the checks that have none to show", () => {
    for (const id of ["token_security", "contract_verified", "ai_review"] as const) {
      expect(detailOf(input, id)).toBeUndefined();
    }
  });
});

describe("CHECK_OF_REASON", () => {
  const inputs: RiskInput[] = [
    { ...input, tasks: ["Enter your seed phrase to claim"] },
    { ...input, sourceAsks: [{ code: "asks_payment", quote: "Send 0.1 ETH to claim your airdrop" }] },
    { ...input, phishingFlags: { "claim-nebula.example": true } },
    { ...input, claimLinks: [{ url: "https://claim-nebula.example/claim", status: "phishing" }] },
    { ...input, domainAgeDays: { "claim-nebula.example": 5 } },
    { ...input, linkDomains: [{ domain: "nebula-airdrop.example", kind: "claim" }] },
    { ...input, project: { ...input.project, lookalikeOf: "p2", lookalikeOfName: "Nebula", lookalikeOfDomains: [] } },
    { ...input, token: { honeypot: true, ownerCanMintOrChangeBalance: true, maliciousCreator: true } },
    { ...input, contractVerified: false, hackCount: 3 },
    { ...input, project: { ...input.project, sourceCount: 1, hasOfficialSocial: false, conflict: true } },
    { ...input, aiFlags: { scam: [{ pattern: "urgency", quote: "Only 2 hours left" }], contradictions: 2 } },
  ];

  it("maps every warning assessRisk raises (medium or more) to the check it came from", () => {
    const codes = new Set(inputs.flatMap((i) => assessRisk(i).reasons.filter((r) => r.severity !== "info").map((r) => r.code)));
    expect([...codes].sort()).toEqual(
      [
        "ai_contradiction",
        "ai_scam_pattern",
        "asks_payment",
        "asks_secret",
        "conflicting_evidence",
        "hack_history",
        "lookalike_domain",
        "malicious_creator",
        "new_claim_domain",
        "phishing_claim_link",
        "phishing_listed",
        "single_source",
        "token_honeypot",
        "token_owner_powers",
        "unverified_contract",
        "young_domain",
      ].sort(),
    );
    for (const code of codes) expect(CHECK_OF_REASON[code], code).toBeDefined();
  });

  it("ties each warning to the right check", () => {
    expect(CHECK_OF_REASON).toEqual({
      asks_secret: "dangerous_asks",
      asks_payment: "dangerous_asks",
      phishing_listed: "phishing_list",
      phishing_claim_link: "phishing_list",
      young_domain: "domain_age",
      new_claim_domain: "domain_age",
      lookalike_domain: "lookalike",
      token_honeypot: "token_security",
      token_owner_powers: "token_security",
      malicious_creator: "token_security",
      unverified_contract: "contract_verified",
      hack_history: "hack_history",
      single_source: "corroboration",
      conflicting_evidence: "corroboration",
      ai_contradiction: "corroboration",
      ai_scam_pattern: "ai_review",
    });
  });
});

describe("storedAnalystSchema", () => {
  const stored = {
    verdict: "pantau",
    confidence: "rendah",
    points: [],
    effort: { minutes_per_day: null, capital_usd_min: null, note: "" },
    steps_id: [],
  };

  it("reads a stored Analyst result whose points post-processing removed", () => {
    expect(storedAnalystSchema.safeParse(stored).success).toBe(true);
  });

  it("still refuses a result that is not an Analyst answer", () => {
    expect(storedAnalystSchema.safeParse({ ...stored, verdict: "aman" }).success).toBe(false);
    expect(storedAnalystSchema.safeParse({ flags: [] }).success).toBe(false);
  });
});

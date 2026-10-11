import { describe, expect, it } from "vitest";
import { assessRisk, detectDangerousAsks, findDangerousAskSentences, isLookalike } from "../src/index.js";
import type { CheckId, RiskInput } from "../src/index.js";

describe("detectDangerousAsks", () => {
  it("flags a request for a seed phrase as critical", () => {
    const r = detectDangerousAsks(["Enter your seed phrase to verify"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: "asks_secret", severity: "critical" });
  });

  it("does not flag warnings that negate the ask", () => {
    expect(detectDangerousAsks(["Never share your seed phrase"])).toEqual([]);
    expect(detectDangerousAsks(["We don't ask for your private key"])).toEqual([]);
    expect(detectDangerousAsks(["Do not enter your recovery phrase anywhere"])).toEqual([]);
  });

  it("is case-insensitive", () => {
    const r = detectDangerousAsks(["SUBMIT YOUR PRIVATE KEY"]);
    expect(r.map((x) => x.code)).toEqual(["asks_secret"]);
  });

  it("only honours a negation within the 5 words before the match", () => {
    const r = detectDangerousAsks(["Never mind the rest of this long text, provide your mnemonic"]);
    expect(r.map((x) => x.code)).toEqual(["asks_secret"]);
  });

  it("flags payment requests to claim", () => {
    const r = detectDangerousAsks(["Send 0.1 ETH to receive your airdrop"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: "asks_payment", severity: "critical" });
    expect(detectDangerousAsks(["Pay a gas fee to claim your tokens"]).map((x) => x.code)).toEqual([
      "asks_payment",
    ]);
  });

  it("does not flag legitimate deposit, bridge and repay tasks", () => {
    expect(detectDangerousAsks(["Bridge ETH to Base and pay gas fees"])).toEqual([]);
    expect(detectDangerousAsks(["Repay your loan to unlock boosted rewards"])).toEqual([]);
    expect(detectDangerousAsks(["Deposit ETH into the vault to receive points"])).toEqual([]);
  });

  it("does not let a negation cross a sentence or clause boundary", () => {
    expect(detectDangerousAsks(["Not sure how? Enter your seed phrase to sync"]).map((x) => x.code)).toEqual([
      "asks_secret",
    ]);
    expect(
      detectDangerousAsks(["If your wallet does not connect, enter your recovery phrase"]).map((x) => x.code),
    ).toEqual(["asks_secret"]);
  });

  it("requires an action verb before the secret phrase", () => {
    expect(detectDangerousAsks(["No one from our team will ever ask for your seed phrase"])).toEqual([]);
    expect(detectDangerousAsks(["Create a wallet and back up your seed phrase"])).toEqual([]);
  });

  it("does not treat words that merely start with an action verb as a verb", () => {
    expect(detectDangerousAsks(["It is important to keep your seed phrase safe"])).toEqual([]);
    expect(detectDangerousAsks(["Make sure your connected wallet has its seed phrase backed up"])).toEqual([]);
    expect(detectDangerousAsks(["A typical seed phrase has 12 words"])).toEqual([]);
    expect(detectDangerousAsks(["Once connected, your seed phrase stays in your wallet"])).toEqual([]);
  });

  it("accepts plain inflections of action verbs", () => {
    expect(detectDangerousAsks(["Enter your seed phrase to verify"]).map((x) => x.code)).toEqual(["asks_secret"]);
    expect(detectDangerousAsks(["Users submit their seed phrase here"]).map((x) => x.code)).toEqual(["asks_secret"]);
    expect(detectDangerousAsks(["Start by entering your recovery phrase"]).map((x) => x.code)).toEqual(["asks_secret"]);
    expect(detectDangerousAsks(["He enters your private key"]).map((x) => x.code)).toEqual(["asks_secret"]);
  });

  it("accepts -ing forms of verbs that drop their final e, and -ies forms", () => {
    const secret = (t: string) => detectDangerousAsks([t]).map((x) => x.code);
    expect(secret("Start by providing your seed phrase")).toEqual(["asks_secret"]);
    expect(secret("Claim by sharing your private key")).toEqual(["asks_secret"]);
    expect(secret("Finish by pasting your mnemonic")).toEqual(["asks_secret"]);
    expect(secret("Continue typing your recovery phrase")).toEqual(["asks_secret"]);
    expect(secret("Claim after validating your secret phrase")).toEqual(["asks_secret"]);
    expect(secret("The bot verifies your seed phrase")).toEqual(["asks_secret"]);
    expect(secret("Then verifying your private key")).toEqual(["asks_secret"]);
    expect(secret("Claim by submitting your seed phrase")).toEqual(["asks_secret"]);
    expect(secret("Never sharing your seed phrase")).toEqual([]);
    expect(secret("Never providing your private key to anyone")).toEqual([]);
  });

  it("ignores harmless tasks", () => {
    expect(detectDangerousAsks(["Swap on the testnet", "Follow us on X"])).toEqual([]);
  });
});

describe("findDangerousAskSentences", () => {
  it("returns the first sentence per ask code", () => {
    const text =
      "DeepBook airdrop is live. Never share your seed phrase. Enter your seed phrase to claim! Pay a gas fee to claim your tokens.\nEnter your private key too.";
    expect(findDangerousAskSentences(text)).toEqual([
      { code: "asks_secret", sentence: "Enter your seed phrase to claim!" },
      { code: "asks_payment", sentence: "Pay a gas fee to claim your tokens." },
    ]);
  });

  it("finds nothing in warnings or harmless text", () => {
    expect(findDangerousAskSentences("Never share your seed phrase. Bridge ETH to Base and pay gas fees.")).toEqual([]);
    expect(findDangerousAskSentences("")).toEqual([]);
  });

  it("does not split on dots inside URLs or decimals", () => {
    const text = "Send 0.1 ETH to receive your airdrop at [https://deepbook-airdrop.xyz/claim] today. Done.";
    expect(findDangerousAskSentences(text)).toEqual([
      { code: "asks_payment", sentence: "Send 0.1 ETH to receive your airdrop at [https://deepbook-airdrop.xyz/claim] today." },
    ]);
  });

  it("caps very long sentences", () => {
    const long = `Enter your seed phrase ${"and more words ".repeat(40)}`;
    const [hit] = findDangerousAskSentences(long);
    expect(hit?.sentence.length).toBeLessThanOrEqual(280);
    expect(hit?.sentence.endsWith("...")).toBe(true);
  });
});

describe("isLookalike", () => {
  const official = ["uniswap.org"];

  it("detects claim-style domains containing the name", () => {
    expect(isLookalike("claim-uniswap-airdrop.xyz", "Uniswap", official)).toBe(true);
  });

  it("detects Cyrillic homograph domains", () => {
    expect(isLookalike("xn--unswap-qvf.org", "Uniswap", official)).toBe(true);
    expect(isLookalike("unіswap.org", "Uniswap", official)).toBe(true);
  });

  it("accepts official domains and their subdomains", () => {
    expect(isLookalike("app.uniswap.org", "Uniswap", official)).toBe(false);
    expect(isLookalike("UNISWAP.ORG", "Uniswap", official)).toBe(false);
    expect(isLookalike("app.uniswap.org", "Uniswap", ["https://uniswap.org/"])).toBe(false);
  });

  it("accepts unrelated domains", () => {
    expect(isLookalike("deepbook.tech", "Raycash", ["raycash.xyz"])).toBe(false);
  });

  it("detects the subdomain attack uniswap.com.claim-airdrop.xyz", () => {
    expect(isLookalike("uniswap.com.claim-airdrop.xyz", "Uniswap", official)).toBe(true);
  });

  it("detects typos within edit distance 2", () => {
    expect(isLookalike("uniswqp.org", "Uniswap", official)).toBe(true);
  });

  it("handles short names strictly", () => {
    expect(isLookalike("chain.link", "Ink", ["ink.xyz"])).toBe(false);
    expect(isLookalike("ink-claim.xyz", "Ink", ["ink.xyz"])).toBe(true);
    expect(isLookalike("ink.claim.xyz", "Ink", ["ink.xyz"])).toBe(true);
    expect(isLookalike("pink.xyz", "Ink", ["ink.xyz"])).toBe(false);
  });

  it("detects a typo combined with an affix", () => {
    expect(isLookalike("uniswqp-airdrop.xyz", "Uniswap", official)).toBe(true);
    expect(isLookalike("claim-uniswa\u03c1.xyz", "Uniswap", official)).toBe(true);
  });

  it("folds extra confusables (Greek rho, dotless i, Cyrillic de, Latin script g)", () => {
    expect(isLookalike("uniswa\u03c1.xyz", "Uniswap", official)).toBe(true);
    expect(isLookalike("un\u0131swap.xyz", "Uniswap", official)).toBe(true);
    expect(isLookalike("\u0501ydx-claim.xyz", "Dydx", ["dydx.exchange"])).toBe(true);
    expect(isLookalike("\u0261rass-claim.xyz", "Grass", ["grass.io"])).toBe(true);
  });

  it("returns false for names shorter than 3 characters", () => {
    expect(isLookalike("zk-claim.xyz", "ZK", ["zk.xyz"])).toBe(false);
  });

  it("treats private suffix tenants as separate registrable domains", () => {
    expect(isLookalike("phish.vercel.app", "Uniswap", official)).toBe(false);
    expect(isLookalike("uniswap-claim.vercel.app", "Uniswap", official)).toBe(true);
  });
});

const ALL_CHECKS: CheckId[] = [
  "dangerous_asks",
  "phishing_list",
  "domain_age",
  "lookalike",
  "token_security",
  "contract_verified",
  "hack_history",
  "corroboration",
  "ai_review",
];

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    project: {
      name: "Uniswap",
      officialDomains: ["uniswap.org"],
      status: "live",
      tokenSymbol: "UNI",
      conflict: false,
      sourceCount: 3,
      hasOfficialSocial: true,
      lookalikeOf: null,
      lookalikeOfName: null,
      lookalikeOfDomains: [],
    },
    tasks: ["Swap on the app"],
    sourceAsks: [],
    linkDomains: [{ domain: "app.uniswap.org", kind: "app" }],
    domainAgeDays: { "app.uniswap.org": 2000 },
    phishingFlags: { "app.uniswap.org": false },
    token: { honeypot: false, ownerCanMintOrChangeBalance: false, maliciousCreator: false },
    contractVerified: true,
    hackCount: 0,
    ...overrides,
  };
}

describe("assessRisk", () => {
  it("is low when everything is clean", () => {
    const a = assessRisk(input({ aiFlags: { scam: [], contradictions: 0 } }));
    expect(a.level).toBe("low");
    expect(a.reasons).toEqual([]);
    expect(a.points).toBe(0);
    expect(a.checks.map((c) => c.id)).toEqual(ALL_CHECKS);
    expect(a.checks.every((c) => c.ran)).toBe(true);
  });

  it("a phishing-listed domain makes the level critical", () => {
    const a = assessRisk(input({ phishingFlags: { "app.uniswap.org": true } }));
    expect(a.level).toBe("critical");
    expect(a.reasons.map((r) => r.code)).toContain("phishing_listed");
    expect(a.reasons[0]?.message).toContain("app.uniswap.org");
    expect(a.points).toBeGreaterThanOrEqual(100);
  });

  it("a honeypot token is critical", () => {
    const a = assessRisk(
      input({ token: { honeypot: true, ownerCanMintOrChangeBalance: false, maliciousCreator: false } }),
    );
    expect(a.level).toBe("critical");
    expect(a.reasons.map((r) => r.code)).toContain("token_honeypot");
  });

  it("dangerous asks in tasks are critical", () => {
    const a = assessRisk(input({ tasks: ["Enter your seed phrase"] }));
    expect(a.level).toBe("critical");
    expect(a.reasons.map((r) => r.code)).toContain("asks_secret");
  });

  it("a young unofficial claim domain is high with new_claim_domain and young_domain", () => {
    const a = assessRisk(
      input({
        linkDomains: [
          { domain: "app.uniswap.org", kind: "app" },
          { domain: "claim-x.xyz", kind: "claim" },
        ],
        domainAgeDays: { "app.uniswap.org": 2000, "claim-x.xyz": 5 },
        phishingFlags: { "app.uniswap.org": false, "claim-x.xyz": false },
      }),
    );
    expect(a.level).toBe("high");
    const codes = a.reasons.map((r) => r.code);
    expect(codes).toContain("new_claim_domain");
    expect(codes).toContain("young_domain");
    expect(a.reasons.find((r) => r.code === "new_claim_domain")?.message).toContain("claim-x.xyz");
    expect(a.reasons.find((r) => r.code === "young_domain")?.message).toContain("5");
  });

  it("an official claim domain younger than 30 days is not new_claim_domain", () => {
    const a = assessRisk(
      input({
        linkDomains: [{ domain: "claim.uniswap.org", kind: "claim" }],
        domainAgeDays: { "claim.uniswap.org": 10 },
        phishingFlags: { "claim.uniswap.org": false },
      }),
    );
    const codes = a.reasons.map((r) => r.code);
    expect(codes).not.toContain("new_claim_domain");
    expect(codes).toContain("young_domain");
    expect(a.level).toBe("medium");
  });

  it("a claim domain aged 30-89 days is only young_domain", () => {
    const a = assessRisk(
      input({
        linkDomains: [{ domain: "claim-x.xyz", kind: "claim" }],
        domainAgeDays: { "claim-x.xyz": 45 },
        phishingFlags: { "claim-x.xyz": false },
      }),
    );
    expect(a.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["young_domain"]));
    expect(a.reasons.map((r) => r.code)).not.toContain("new_claim_domain");
  });

  it("emits one young_domain reason per distinct domain", () => {
    const a = assessRisk(
      input({
        linkDomains: [
          { domain: "a.example-one.xyz", kind: "website" },
          { domain: "b.example-one.xyz", kind: "docs" },
          { domain: "other-two.xyz", kind: "website" },
        ],
        domainAgeDays: { "a.example-one.xyz": 10, "b.example-one.xyz": 10, "other-two.xyz": 60 },
      }),
    );
    expect(a.reasons.filter((r) => r.code === "young_domain")).toHaveLength(2);
  });

  it("flags lookalike link domains as high", () => {
    const a = assessRisk(
      input({
        linkDomains: [{ domain: "claim-uniswap-airdrop.xyz", kind: "claim" }],
        domainAgeDays: { "claim-uniswap-airdrop.xyz": 400 },
        phishingFlags: { "claim-uniswap-airdrop.xyz": false },
      }),
    );
    expect(a.level).toBe("high");
    const l = a.reasons.filter((r) => r.code === "lookalike_domain");
    expect(l).toHaveLength(1);
    expect(l[0]?.message).toContain("claim-uniswap-airdrop.xyz");
  });

  it("emits one lookalike_domain and one phishing_listed per registrable domain", () => {
    const a = assessRisk(
      input({
        linkDomains: [
          { domain: "a.uniswap-claim.xyz", kind: "claim" },
          { domain: "b.uniswap-claim.xyz", kind: "app" },
        ],
        phishingFlags: { "a.uniswap-claim.xyz": true, "b.uniswap-claim.xyz": true },
      }),
    );
    expect(a.reasons.filter((r) => r.code === "lookalike_domain")).toHaveLength(1);
    expect(a.reasons.filter((r) => r.code === "phishing_listed")).toHaveLength(1);
  });

  it("ignores docs and social links for the lookalike check", () => {
    const a = assessRisk(
      input({
        linkDomains: [
          { domain: "uniswap.gitbook.io", kind: "docs" },
          { domain: "uniswap.substack.com", kind: "social" },
        ],
        domainAgeDays: {},
        phishingFlags: {},
      }),
    );
    expect(a.reasons.map((r) => r.code)).not.toContain("lookalike_domain");
  });

  it("skips link lookalike when there are no official domains, and the check did not run", () => {
    const base = input();
    const a = assessRisk(
      input({
        project: { ...base.project, officialDomains: [] },
        linkDomains: [{ domain: "app.uniswap.org", kind: "app" }],
      }),
    );
    expect(a.reasons.map((r) => r.code)).not.toContain("lookalike_domain");
    expect(a.checks.find((c) => c.id === "lookalike")?.ran).toBe(false);
  });

  it("still reports lookalikeOf without official domains, and the check ran", () => {
    const base = input();
    const a = assessRisk(
      input({ project: { ...base.project, officialDomains: [], lookalikeOf: "3f2a-uuid", lookalikeOfName: "Other" } }),
    );
    expect(a.reasons.map((r) => r.code)).toContain("lookalike_domain");
    expect(a.checks.find((c) => c.id === "lookalike")?.ran).toBe(true);
  });

  it("names the other project and its domains in the lookalikeOf reason, never its id", () => {
    const base = input();
    const a = assessRisk(
      input({
        project: {
          ...base.project,
          lookalikeOf: "0b6c5f3e-1d2a-4c1b-9f00-1234567890ab",
          lookalikeOfName: "DeepBook",
          lookalikeOfDomains: ["deepbook.tech"],
        },
      }),
    );
    expect(a.level).toBe("high");
    const l = a.reasons.filter((r) => r.code === "lookalike_domain");
    expect(l).toHaveLength(1);
    expect(l[0]?.message).toBe('Nama project ini sama dengan "DeepBook" (deepbook.tech) tapi domainnya beda.');
    expect(l[0]?.message).not.toContain("0b6c5f3e");
  });

  it("falls back to a generic wording when the other project's name is unknown", () => {
    const base = input();
    const a = assessRisk(
      input({ project: { ...base.project, lookalikeOf: "0b6c5f3e-1d2a-4c1b-9f00-1234567890ab" } }),
    );
    const l = a.reasons.filter((r) => r.code === "lookalike_domain");
    expect(l[0]?.message).toBe("Nama project ini sama dengan project lain tapi domainnya beda.");
  });

  it("source-text asks are critical with the quoted sentence", () => {
    const a = assessRisk(
      input({ sourceAsks: [{ code: "asks_secret", quote: "Enter your seed phrase to claim." }] }),
    );
    expect(a.level).toBe("critical");
    const r = a.reasons.filter((x) => x.code === "asks_secret");
    expect(r).toHaveLength(1);
    expect(r[0]?.message).toContain("Enter your seed phrase to claim.");
    expect(r[0]?.source).toBe("text");
  });

  it("does not duplicate an ask already found in the tasks, and ignores unknown codes", () => {
    const a = assessRisk(
      input({
        tasks: ["Send 0.1 ETH to receive your airdrop"],
        sourceAsks: [
          { code: "asks_payment", quote: "Send 0.1 ETH to receive your airdrop." },
          { code: "something_else", quote: "x" },
        ],
      }),
    );
    expect(a.reasons.map((r) => r.code)).toEqual(["asks_payment"]);
    expect(a.reasons[0]?.source).toBe("extraction");
  });

  it("flags token owner powers and malicious creator as high", () => {
    const a = assessRisk(
      input({ token: { honeypot: false, ownerCanMintOrChangeBalance: true, maliciousCreator: true } }),
    );
    expect(a.level).toBe("high");
    expect(a.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["token_owner_powers", "malicious_creator"]),
    );
  });

  it("maps medium rules", () => {
    const base = input();
    const a = assessRisk(
      input({
        project: { ...base.project, conflict: true, sourceCount: 1, hasOfficialSocial: false },
        contractVerified: false,
        hackCount: 2,
      }),
    );
    expect(a.level).toBe("medium");
    expect(a.reasons.map((r) => r.code).sort()).toEqual(
      ["conflicting_evidence", "hack_history", "single_source", "unverified_contract"].sort(),
    );
    expect(a.points).toBe(40);
    expect(a.reasons.find((r) => r.code === "hack_history")?.message).toContain("2");
  });

  it("speculative with 6 checks run is low", () => {
    const base = input();
    const a = assessRisk(
      input({
        project: { ...base.project, status: "speculative" },
        token: null,
        contractVerified: null,
      }),
    );
    expect(a.checks.filter((c) => c.ran)).toHaveLength(6);
    expect(a.reasons.map((r) => r.code)).toEqual(["speculative"]);
    expect(a.reasons[0]?.severity).toBe("info");
    expect(a.level).toBe("low");
  });

  it("no reasons and only 3 checks run is insufficient_data", () => {
    const a = assessRisk(
      input({
        linkDomains: [],
        domainAgeDays: {},
        phishingFlags: {},
        token: null,
        contractVerified: null,
        hackCount: null,
      }),
    );
    expect(a.checks.filter((c) => c.ran)).toHaveLength(3);
    expect(a.reasons).toEqual([]);
    expect(a.level).toBe("insufficient_data");
  });

  it("a critical reason beats insufficient data", () => {
    const a = assessRisk(
      input({
        tasks: ["Enter your seed phrase"],
        linkDomains: [],
        domainAgeDays: {},
        phishingFlags: {},
        token: null,
        contractVerified: null,
        hackCount: null,
      }),
    );
    expect(a.level).toBe("critical");
  });

  it("only info reasons with fewer than 4 checks run is insufficient_data", () => {
    const base = input();
    const a = assessRisk(
      input({
        project: { ...base.project, status: "speculative" },
        phishingFlags: {},
        domainAgeDays: {},
        token: null,
        contractVerified: null,
        hackCount: null,
      }),
    );
    expect(a.level).toBe("insufficient_data");
  });

  it("token_security is not run when token is null", () => {
    const a = assessRisk(input({ token: null, contractVerified: null }));
    expect(a.checks.find((c) => c.id === "token_security")?.ran).toBe(false);
    expect(a.checks.find((c) => c.id === "contract_verified")?.ran).toBe(false);
  });

  it("failed lookups (null values) do not count as ran", () => {
    const a = assessRisk(
      input({ phishingFlags: { "app.uniswap.org": null }, domainAgeDays: { "app.uniswap.org": null } }),
    );
    expect(a.checks.find((c) => c.id === "phishing_list")?.ran).toBe(false);
    expect(a.checks.find((c) => c.id === "domain_age")?.ran).toBe(false);
    expect(a.checks.find((c) => c.id === "hack_history")?.ran).toBe(true);
  });
});

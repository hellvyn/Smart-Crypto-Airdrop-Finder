// AI flags in assessRisk (curation spec §13 A2/A3): AI can only add reasons and raise the level, never lower anything.
import { describe, expect, it } from "vitest";
import {
  aiFlagsFromAnalyses,
  assessRisk,
  contradictionsSchema,
  postProcessContradictions,
  postProcessScam,
  scamSchema,
} from "../src/index.js";
import type { ContradictionsAnswer, RiskInput, ScamAnswer } from "../src/index.js";

type AiFlags = NonNullable<RiskInput["aiFlags"]>;

const lowRiskInput: RiskInput = {
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
};

/** A young unofficial claim domain: high (new_claim_domain) plus medium (young_domain). */
const highRiskInput: RiskInput = {
  ...lowRiskInput,
  linkDomains: [
    { domain: "app.uniswap.org", kind: "app" },
    { domain: "claim-x.xyz", kind: "claim" },
  ],
  domainAgeDays: { "app.uniswap.org": 2000, "claim-x.xyz": 5 },
  phishingFlags: { "app.uniswap.org": false, "claim-x.xyz": false },
};

const mediumRiskInput: RiskInput = {
  ...lowRiskInput,
  project: { ...lowRiskInput.project, conflict: true, sourceCount: 1, hasOfficialSocial: false },
  contractVerified: false,
  hackCount: 2,
};

const criticalRiskInput: RiskInput = { ...lowRiskInput, phishingFlags: { "app.uniswap.org": true } };

/** Only 3 checks run and nothing found. */
const insufficientInput: RiskInput = {
  ...lowRiskInput,
  linkDomains: [],
  domainAgeDays: {},
  phishingFlags: {},
  token: null,
  contractVerified: null,
  hackCount: null,
};

const speculativeInput: RiskInput = {
  ...lowRiskInput,
  project: { ...lowRiskInput.project, status: "speculative" },
  token: null,
  contractVerified: null,
};

const speculativeInsufficientInput: RiskInput = {
  ...insufficientInput,
  project: { ...lowRiskInput.project, status: "speculative" },
};

const criticalInsufficientInput: RiskInput = { ...insufficientInput, tasks: ["Enter your seed phrase"] };

const flag = (pattern: string, quote = "Claim now or lose it") => ({ pattern, quote });

describe("assessRisk with AI flags", () => {
  it("raises risk for an AI-detected secret request", () => {
    expect(
      assessRisk({ ...lowRiskInput, aiFlags: { scam: [{ pattern: "secret_request", quote: "q" }], contradictions: 0 } }).level,
    ).toBe("high");
  });

  it("never lowers risk whatever the AI returns", () => {
    const base = assessRisk(highRiskInput);
    const withAi = assessRisk({ ...highRiskInput, aiFlags: { scam: [], contradictions: 0 } });
    expect(withAi.level).toBe(base.level);
    expect(withAi.points).toBeGreaterThanOrEqual(base.points);
    expect(withAi.reasons).toEqual(expect.arrayContaining(base.reasons));
  });

  it.each([
    ["secret_request", "high", 30],
    ["payment_request", "high", 30],
    ["urgency", "medium", 10],
    ["connect_wallet_to_check", "medium", 10],
    ["fake_support", "medium", 10],
    ["impersonation", "medium", 10],
    ["other", "medium", 10],
  ])("adds an ai_scam_pattern reason for %s with severity %s", (pattern, severity, points) => {
    const a = assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag(pattern)], contradictions: 0 } });

    expect(a.reasons).toEqual([expect.objectContaining({ code: "ai_scam_pattern", severity, source: "ai" })]);
    expect(a.level).toBe(severity);
    expect(a.points).toBe(points);
  });

  it("never puts the scam quote in the public reason", () => {
    const quote = "DM our admin @ink_support_help to claim";
    const a = assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag("fake_support", quote)], contradictions: 0 } });

    expect(a.reasons[0]?.message).not.toContain("ink_support_help");
    expect(a.reasons[0]?.message).not.toContain(quote);
  });

  it("gives a different message to each pattern", () => {
    const patterns = ["urgency", "connect_wallet_to_check", "fake_support", "secret_request", "payment_request", "impersonation", "other"];
    const messages = patterns.map(
      (p) => assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag(p)], contradictions: 0 } }).reasons[0]?.message,
    );

    expect(new Set(messages).size).toBe(patterns.length);
  });

  it("adds one reason per distinct pattern", () => {
    const a = assessRisk({
      ...lowRiskInput,
      aiFlags: { scam: [flag("urgency", "Only 2 hours left"), flag("urgency", "Hurry"), flag("payment_request", "Send 0.1 ETH")], contradictions: 0 },
    });

    expect(a.reasons.map((r) => [r.code, r.severity])).toEqual([
      ["ai_scam_pattern", "medium"],
      ["ai_scam_pattern", "high"],
    ]);
    expect(a.points).toBe(40);
  });

  it("treats an unknown pattern as other, at medium", () => {
    const unknown = assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag("totally_safe")], contradictions: 0 } });
    const other = assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag("other")], contradictions: 0 } });

    expect(unknown.reasons).toEqual(other.reasons);
  });

  it("ignores a scam flag without a quote", () => {
    const a = assessRisk({ ...lowRiskInput, aiFlags: { scam: [flag("secret_request", "  ")], contradictions: 0 } });

    expect(a.reasons).toEqual([]);
    expect(a.level).toBe("low");
  });

  it("adds one medium ai_contradiction reason when the AI found contradictions", () => {
    const a = assessRisk({ ...lowRiskInput, aiFlags: { scam: [], contradictions: 3 } });

    expect(a.reasons).toEqual([expect.objectContaining({ code: "ai_contradiction", severity: "medium", source: "ai" })]);
    expect(a.reasons[0]?.message).toContain("3");
    expect(a.level).toBe("medium");
    expect(a.points).toBe(10);
  });

  it("adds no ai_contradiction reason for zero contradictions", () => {
    expect(assessRisk({ ...lowRiskInput, aiFlags: { scam: [], contradictions: 0 } }).reasons).toEqual([]);
  });

  it("applies contradictions even without a scam analysis", () => {
    const a = assessRisk({ ...lowRiskInput, aiFlags: { scam: null, contradictions: 1 } });

    expect(a.reasons.map((r) => r.code)).toEqual(["ai_contradiction"]);
  });

  describe("the ai_review check", () => {
    const aiReview = (i: RiskInput) => assessRisk(i).checks.find((c) => c.id === "ai_review");

    it("ran when a scam analysis exists, even one that found nothing", () => {
      expect(aiReview({ ...lowRiskInput, aiFlags: { scam: [], contradictions: 0 } })).toEqual({ id: "ai_review", ran: true });
    });

    it("did not run without AI flags or without a scam analysis", () => {
      expect(aiReview(lowRiskInput)).toEqual({ id: "ai_review", ran: false });
      expect(aiReview({ ...lowRiskInput, aiFlags: { scam: null, contradictions: 2 } })).toEqual({ id: "ai_review", ran: false });
    });

    it("does not count toward the checks needed to leave insufficient_data", () => {
      const a = assessRisk({ ...insufficientInput, aiFlags: { scam: [], contradictions: 0 } });

      expect(a.checks.filter((c) => c.ran)).toHaveLength(4);
      expect(a.level).toBe("insufficient_data");
    });
  });

  it("keeps insufficient_data when the AI adds only a medium reason", () => {
    const a = assessRisk({ ...insufficientInput, aiFlags: { scam: [flag("urgency")], contradictions: 2 } });

    expect(a.level).toBe("insufficient_data");
    expect(a.reasons.map((r) => r.code)).toEqual(["ai_scam_pattern", "ai_contradiction"]);
  });

  it("raises insufficient_data to high for a high AI reason", () => {
    expect(assessRisk({ ...insufficientInput, aiFlags: { scam: [flag("secret_request")], contradictions: 0 } }).level).toBe("high");
  });

  it("keeps a critical level critical", () => {
    expect(assessRisk({ ...criticalRiskInput, aiFlags: { scam: [flag("payment_request")], contradictions: 4 } }).level).toBe("critical");
  });

  describe("asymmetry over every base input and AI answer", () => {
    /** How strongly a level warns, for this rule: insufficient_data fails curation like high does, so only high beats it. */
    const STRICTNESS: Record<string, number> = { low: 0, medium: 1, insufficient_data: 2, high: 3, critical: 4 };
    const bases: [string, RiskInput][] = [
      ["low", lowRiskInput],
      ["medium", mediumRiskInput],
      ["high", highRiskInput],
      ["critical", criticalRiskInput],
      ["insufficient_data", insufficientInput],
      ["speculative low", speculativeInput],
      ["speculative insufficient_data", speculativeInsufficientInput],
      ["critical with few checks", criticalInsufficientInput],
    ];
    const answers: [string, AiFlags][] = [
      ["nothing found", { scam: [], contradictions: 0 }],
      ["no scam analysis", { scam: null, contradictions: 0 }],
      ["negative contradictions", { scam: [], contradictions: -5 }],
      ["not a number", { scam: [], contradictions: Number.NaN }],
      ["one contradiction", { scam: [], contradictions: 1 }],
      ["urgency", { scam: [flag("urgency")], contradictions: 0 }],
      ["secret request", { scam: [flag("secret_request")], contradictions: 0 }],
      ["unknown pattern", { scam: [flag("safe_project_verified")], contradictions: 0 }],
      ["blank quote", { scam: [flag("payment_request", "")], contradictions: 0 }],
      [
        "everything",
        {
          scam: ["urgency", "connect_wallet_to_check", "fake_support", "secret_request", "payment_request", "impersonation", "other"].map((p) =>
            flag(p),
          ),
          contradictions: 9,
        },
      ],
    ];

    for (const [baseName, baseInput] of bases) {
      it.each(answers)(`${baseName}: %s never lowers the level, points or reasons`, (_answer, aiFlags) => {
        const base = assessRisk(baseInput);
        const withAi = assessRisk({ ...baseInput, aiFlags });

        expect(STRICTNESS[withAi.level]).toBeGreaterThanOrEqual(STRICTNESS[base.level] ?? Infinity);
        expect(withAi.points).toBeGreaterThanOrEqual(base.points);
        expect(withAi.reasons.slice(0, base.reasons.length)).toEqual(base.reasons);
        expect(withAi.reasons.slice(base.reasons.length).every((r) => r.source === "ai")).toBe(true);
        expect(withAi.checks.filter((c) => c.id !== "ai_review")).toEqual(base.checks.filter((c) => c.id !== "ai_review"));
      });
    }

    it("covers each level as a base", () => {
      expect(new Set(bases.map(([, i]) => assessRisk(i).level))).toEqual(new Set(Object.keys(STRICTNESS)));
    });
  });
});

const PAGE = "https://claim.ink.test/";
const PAGE_TEXT =
  "Ink airdrop claim is live! Only 2 hours left, claim now or lose it. " +
  "To verify your wallet, enter your 12-word recovery phrase below. Support: DM @ink_admin_help.";
const POST = "https://airdrops.io/ink/";
const POST_TEXT = "Ink airdrop: total allocation is 5% of supply. Claim opens on December 1.";

describe("scamSchema", () => {
  const valid: ScamAnswer = { flags: [{ pattern: "urgency", quote: "Only 2 hours left", explanation: "Kamu didesak buru-buru." }] };

  it("accepts flags of the known patterns, and no flags at all", () => {
    expect(scamSchema.safeParse(valid).success).toBe(true);
    expect(scamSchema.safeParse({ flags: [] }).success).toBe(true);
  });

  it("rejects an unknown pattern, so the next model is tried", () => {
    expect(scamSchema.safeParse({ flags: [{ ...valid.flags[0], pattern: "safe" }] }).success).toBe(false);
  });

  it("rejects an answer without flags", () => {
    expect(scamSchema.safeParse({ verdict: "aman" }).success).toBe(false);
  });
});

describe("postProcessScam", () => {
  const sources = [
    { url: POST, text: POST_TEXT },
    { url: PAGE, text: PAGE_TEXT },
  ];

  it("drops scam flags whose quote is not in the source text", () => {
    const result = postProcessScam(
      {
        flags: [
          { pattern: "secret_request", quote: "enter your 12-word  RECOVERY phrase", explanation: "Minta seed phrase." },
          { pattern: "payment_request", quote: "send 0.1 ETH to claim", explanation: "Minta bayar." },
          { pattern: "urgency", quote: "", explanation: "Desakan waktu." },
        ],
      },
      sources,
    );

    expect(result.flags.map((f) => f.pattern)).toEqual(["secret_request"]);
  });

  it("keeps a flag quoted from any source and replaces em dashes in the explanation only", () => {
    const result = postProcessScam(
      { flags: [{ pattern: "fake_support", quote: "Support: DM @ink_admin_help.", explanation: "Admin palsu — jangan DM." }] },
      sources,
    );

    expect(result).toEqual({
      flags: [{ pattern: "fake_support", quote: "Support: DM @ink_admin_help.", explanation: "Admin palsu, jangan DM." }],
    });
  });
});

describe("contradictionsSchema and postProcessContradictions", () => {
  const SECOND = "https://t.me/ink_news/7";
  const SECOND_TEXT = "Ink airdrop: allocation is 3% of supply, claim opens December 1.";
  const sources = [
    { url: POST, text: POST_TEXT },
    { url: SECOND, text: SECOND_TEXT },
  ];
  const item: ContradictionsAnswer["items"][number] = {
    topic: "Alokasi — total",
    quote_a: "total allocation is 5% of supply",
    url_a: POST,
    quote_b: "allocation is 3% of supply",
    url_b: SECOND,
    explanation: "Sumber pertama bilang 5% — sumber kedua 3%.",
  };

  it("accepts a contradiction with two quotes and their urls", () => {
    expect(contradictionsSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(contradictionsSchema.safeParse({ items: [{ ...item, url_b: undefined }] }).success).toBe(false);
  });

  it("keeps a contradiction whose two quotes are each in the source they name, without em dashes in its prose", () => {
    expect(postProcessContradictions({ items: [item] }, sources)).toEqual({
      items: [{ ...item, topic: "Alokasi, total", explanation: "Sumber pertama bilang 5%, sumber kedua 3%." }],
    });
  });

  it.each([
    ["quote a is not in its source", { quote_a: "allocation is 10% of supply" }],
    ["quote b is in another source than the one it names", { quote_b: "total allocation is 5% of supply" }],
    ["a url is not one of the sources", { url_a: "https://elsewhere.test/" }],
    ["both sides are the same quote of the same source", { quote_b: "total allocation is 5% of supply", url_b: POST }],
  ])("drops a contradiction when %s", (_why, patch) => {
    expect(postProcessContradictions({ items: [{ ...item, ...patch }] }, sources)).toEqual({ items: [] });
  });

  it("keeps a contradiction within one source (two different quotes)", () => {
    const within = { ...item, quote_b: "Claim opens on December 1", url_b: POST };
    expect(postProcessContradictions({ items: [within] }, sources).items).toHaveLength(1);
  });
});

describe("aiFlagsFromAnalyses", () => {
  const scam: ScamAnswer = {
    flags: [
      { pattern: "urgency", quote: "Only 2 hours left", explanation: "Desakan." },
      { pattern: "secret_request", quote: "enter your 12-word recovery phrase", explanation: "Seed phrase." },
    ],
  };
  const contradictions = { items: [1, 2].map((n) => ({ topic: `t${n}`, quote_a: "a", url_a: POST, quote_b: "b", url_b: POST, explanation: "e" })) };

  it("takes the scam flags' patterns and quotes and counts the contradictions", () => {
    expect(aiFlagsFromAnalyses(scam, contradictions)).toEqual({
      scam: [
        { pattern: "urgency", quote: "Only 2 hours left" },
        { pattern: "secret_request", quote: "enter your 12-word recovery phrase" },
      ],
      contradictions: 2,
    });
  });

  it("is undefined when neither analysis exists", () => {
    expect(aiFlagsFromAnalyses(null, null)).toBeUndefined();
  });

  it("marks a missing or unreadable scam analysis as null and still counts contradictions", () => {
    expect(aiFlagsFromAnalyses(null, contradictions)).toEqual({ scam: null, contradictions: 2 });
    expect(aiFlagsFromAnalyses({ verdict: "aman" }, contradictions)).toEqual({ scam: null, contradictions: 2 });
  });

  it("counts no contradictions without a readable contradictions analysis", () => {
    expect(aiFlagsFromAnalyses(scam, null)).toEqual({ scam: expect.any(Array), contradictions: 0 });
    expect(aiFlagsFromAnalyses(scam, { items: "none" })).toEqual({ scam: expect.any(Array), contradictions: 0 });
  });
});

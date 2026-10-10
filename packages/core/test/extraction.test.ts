import { describe, expect, it } from "vitest";
import { extractionSchema, quoteInSource } from "../src/index.js";

const project = {
  name: "Ink",
  token_symbol: null,
  chains: ["ink"],
  status: "live",
  status_evidence: "Claim is open now",
  tasks: ["Bridge ETH"],
  deadlines: [{ kind: "claim", date: "2026-12-15", precision: "exact", text: "Dec 15, 2026" }],
  official_urls: ["https://inkonchain.com"],
  confidence: 0.8,
};

describe("extractionSchema", () => {
  it("accepts a non-airdrop result with no projects", () => {
    expect(extractionSchema.safeParse({ is_airdrop_content: false, projects: [] }).success).toBe(true);
  });

  it("accepts a full project", () => {
    expect(extractionSchema.safeParse({ is_airdrop_content: true, projects: [project] }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = extractionSchema.safeParse({
      is_airdrop_content: true,
      projects: [{ ...project, status: "maybe" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a deadline date that is not a real calendar date", () => {
    for (const date of ["2026-13-01", "2026-02-30", "2026-1-01", "Dec 15"]) {
      const r = extractionSchema.safeParse({
        is_airdrop_content: true,
        projects: [{ ...project, deadlines: [{ kind: "claim", date, precision: "exact", text: "x" }] }],
      });
      expect(r.success, date).toBe(false);
    }
  });

  it("accepts a null deadline date and a leap day", () => {
    for (const date of [null, "2028-02-29"]) {
      const r = extractionSchema.safeParse({
        is_airdrop_content: true,
        projects: [{ ...project, deadlines: [{ kind: "tge", date, precision: "quarter", text: "Q1" }] }],
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects an empty name and out-of-range confidence", () => {
    expect(
      extractionSchema.safeParse({ is_airdrop_content: true, projects: [{ ...project, name: "" }] }).success,
    ).toBe(false);
    for (const confidence of [-0.1, 1.1]) {
      expect(
        extractionSchema.safeParse({ is_airdrop_content: true, projects: [{ ...project, confidence }] }).success,
      ).toBe(false);
    }
    for (const confidence of [0, 1]) {
      expect(
        extractionSchema.safeParse({ is_airdrop_content: true, projects: [{ ...project, confidence }] }).success,
      ).toBe(true);
    }
  });

  it("strips unknown extra keys instead of failing", () => {
    const r = extractionSchema.safeParse({
      is_airdrop_content: true,
      extra: 1,
      projects: [{ ...project, bonus: "x" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("extra");
      expect(r.data.projects[0]).not.toHaveProperty("bonus");
    }
  });
});

/** A project as a v2 prompt (2026-10-10.2) returned it: none of the v3 fields. */
const minimalV2Project = project;

function withProject(over: Record<string, unknown>) {
  return { is_airdrop_content: true, projects: [{ ...minimalV2Project, ...over }] };
}

function withSteps(steps: unknown[]) {
  return withProject({ steps });
}

function withLatest(latest_update: unknown) {
  return withProject({ latest_update });
}

describe("extractionSchema v3 fields", () => {
  it("accepts v3 fields and defaults missing ones", () => {
    const p = extractionSchema.parse({ is_airdrop_content: true, projects: [minimalV2Project] }).projects[0]!;
    expect(p.steps).toEqual([]);
    expect(p.key_parameters).toEqual([]);
    expect(p.source_ratings).toEqual([]);
    expect(p.claimed_backers).toEqual([]);
    expect(p.capital_required).toBe("unknown");
    expect(p.latest_update).toBeNull();
    expect(p.capital_min_usd).toBeNull();
  });

  it("keeps every v3 field of a full answer", () => {
    const v3 = {
      steps: [
        { text: "Bridge ETH to Ink", cadence: "once" },
        { text: "Check in on the dashboard", cadence: "daily" },
        { text: "Vote in the weekly poll", cadence: "weekly" },
      ],
      key_parameters: [
        { name: "allocation", value: "5%", quote: "5% of total supply" },
        { name: "distribution", value: "claim", quote: "claim on the portal" },
        { name: "tge", value: "Q4 2026", quote: "TGE in Q4 2026" },
      ],
      source_ratings: [
        { name: "difficulty", value: "Easy", quote: "Difficulty: Easy" },
        { name: "cost", value: "Medium", quote: "Cost to earn: Medium" },
      ],
      latest_update: { text: "Season 2 is live", date: "2026-10-01" },
      claimed_backers: [{ investor: "Paradigm", quote: "backed by Paradigm" }],
      capital_required: "high",
      capital_min_usd: 1000,
    };
    const p = extractionSchema.parse(withProject(v3)).projects[0]!;
    expect(p).toMatchObject(v3);
  });

  it.each([
    ["tasks", []],
    ["steps", []],
    ["key_parameters", []],
    ["source_ratings", []],
    ["latest_update", null],
    ["claimed_backers", []],
    ["capital_required", "unknown"],
    ["capital_min_usd", null],
  ])("treats an explicit null %s as the default", (field, expected) => {
    const p = extractionSchema.parse(withProject({ [field]: null })).projects[0]!;
    expect(p[field as keyof typeof p]).toEqual(expected);
  });

  it.each([
    ["tasks", "bridge"],
    ["steps", "bridge"],
    ["key_parameters", {}],
    ["source_ratings", 0],
    ["latest_update", "Season 2 is live"],
    ["claimed_backers", false],
    ["capital_required", 0],
    ["capital_min_usd", "1000"],
  ])("still rejects a non-null %s of the wrong type", (field, value) => {
    expect(extractionSchema.safeParse(withProject({ [field]: value })).success).toBe(false);
  });

  it("parses a project without tasks to an empty task list", () => {
    const { tasks: _tasks, ...noTasks } = minimalV2Project;
    const p = extractionSchema.parse({ is_airdrop_content: true, projects: [noTasks] }).projects[0]!;
    expect(p.tasks).toEqual([]);
  });

  it("rejects an unknown cadence and an invalid latest_update date", () => {
    expect(() => extractionSchema.parse(withSteps([{ text: "x", cadence: "hourly" }]))).toThrow();
    expect(() => extractionSchema.parse(withLatest({ text: "x", date: "2026-02-30" }))).toThrow();
    expect(() => extractionSchema.parse(withLatest({ text: "x", date: "Oct 1" }))).toThrow();
  });

  it("accepts a latest_update without a date", () => {
    const p = extractionSchema.parse(withLatest({ text: "x", date: null })).projects[0]!;
    expect(p.latest_update).toEqual({ text: "x", date: null });
  });

  it("rejects unknown names in key_parameters and source_ratings", () => {
    expect(() =>
      extractionSchema.parse(withProject({ key_parameters: [{ name: "price", value: "1", quote: "q" }] })),
    ).toThrow();
    expect(() =>
      extractionSchema.parse(withProject({ source_ratings: [{ name: "fun", value: "High", quote: "q" }] })),
    ).toThrow();
  });

  it("rejects an unknown capital_required level", () => {
    expect(() => extractionSchema.parse(withProject({ capital_required: "medium" }))).toThrow();
  });

  it("accepts only a positive capital_min_usd or null", () => {
    for (const capital_min_usd of [0, -5, Infinity, Number.NaN]) {
      expect(extractionSchema.safeParse(withProject({ capital_min_usd })).success, String(capital_min_usd)).toBe(false);
    }
    for (const capital_min_usd of [0.5, 1000, null]) {
      expect(extractionSchema.safeParse(withProject({ capital_min_usd })).success, String(capital_min_usd)).toBe(true);
    }
  });
});

describe("quoteInSource", () => {
  it("matches quotes ignoring whitespace runs and case", () => {
    expect(
      quoteInSource("Grant/Community  Airdrop allocation of 5%", "...grant/community airdrop allocation of 5% of total"),
    ).toBe(true);
    expect(quoteInSource("allocation of 10%", "allocation of 5%")).toBe(false);
  });

  it("matches across a line break in the source", () => {
    expect(quoteInSource("backed by Paradigm and a16z", "Ink is backed by Paradigm\n  and a16z.")).toBe(true);
  });

  it("ignores whitespace at the ends of the quote", () => {
    expect(quoteInSource("  Difficulty: Easy \n", "Overview Difficulty: Easy Cost")).toBe(true);
  });

  it("never matches an empty or whitespace-only quote", () => {
    expect(quoteInSource("", "any text")).toBe(false);
    expect(quoteInSource(" \t\n", "any text")).toBe(false);
  });
});

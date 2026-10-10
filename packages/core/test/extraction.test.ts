import { describe, expect, it } from "vitest";
import { extractionSchema } from "../src/index.js";

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

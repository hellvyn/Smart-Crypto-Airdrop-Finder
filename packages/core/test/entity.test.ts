import { describe, expect, it } from "vitest";
import { decideMerge, normalizeName } from "../src/index.js";

describe("normalizeName", () => {
  it("collapses variants of the same project", () => {
    expect(normalizeName("$INK")).toBe("ink");
    expect(normalizeName("Ink Chain")).toBe("ink");
    expect(normalizeName("INK")).toBe("ink");
  });

  it("drops stop words", () => {
    expect(normalizeName("Jumper Exchange")).toBe("jumper");
    for (const w of ["airdrop", "chain", "network", "protocol", "labs", "finance", "exchange"]) {
      expect(normalizeName(`Foo ${w}`)).toBe("foo");
    }
  });

  it("removes emoji and punctuation", () => {
    expect(normalizeName("Arcus 🏹")).toBe("arcus");
    expect(normalizeName("Deep-Book!")).toBe("deepbook");
  });

  it("joins remaining tokens without a separator", () => {
    expect(normalizeName("Axis Robotics")).toBe("axisrobotics");
  });

  it("applies NFKC", () => {
    expect(normalizeName("ＩＮＫ")).toBe("ink");
  });

  it("only drops tokens that exactly equal a stop word", () => {
    expect(normalizeName("Chainlink")).toBe("chainlink");
  });

  it("keeps tokens when only stop words are present", () => {
    expect(normalizeName("Exchange")).toBe("exchange");
    expect(normalizeName("Airdrop Network")).toBe("airdropnetwork");
  });

  it("keeps non-latin letters and digits", () => {
    expect(normalizeName("Zeta 2")).toBe("zeta2");
    expect(normalizeName("Уни")).toBe("уни");
  });
});

describe("decideMerge", () => {
  const p1 = { id: "p1", nameKey: "deepbook", domains: ["deepbook.tech"] };

  it("merges when domains intersect", () => {
    expect(decideMerge({ nameKey: "deepbook", domains: ["deepbook.tech"] }, [p1])).toEqual({
      action: "merge",
      projectId: "p1",
    });
  });

  it("creates with lookalikeOf when name matches but domains differ", () => {
    expect(decideMerge({ nameKey: "deepbook", domains: ["deepbook-claim.xyz"] }, [p1])).toEqual({
      action: "create",
      lookalikeOf: "p1",
    });
  });

  it("merges when incoming has no domains", () => {
    expect(decideMerge({ nameKey: "deepbook", domains: [] }, [p1])).toEqual({
      action: "merge",
      projectId: "p1",
    });
  });

  it("creates with null lookalike when no candidate matches", () => {
    expect(decideMerge({ nameKey: "deepbook", domains: ["a.com"] }, [])).toEqual({
      action: "create",
      lookalikeOf: null,
    });
    expect(
      decideMerge({ nameKey: "deepbook", domains: ["a.com"] }, [{ id: "x", nameKey: "other", domains: ["a.com"] }]),
    ).toEqual({ action: "create", lookalikeOf: null });
  });

  it("prefers a domain-intersecting candidate over an earlier name match", () => {
    const a = { id: "a", nameKey: "ink", domains: ["fake.xyz"] };
    const b = { id: "b", nameKey: "ink", domains: ["inkonchain.com"] };
    expect(decideMerge({ nameKey: "ink", domains: ["inkonchain.com"] }, [a, b])).toEqual({
      action: "merge",
      projectId: "b",
    });
  });

  it("merges into the first match with empty domains when no domain intersects", () => {
    const a = { id: "a", nameKey: "ink", domains: ["fake.xyz"] };
    const b = { id: "b", nameKey: "ink", domains: [] };
    expect(decideMerge({ nameKey: "ink", domains: ["inkonchain.com"] }, [a, b])).toEqual({
      action: "merge",
      projectId: "b",
    });
  });

  it("with empty incoming domains merges into the first match", () => {
    const a = { id: "a", nameKey: "ink", domains: ["x.com"] };
    const b = { id: "b", nameKey: "ink", domains: ["y.com"] };
    expect(decideMerge({ nameKey: "ink", domains: [] }, [a, b])).toEqual({ action: "merge", projectId: "a" });
  });

  it("lookalikeOf points at the first name match", () => {
    const a = { id: "a", nameKey: "ink", domains: ["x.com"] };
    const b = { id: "b", nameKey: "ink", domains: ["y.com"] };
    expect(decideMerge({ nameKey: "ink", domains: ["z.com"] }, [a, b])).toEqual({
      action: "create",
      lookalikeOf: "a",
    });
  });
});

// Claim link checks (curation spec §15.2, #42): the status of each claim/app link, and the risk a phishing one adds.
import { describe, expect, it } from "vitest";
import { assessRisk, classifyLink } from "../src/index.js";
import type { RiskInput } from "../src/index.js";

describe("classifyLink", () => {
  it("classifies claim links against the official domain", () => {
    expect(classifyLink("https://claim.arcus.xyz/", ["arcus.xyz"], false)).toBe("official");
    expect(classifyLink("https://arcus-claim.io/", ["arcus.xyz"], false)).toBe("different_domain");
    expect(classifyLink("https://arcus-claim.io/", ["arcus.xyz"], true)).toBe("phishing");
    expect(classifyLink("https://arcus-claim.io/", ["arcus.xyz"], null)).toBe("unchecked");
  });

  it("calls the official domain itself and any of its subdomains official", () => {
    expect(classifyLink("https://arcus.xyz/claim", ["arcus.xyz"], false)).toBe("official");
    expect(classifyLink("https://app.claim.arcus.xyz/", ["other.io", "arcus.xyz"], false)).toBe("official");
    expect(classifyLink("https://CLAIM.Arcus.XYZ/", ["arcus.xyz"], false)).toBe("official");
  });

  it("never calls a domain official because it contains the official domain as text", () => {
    expect(classifyLink("https://arcus.xyz.claim-now.io/", ["arcus.xyz"], false)).toBe("different_domain");
    expect(classifyLink("https://notarcus.xyz/", ["arcus.xyz"], false)).toBe("different_domain");
    expect(classifyLink("https://claim-arcus.xyz/", ["arcus.xyz"], false)).toBe("different_domain");
    expect(classifyLink("https://evil.io/?next=https://arcus.xyz", ["arcus.xyz"], false)).toBe("different_domain");
  });

  it("calls a link phishing even when it is on the official domain", () => {
    expect(classifyLink("https://claim.arcus.xyz/", ["arcus.xyz"], true)).toBe("phishing");
  });

  it("calls a link on the official domain unchecked when the phishing check did not answer", () => {
    expect(classifyLink("https://claim.arcus.xyz/", ["arcus.xyz"], null)).toBe("unchecked");
  });

  it("never calls a link official for a project without official domains", () => {
    expect(classifyLink("https://claim.arcus.xyz/", [], false)).toBe("different_domain");
  });

  it("never calls a link without a registrable domain official", () => {
    expect(classifyLink("https://127.0.0.1/claim", ["127.0.0.1"], false)).toBe("different_domain");
    expect(classifyLink("not a url", ["arcus.xyz"], false)).toBe("different_domain");
    expect(classifyLink("javascript:alert(1)//arcus.xyz", ["arcus.xyz"], false)).toBe("different_domain");
  });
});

const input: RiskInput = {
  project: {
    name: "Arcus",
    officialDomains: ["arcus.xyz"],
    status: "live",
    tokenSymbol: null,
    conflict: false,
    sourceCount: 3,
    hasOfficialSocial: true,
    lookalikeOf: null,
    lookalikeOfName: null,
    lookalikeOfDomains: [],
  },
  tasks: ["Bridge to Arcus"],
  sourceAsks: [],
  linkDomains: [{ domain: "arcus.xyz", kind: "website" }],
  domainAgeDays: { "arcus.xyz": 2000 },
  phishingFlags: { "arcus.xyz": false },
  token: null,
  contractVerified: null,
  hackCount: 0,
};

describe("assessRisk with claim links", () => {
  it("raises risk to high when a claim link is phishing", () => {
    expect(assessRisk(input).level).toBe("low");
    expect(assessRisk({ ...input, claimLinks: [{ url: "https://x-claim.io", status: "phishing" }] }).level).toBe("high");
  });

  it("adds one phishing_claim_link reason that names no URL or domain", () => {
    const a = assessRisk({
      ...input,
      claimLinks: [
        { url: "https://x-claim.io/a", status: "phishing" },
        { url: "https://y-claim.io/b", status: "phishing" },
        { url: "https://claim.arcus.xyz/", status: "official" },
      ],
    });
    const reasons = a.reasons.filter((r) => r.code === "phishing_claim_link");
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.severity).toBe("high");
    expect(reasons[0]?.source).toBe("goplus");
    expect(reasons[0]?.message).toBe("2 link claim project ini kedeteksi phishing dan di-hide.");
    expect(reasons[0]?.message).not.toMatch(/claim\.io|https?:/);
  });

  it("adds nothing for official, different-domain or unchecked claim links", () => {
    const a = assessRisk({
      ...input,
      claimLinks: [
        { url: "https://claim.arcus.xyz/", status: "official" },
        { url: "https://arcus-claim.io/", status: "different_domain" },
        { url: "https://other-claim.io/", status: "unchecked" },
      ],
    });
    expect(a).toEqual(assessRisk(input));
  });

  it("never lowers a critical level", () => {
    const critical: RiskInput = { ...input, phishingFlags: { "arcus.xyz": true } };
    expect(assessRisk({ ...critical, claimLinks: [{ url: "https://x-claim.io", status: "phishing" }] }).level).toBe("critical");
  });
});

import { describe, expect, it } from "vitest";
import { renderDigestEmail } from "../src/index.js";
import type { Digest, DigestProject } from "../src/index.js";

const proj = (over: Partial<DigestProject> = {}): DigestProject => ({
  id: "p1",
  slug: "alpha",
  name: "Alpha",
  status: "live",
  riskLevel: "low",
  firstSeen: new Date("2026-09-01T00:00:00Z"),
  ...over,
});
const opts = { siteUrl: "https://saf.example", unsubscribeUrl: "https://saf.example/unsubscribe?t=abc&x=1" };
const empty: Digest = { deadlinesSoon: [], changes: [], newProjects: [], priority: 2 };
const dl = (over: Partial<Digest["deadlinesSoon"][number]> = {}): Digest["deadlinesSoon"][number] => ({
  project: proj(),
  kind: "claim",
  date: "2026-10-11",
  precision: "exact",
  isToday: false,
  ...over,
});

describe("renderDigestEmail", () => {
  it("subject counts deadlines, singular and plural", () => {
    const two = renderDigestEmail({ ...empty, deadlinesSoon: [dl(), dl({ project: proj({ slug: "b" }) })], priority: 0 }, opts);
    expect(two.subject).toBe("Airdrop digest: 2 deadlines in the next 48h");
    const one = renderDigestEmail({ ...empty, deadlinesSoon: [dl()], priority: 0 }, opts);
    expect(one.subject).toBe("Airdrop digest: 1 deadline in the next 48h");
  });

  it("uses the generic subject without deadlines", () => {
    const r = renderDigestEmail({ ...empty, newProjects: [proj()] }, opts);
    expect(r.subject).toBe("Airdrop digest: updates on your watchlist");
  });

  it("escapes scraped project names in html", () => {
    const evil = proj({ name: "<img src=x onerror=alert(1)>" });
    const r = renderDigestEmail({ ...empty, deadlinesSoon: [dl({ project: evil })], newProjects: [evil], priority: 0 }, opts);
    expect(r.html).toContain("&lt;img");
    expect(r.html).not.toContain("<img src=x");
  });

  it("escapes quotes in slugs inside attributes and builds links with encodeURIComponent", () => {
    const evil = proj({ slug: 'a"b\'c<d>&e' });
    const r = renderDigestEmail({ ...empty, newProjects: [evil] }, opts);
    const enc = encodeURIComponent(evil.slug);
    expect(r.text).toContain(`https://saf.example/projects/${enc}`);
    expect(r.html).toContain(`href="https://saf.example/projects/${enc.replaceAll("'", "&#39;")}"`);
    expect(r.html).not.toContain("'c<"); // no raw quote / angle bracket from the slug
    expect(r.html).not.toContain('a"b');
  });

  it("escapes &, <, >, \" and ' everywhere in interpolated values", () => {
    const p = proj({ name: `A&B <i> "q" 'a'` });
    const r = renderDigestEmail({ ...empty, newProjects: [p] }, opts);
    expect(r.html).toContain("A&amp;B &lt;i&gt; &quot;q&quot; &#39;a&#39;");
    expect(r.html).toContain("t=abc&amp;x=1");
  });

  it("strips trailing slashes from siteUrl", () => {
    const r = renderDigestEmail({ ...empty, newProjects: [proj()] }, { ...opts, siteUrl: "https://saf.example/" });
    expect(r.text).toContain("https://saf.example/projects/alpha");
    expect(r.text).not.toContain("example//projects");
    expect(r.html).not.toContain("example//projects");
  });

  it("only links to siteUrl and unsubscribeUrl, never scraped URLs", () => {
    const evil = proj({ name: "Click https://evil.example/x now" });
    const r = renderDigestEmail(
      { ...empty, deadlinesSoon: [dl({ project: evil })], changes: [{ project: evil, field: "status", oldValue: "live", newValue: "ended" }], newProjects: [evil], priority: 0 },
      opts,
    );
    for (const part of [r.text, r.html]) {
      const urls = part.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
      for (const u of urls) {
        const ok = u.startsWith("https://saf.example/projects/") || u.startsWith("https://saf.example/unsubscribe") || u.startsWith("https://evil.example/x");
        expect(ok).toBe(true);
      }
    }
    // the only href targets are ours
    const hrefs = [...r.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
    for (const h of hrefs) {
      expect(h.startsWith("https://saf.example/projects/") || h.startsWith("https://saf.example/unsubscribe")).toBe(true);
    }
    expect(r.html).not.toMatch(/<script|<img|src=/i);
  });

  it("includes the unsubscribe footer in both parts", () => {
    const r = renderDigestEmail({ ...empty, newProjects: [proj()] }, opts);
    expect(r.text).toContain(`You get this email because daily digest is on. Unsubscribe: ${opts.unsubscribeUrl}`);
    expect(r.html).toContain("You get this email because daily digest is on.");
    expect(r.html).toContain('href="https://saf.example/unsubscribe?t=abc&amp;x=1"');
  });

  it("writes today, approximate prefix, and kind labels", () => {
    const r = renderDigestEmail(
      {
        ...empty,
        priority: 0,
        deadlinesSoon: [
          dl({ isToday: true, date: "2026-10-10" }),
          dl({ precision: "approximate", kind: "campaign_end", project: proj({ slug: "b", name: "Beta" }) }),
          dl({ kind: "withdraw_funds", project: proj({ slug: "c", name: "Gamma" }) }),
          dl({ kind: "snapshot", project: proj({ slug: "d", name: "Delta" }) }),
        ],
      },
      opts,
    );
    expect(r.text).toContain("Deadlines in the next 48 hours");
    expect(r.text).toContain("today");
    expect(r.text).toContain("around 2026-10-11");
    expect(r.text).toContain("Campaign end");
    expect(r.text).toContain("Withdraw funds");
    expect(r.text).toContain("Snapshot");
    expect(r.text).toContain("Claim");
    expect(r.html).toContain("around 2026-10-11");
    expect(r.html).toContain("today");
    expect(r.text).not.toContain("around today");
  });

  it("renders changes with web labels", () => {
    const r = renderDigestEmail(
      {
        ...empty,
        priority: 1,
        changes: [
          { project: proj(), field: "status", oldValue: "speculative", newValue: "live" },
          { project: proj({ slug: "b", name: "Beta" }), field: "risk_level", oldValue: null, newValue: "insufficient_data" },
          { project: proj({ slug: "c", name: "Gamma" }), field: "status", oldValue: null, newValue: "unknown" },
          { project: proj({ slug: "d", name: "Delta" }), field: "risk_level", oldValue: "medium", newValue: "critical" },
        ],
      },
      opts,
    );
    expect(r.text).toContain("Status and risk changes");
    expect(r.text).toContain("Alpha: status Speculative → Live");
    expect(r.text).toContain("Beta: risk Not assessed → Insufficient data");
    expect(r.text).toContain("Gamma: status Unconfirmed → Unconfirmed");
    expect(r.text).toContain("Delta: risk Medium → Critical");
    expect(r.html).toContain("Alpha</a>: status Speculative → Live");
  });

  it("renders new airdrops with status and risk labels", () => {
    const r = renderDigestEmail(
      { ...empty, newProjects: [proj({ status: "announced", riskLevel: null }), proj({ slug: "h", name: "Hi", status: "unknown", riskLevel: "high" })] },
      opts,
    );
    expect(r.text).toContain("New airdrops today");
    expect(r.text).toContain("Announced");
    expect(r.text).toContain("Not assessed");
    expect(r.text).toContain("Unconfirmed");
    expect(r.text).toContain("High");
  });

  it("omits empty sections", () => {
    const r = renderDigestEmail({ ...empty, newProjects: [proj()] }, opts);
    expect(r.text).not.toContain("Deadlines in the next 48 hours");
    expect(r.text).not.toContain("Status and risk changes");
    expect(r.html).not.toContain("Deadlines in the next 48 hours");
  });

  it('never uses the words "safe" or "eligible" at any risk level', () => {
    const levels = ["low", "medium", "high", "critical", "insufficient_data", null] as const;
    const statuses = ["live", "announced", "speculative", "ended", "unknown"] as const;
    const projects = levels.map((l, i) => proj({ slug: `p${i}`, name: `P${i}`, riskLevel: l, status: statuses[i % 5]! }));
    const d: Digest = {
      priority: 0,
      deadlinesSoon: projects.map((p) => dl({ project: p, kind: "claim" })),
      changes: levels.map((l, i) => ({ project: projects[i]!, field: "risk_level" as const, oldValue: l, newValue: levels[(i + 1) % 6] ?? "low" })),
      newProjects: projects,
    };
    const r = renderDigestEmail(d, opts);
    for (const s of [r.subject, r.text, r.html]) expect(s).not.toMatch(/safe|eligible/i);
  });
});

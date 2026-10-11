import { describe, expect, it } from "vitest";
import { briefingBanned, briefingInputs, fallbackBriefing, validateBriefing } from "../src/index.js";
import type { BriefingFact } from "../src/index.js";

const P1 = { projectId: "p-1", slug: "alpha", name: "Alpha" };
const P2 = { projectId: "p-2", slug: "beta", name: "Beta" };

describe("briefingInputs", () => {
  it("makes one fact for each newly curated project, status change, risk raise and near deadline", () => {
    const facts = briefingInputs(
      [
        { ...P1, field: "status", oldValue: "announced", newValue: "live" },
        { ...P2, field: "risk_level", oldValue: "low", newValue: "high" },
      ],
      [{ ...P1, kind: "claim", date: "2026-10-12" }],
      [{ projectId: "p-3", slug: "gamma", name: "Gamma" }],
    );
    expect(facts.map((f) => [f.projectId, f.slug, f.name, f.kind]).sort()).toEqual([
      ["p-1", "alpha", "Alpha", "deadline"],
      ["p-1", "alpha", "Alpha", "status"],
      ["p-2", "beta", "Beta", "risk"],
      ["p-3", "gamma", "Gamma", "curated"],
    ]);
    const text = (kind: string): string => facts.find((f) => f.kind === kind)?.text ?? "";
    expect(text("status")).toBe("Alpha berubah status jadi Live.");
    expect(text("risk")).toBe("Risiko Beta naik jadi Tinggi.");
    expect(text("curated")).toBe("Gamma baru masuk list.");
    expect(text("deadline")).toBe("Claim Alpha ditutup 12 Oktober 2026.");
  });

  it("ignores a risk level that did not go up, a first assessment and a row that is not a status or risk change", () => {
    const facts = briefingInputs(
      [
        { ...P1, field: "risk_level", oldValue: "high", newValue: "low" },
        { ...P1, field: "risk_level", oldValue: "medium", newValue: "medium" },
        { ...P2, field: "risk_level", oldValue: null, newValue: "high" },
        { ...P2, field: "risk_level", oldValue: "low", newValue: "insufficient_data" },
        { ...P2, field: "curated", oldValue: null, newValue: "true" },
      ],
      [],
      [],
    );
    expect(facts).toEqual([]);
  });

  it("keeps one fact for the same deadline from two documents and drops deadline kinds it does not report", () => {
    const facts = briefingInputs(
      [],
      [
        { ...P1, kind: "snapshot", date: "2026-10-13" },
        { ...P1, kind: "snapshot", date: "2026-10-13" },
        { ...P1, kind: "tge", date: "2026-10-13" },
      ],
      [],
    );
    expect(facts.map((f) => f.text)).toEqual(["Snapshot Alpha 13 Oktober 2026."]);
  });

  it("puts risk raises first, then deadlines by date, then status changes, then newly curated", () => {
    const facts = briefingInputs(
      [
        { ...P1, field: "status", oldValue: null, newValue: "live" },
        { ...P2, field: "risk_level", oldValue: "low", newValue: "critical" },
      ],
      [
        { ...P1, kind: "campaign_end", date: "2026-10-13" },
        { ...P2, kind: "claim", date: "2026-10-12" },
      ],
      [{ projectId: "p-3", slug: "gamma", name: "Gamma" }],
    );
    expect(facts.map((f) => f.kind)).toEqual(["risk", "deadline", "deadline", "status", "curated"]);
    expect(facts[1]?.text).toContain("12 Oktober");
  });
});

const FACTS: BriefingFact[] = [
  { projectId: "p-1", slug: "alpha", name: "Alpha", kind: "status", text: "Alpha berubah status jadi Live." },
  { projectId: "p-1", slug: "alpha", name: "Alpha", kind: "deadline", text: "Claim Alpha ditutup 12 Oktober 2026." },
  { projectId: "p-2", slug: "beta", name: "Beta", kind: "risk", text: "Risiko Beta naik jadi Tinggi." },
];

describe("validateBriefing", () => {
  it("keeps an item that names a fact's project and only restates it, with slug and name from the fact", () => {
    const items = validateBriefing(
      { items: [{ project_id: "p-2", text: "Risiko Beta naik jadi Tinggi, cek lagi sebelum lanjut." }] },
      FACTS,
    );
    expect(items).toEqual([
      { projectId: "p-2", slug: "beta", name: "Beta", text: "Risiko Beta naik jadi Tinggi, cek lagi sebelum lanjut." },
    ]);
  });

  it("drops an item for a project that is not in the facts", () => {
    expect(validateBriefing({ items: [{ project_id: "p-9", text: "Ada kabar baru." }] }, FACTS)).toEqual([]);
  });

  it("drops an item with a number, link or address the facts do not have", () => {
    const answer = {
      items: [
        { project_id: "p-1", text: "Claim Alpha ditutup 20 Oktober 2026." },
        { project_id: "p-2", text: "Beta lagi ramai, buka beta-claim.xyz." },
      ],
    };
    expect(validateBriefing(answer, FACTS)).toEqual([]);
  });

  it("grounds an item against all the facts of its project", () => {
    const items = validateBriefing(
      { items: [{ project_id: "p-1", text: "Alpha udah Live dan claim-nya ditutup 12 Oktober 2026." }] },
      FACTS,
    );
    expect(items).toHaveLength(1);
  });

  it("replaces an em dash and drops an item that uses a banned word", () => {
    const items = validateBriefing(
      {
        items: [
          { project_id: "p-1", text: "Alpha udah Live — buruan cek." },
          { project_id: "p-2", text: "Risiko Beta naik jadi Tinggi, ini krusial." },
        ],
      },
      FACTS,
    );
    expect(items.map((i) => i.text)).toEqual(["Alpha udah Live, buruan cek."]);
  });

  it("keeps one item per project and at most 5", () => {
    const many: BriefingFact[] = Array.from({ length: 8 }, (_, i) => ({
      projectId: `q-${i}`,
      slug: `q${i}`,
      name: `Q${i}`,
      kind: "curated" as const,
      text: `Q${i} baru masuk list.`,
    }));
    const answer = {
      items: [
        ...many.map((f) => ({ project_id: f.projectId, text: f.text })),
        { project_id: "q-0", text: "Q0 baru masuk list." },
      ],
    };
    const items = validateBriefing(answer, many);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.projectId)).size).toBe(5);
  });
});

describe("briefingBanned", () => {
  it("lists the banned words the answer's items use", () => {
    expect(
      briefingBanned({
        items: [
          { project_id: "p-1", text: "Ini krusial." },
          { project_id: "p-2", text: "Aman dan seamless." },
        ],
      }),
    ).toEqual(["krusial", "seamless", "aman"]);
    expect(briefingBanned({ items: [{ project_id: "p-1", text: "Alpha udah Live." }] })).toEqual([]);
  });
});

describe("fallbackBriefing", () => {
  it("uses the fact texts as they are, at most 5", () => {
    expect(fallbackBriefing(FACTS)).toEqual(
      FACTS.map((f) => ({ projectId: f.projectId, slug: f.slug, name: f.name, text: f.text })),
    );
    const many = Array.from({ length: 9 }, (_, i) => ({ ...FACTS[0]!, projectId: `x-${i}` }));
    expect(fallbackBriefing(many)).toHaveLength(5);
  });
});

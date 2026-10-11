// What the risk checks looked at (#53), as scoreProjects stores it. "Source" on the project page means a distinct
// source (documents.source_key): one Telegram channel with many messages is one source.
import { describe, expect, it } from "vitest";
import type { Http } from "../src/collectors/types.js";
import { defaultConfig } from "../src/config.js";
import { emptyStats } from "../src/stats.js";
import { scoreProjects } from "../src/steps/score.js";
import { MemoryRepo } from "../src/store/memory-repo.js";

const NOW = new Date("2026-10-10T00:00:00Z");
/** No links, so the only request is DefiLlama's hack list (empty). */
const http: Http = { get: async () => ({ status: 200, body: "[]" }), resolveRedirect: async (url: string) => url } as unknown as Http;

describe("scoreProjects check details", () => {
  it("counts one Telegram channel with 30 messages and one airdrops.io page as 2 sources", async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject(
      { slug: "ink", name: "Ink", nameKey: "ink", tokenSymbol: null, chains: [], officialDomains: [], status: "live", conflict: false, lookalikeOf: null },
      NOW,
    );
    const docs = [
      ...Array.from({ length: 30 }, (_, i) => ({ sourceKind: "telegram" as const, sourceKey: "telegram:airdrops_io", url: `https://t.me/airdrops_io/${i}` })),
      { sourceKind: "airdrops_io" as const, sourceKey: "airdrops_io:latest", url: "https://airdrops.io/ink/" },
    ];
    for (const d of docs) {
      const stored = await repo.upsertDocument({ ...d, text: "Ink airdrop is live", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW }, d.url);
      await repo.addEvidence({ projectId: p.id, documentId: stored.id, field: "status", value: "live", quote: "Ink airdrop is live", at: NOW });
    }

    await scoreProjects({ repo, http, now: () => NOW, sleep: async () => {} }, defaultConfig, NOW, emptyStats());

    const checks = repo.riskAssessments.at(-1)?.checks ?? [];
    expect(checks.find((c) => c.id === "dangerous_asks")?.detail).toEqual({ sources: 2 });
    expect(checks.find((c) => c.id === "corroboration")?.detail).toEqual({ sources: 2 });
  });
});

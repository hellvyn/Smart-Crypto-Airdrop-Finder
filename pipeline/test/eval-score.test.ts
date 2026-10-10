import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@saf/core";
import { evaluatePass, scoreCase } from "../eval/score.js";
import type { GroundTruth } from "../eval/score.js";

const truth = JSON.parse(readFileSync(new URL("../eval/ground-truth.json", import.meta.url), "utf8")) as GroundTruth;

type Project = ExtractionResult["projects"][number];

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: "Abstract",
    token_symbol: null,
    chains: [],
    status: "ended",
    status_evidence: "",
    tasks: [],
    deadlines: [],
    official_urls: [],
    confidence: 0.9,
    ...overrides,
  };
}

function result(projects: Project[], isAirdrop = true): ExtractionResult {
  return { is_airdrop_content: isAirdrop, projects };
}

describe("scoreCase", () => {
  it("fails the status check when Abstract is answered as speculative", () => {
    const score = scoreCase("aio_abstract", result([project({ status: "speculative" })]), truth, "");
    expect(score.statusOk).toBe(false);
  });

  it("passes the status check when Abstract is answered as ended", () => {
    const score = scoreCase("aio_abstract", result([project()]), truth, "");
    expect(score.statusOk).toBe(true);
    expect(score.tokenOk).toBe(true);
    expect(score.chainOk).toBe(true);
  });

  it("counts official URLs that are not in the case text", () => {
    const text = "Claim at https://abs.xyz/claim now";
    const score = scoreCase(
      "aio_abstract",
      result([project({ official_urls: ["https://abs.xyz/claim", "https://abstract-fake.xyz/"] })]),
      truth,
      text,
    );
    expect(score.hallucinatedUrls).toBe(1);
  });

  it("compares the token case-insensitively and ignores a leading $", () => {
    const ok = scoreCase(
      "aio_deepbook",
      result([project({ name: "DeepBook", token_symbol: "$deep", status: "live", chains: ["Sui"] })]),
      truth,
      "",
    );
    expect(ok.statusOk).toBe(true);
    expect(ok.tokenOk).toBe(true);
    expect(ok.chainOk).toBe(true);

    const bad = scoreCase(
      "aio_deepbook",
      result([project({ name: "DeepBook", token_symbol: "DBK", status: "live", chains: ["Ethereum"] })]),
      truth,
      "",
    );
    expect(bad.tokenOk).toBe(false);
    expect(bad.chainOk).toBe(false);
  });

  it("scores a missing extraction as failed", () => {
    const score = scoreCase("aio_deepbook", null, truth, "");
    expect(score.statusOk).toBe(false);
    expect(score.tokenOk).toBe(false);
    expect(score.chainOk).toBe(false);
    expect(score.hallucinatedUrls).toBe(0);
  });

  it("matches the Ink variants and prefers the project with the expected status", () => {
    const score = scoreCase(
      "tg_ink",
      result([
        project({ name: "Ink Chain", status: "live", token_symbol: "INK" }),
        project({ name: "$INK", status: "speculative", token_symbol: "INK" }),
      ]),
      truth,
      "",
    );
    expect(score.statusOk).toBe(true);
    expect(score.tokenOk).toBe(true);
  });

  it("does not score status for the negative and radar cases", () => {
    expect(scoreCase("tg_ledger_negative", result([], false), truth, "").statusOk).toBeNull();
    expect(scoreCase("tg_weekly_radar", result([]), truth, "").statusOk).toBeNull();
  });

  it("accepts the negative case only when the text is rejected", () => {
    expect(scoreCase("tg_ledger_negative", result([], false), truth, "").negativeOk).toBe(true);
    expect(scoreCase("tg_ledger_negative", result([project()], true), truth, "").negativeOk).toBe(false);
    expect(scoreCase("tg_ledger_negative", null, truth, "").negativeOk).toBe(false);
    expect(scoreCase("aio_abstract", result([project()]), truth, "").negativeOk).toBeNull();
  });

  it("counts radar recall as distinct expected slugs matched by an extracted project", () => {
    const names = ["Abstract", "Arcus", "Aster", "Ink", "Jumper", "Jumper Exchange", "Kryvora", "Unrelated Thing"];
    const score = scoreCase("tg_weekly_radar", result(names.map((name) => project({ name }))), truth, "");
    // abstract, arcus, aster, ink-chain, jumper-exchange, kryvora-network
    expect(score.radarRecall).toBe(6);
    expect(scoreCase("tg_weekly_radar", null, truth, "").radarRecall).toBe(0);
    expect(scoreCase("aio_abstract", result([project()]), truth, "").radarRecall).toBeNull();
  });

  it("keeps the radar threshold and all 28 slugs in the ground truth", () => {
    const radar = truth.cases["tg_weekly_radar"];
    expect(radar?.kind).toBe("radar");
    if (radar?.kind === "radar") {
      expect(radar.slugs).toHaveLength(28);
      expect(radar.minRecall).toBe(22);
    }
    expect(truth.baselineStatusAccuracy).toBe(5);
  });
});

describe("evaluatePass", () => {
  const ok = (caseId: string, over: Partial<ReturnType<typeof scoreCase>> = {}) => ({
    ...scoreCase(caseId, null, truth, ""),
    ...over,
  });

  it("fails when any condition fails and passes when all hold", () => {
    const good = [
      ok("aio_abstract", { statusOk: true }),
      ok("aio_deepbook", { statusOk: true }),
      ok("aio_variational", { statusOk: true }),
      ok("aio_raycash", { statusOk: true }),
      ok("tg_flop", { statusOk: true }),
      ok("tg_ink", { statusOk: false }),
      ok("tg_ledger_negative", { negativeOk: true }),
      ok("tg_weekly_radar", { radarRecall: 22 }),
    ];
    expect(evaluatePass(good, truth).every((c) => c.ok)).toBe(true);

    const hallucinating = good.map((s) => (s.caseId === "tg_flop" ? { ...s, hallucinatedUrls: 1 } : s));
    expect(evaluatePass(hallucinating, truth).some((c) => !c.ok)).toBe(true);
    const lowRecall = good.map((s) => (s.caseId === "tg_weekly_radar" ? { ...s, radarRecall: 21 } : s));
    expect(evaluatePass(lowRecall, truth).some((c) => !c.ok)).toBe(true);
    const lowStatus = good.map((s) => (s.caseId === "tg_flop" ? { ...s, statusOk: false } : s));
    expect(evaluatePass(lowStatus, truth).some((c) => !c.ok)).toBe(true);
  });
});

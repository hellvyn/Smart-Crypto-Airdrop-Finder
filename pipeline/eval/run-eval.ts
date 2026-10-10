import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractionResult } from "@saf/core";
import type { CollectedDocument } from "../src/collectors/types.js";
import { defaultConfig, loadProviders } from "../src/config.js";
import { extractWithFallback } from "../src/llm/extract.js";
import { modelKey, streamChat } from "../src/llm/nvidia.js";
import { PROMPT_VERSION } from "../src/llm/prompt.js";
import { evaluatePass, rawOfficialUrlsOfOutcome, scoreCase } from "./score.js";
import type { CaseScore, GroundTruth } from "./score.js";

const EVAL_DIR = fileURLToPath(new URL(".", import.meta.url));
const CASES_DIR = join(EVAL_DIR, "cases");

interface CaseMeta {
  source: string;
  published: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const cell = (value: unknown, width: number): string => String(value).padEnd(width);

async function run(): Promise<number> {
  const truth = JSON.parse(readFileSync(join(EVAL_DIR, "ground-truth.json"), "utf8")) as GroundTruth;

  const caseIds = existsSync(CASES_DIR)
    ? readdirSync(CASES_DIR)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => f.slice(0, -".txt".length))
        .sort()
    : [];
  if (caseIds.length === 0) {
    console.error(`No eval cases found in ${CASES_DIR}. See eval/README.md for how to fill it.`);
    return 2;
  }

  const providers = loadProviders(process.env);
  const models = defaultConfig.models;
  const chat = (model: Parameters<typeof streamChat>[0], messages: Parameters<typeof streamChat>[1]) =>
    streamChat(model, messages, { fetch, ...providers[model.provider] });

  if (providers.nvidia.apiKey === "" && process.env["NODE_USE_ENV_PROXY"] !== "1") {
    console.warn(
      "Notice: NVIDIA_API_KEY is empty and NODE_USE_ENV_PROXY is not 1. NVIDIA calls only work if the key is injected by a proxy; " +
        "in that case Node needs NODE_USE_ENV_PROXY=1 to use it. Continuing.",
    );
  }

  console.log(`Prompt version ${PROMPT_VERSION}; models: ${models.map(modelKey).join(" > ")}`);

  const scores: CaseScore[] = [];
  const rows: string[] = [];
  for (const id of caseIds) {
    const text = readFileSync(join(CASES_DIR, `${id}.txt`), "utf8");
    const metaPath = join(CASES_DIR, `${id}.meta.json`);
    const meta: CaseMeta = existsSync(metaPath)
      ? (JSON.parse(readFileSync(metaPath, "utf8")) as CaseMeta)
      : { source: `eval://${id}`, published: null };
    const now = new Date();
    const doc: CollectedDocument = {
      sourceKind: id.startsWith("tg_") ? "telegram" : "airdrops_io",
      sourceKey: id,
      url: meta.source,
      text,
      publishedAt: meta.published === null ? null : new Date(meta.published),
      pageUpdatedAt: null,
      fetchedAt: now,
    };

    const started = Date.now();
    const outcome = await extractWithFallback(doc, models, { chat, sleep });
    const result: ExtractionResult | null = outcome.ok ? outcome.result : null;
    const score = scoreCase(id, result, truth, text, rawOfficialUrlsOfOutcome(outcome.attempts));
    scores.push(score);

    const model = outcome.ok ? outcome.model : `FAILED (${outcome.attempts.map((a) => a.error).join(",")})`;
    const mark = (v: boolean | null): string => (v === null ? "-" : v ? "ok" : "FAIL");
    rows.push(
      [
        cell(id, 20),
        cell(mark(score.statusOk), 7),
        cell(mark(score.tokenOk), 7),
        cell(mark(score.chainOk), 7),
        cell(score.hallucinatedUrls, 7),
        cell(mark(score.negativeOk), 7),
        cell(score.radarRecall ?? "-", 7),
        cell(`${((Date.now() - started) / 1000).toFixed(1)}s`, 8),
        `${model} (${result?.projects.length ?? 0} projects)`,
      ].join(" "),
    );
    console.log(`done ${id}`);
  }

  console.log("");
  console.log(
    ["case".padEnd(20), "status ", "token  ", "chain  ", "halluc ", "negat  ", "recall ", "time    ", "model"].join(" "),
  );
  for (const row of rows) console.log(row);

  console.log("");
  const checks = evaluatePass(scores, truth);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  const passed = checks.every((c) => c.ok);
  console.log(passed ? "\nEval passed." : "\nEval FAILED.");
  return passed ? 0 : 1;
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);

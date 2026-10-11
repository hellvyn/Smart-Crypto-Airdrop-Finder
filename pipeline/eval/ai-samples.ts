import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { forbiddenPhrases } from "@saf/core";
import { z } from "zod";
import { latestPerProject, readProjects, serviceClientFromEnv } from "./supabase-read.js";

/** Git-ignored (`pipeline/eval/cases/`): the sample holds quotes of third-party texts, which never go into the repo. */
const OUT_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "cases", "ai-samples.md");
const SAMPLE_COUNT = 20;

/** One stored `analyst` analysis with the name of its project. */
export interface AnalystSample {
  projectId: string;
  projectName: string;
  /** ISO timestamp. */
  createdAt: string;
  model: string;
  servedModel: string | null;
  promptVersion: string;
  /** `ai_analyses.result`, not yet checked for shape. */
  result: unknown;
}

/** The part of a stored Analyst result the review reads. Lenient on purpose: post-processing may leave no points. */
const storedAnalyst = z.object({
  verdict: z.string(),
  confidence: z.string(),
  points: z.array(z.object({ text: z.string(), quote: z.string(), source_url: z.string() })),
  effort: z.object({ note: z.string() }).partial().optional(),
  steps_id: z.array(z.object({ text: z.string() })).optional(),
});

/** The newest analysis of each project, newest first, at most `n`. */
export function selectSamples(samples: readonly AnalystSample[], n: number): AnalystSample[] {
  const seen = new Set<string>();
  return [...samples]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((s) => (seen.has(s.projectId) ? false : (seen.add(s.projectId), true)))
    .slice(0, n);
}

/**
 * Markdown for the owner's review of AI Analyst output (G11: do the theses make sense? G13: is the Indonesian good?).
 * Each sample lists the verdict, the points with their source quotes, and the forbidden style phrases the Indonesian
 * text uses (quotes are source text and not checked).
 */
export function renderSamples(samples: readonly AnalystSample[]): string {
  const out: string[] = [
    "# Sampel AI Analyst untuk review owner",
    "",
    "Dinilai per sampel: apakah tesisnya masuk akal (G11) dan apakah Bahasa Indonesianya wajar (G13).",
    "",
  ];
  samples.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.projectName}`, "");
    out.push(`Model: ${s.servedModel ?? s.model} | prompt ${s.promptVersion} | ${s.createdAt}`, "");
    const parsed = storedAnalyst.safeParse(s.result);
    if (!parsed.success) {
      out.push("(bentuk hasil tidak dikenal, lewati)", "");
      return;
    }
    const a = parsed.data;
    out.push(`Verdict: ${a.verdict} (keyakinan ${a.confidence})`, "");
    if (a.points.length === 0) out.push("(tidak ada poin yang lolos kutipan)", "");
    a.points.forEach((p, j) => {
      out.push(`${j + 1}. ${p.text}`, `   - Kutipan: "${p.quote}"`, `   - Sumber: ${p.source_url}`);
    });
    if (a.points.length > 0) out.push("");
    if (a.effort?.note) out.push(`Effort: ${a.effort.note}`, "");
    const texts = [...a.points.map((p) => p.text), a.effort?.note ?? "", ...(a.steps_id ?? []).map((st) => st.text)];
    const found = [...new Set(texts.flatMap(forbiddenPhrases))];
    out.push(`Kata terlarang: ${found.length === 0 ? "tidak ada" : found.join(", ")}`, "");
    out.push("Penilaian owner: masuk akal [ ] ya [ ] tidak | Bahasa Indonesia [ ] baik [ ] perlu diperbaiki", "");
  });
  return out.join("\n");
}

async function main(): Promise<number> {
  const db = serviceClientFromEnv();
  if (db === null) {
    console.error("ai-samples needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    return 2;
  }
  type Row = {
    project_id: string;
    created_at: string;
    model: string;
    served_model: string | null;
    prompt_version: string;
    result: unknown;
  };
  const [rows, projects] = await Promise.all([
    latestPerProject<Row>(db, "ai_analyses", "project_id, created_at, model, served_model, prompt_version, result, seq", "created_at", {
      kind: "analyst",
    }),
    readProjects(db),
  ]);
  const samples = selectSamples(
    rows.flatMap((r) => {
      const project = projects.get(r.project_id);
      if (project === undefined) return [];
      return [
        {
          projectId: r.project_id,
          projectName: project.name,
          createdAt: r.created_at,
          model: r.model,
          servedModel: r.served_model,
          promptVersion: r.prompt_version,
          result: r.result,
        },
      ];
    }),
    SAMPLE_COUNT,
  );
  mkdirSync(join(OUT_PATH, ".."), { recursive: true });
  writeFileSync(OUT_PATH, `${renderSamples(samples)}\n`);
  // Counts and the path only: sample texts are never printed.
  console.log(`Wrote ${samples.length} AI Analyst samples to pipeline/eval/cases/ai-samples.md (need at least 20 for G11 and G13).`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}

import type { ModelConfig } from "./llm/nvidia.js";

export interface PipelineConfig {
  telegramChannels: string[];
  defillama: { minTvl: number; excludedCategories: string[]; limit: number; newWithinDays: number };
  /** Tried in order until one returns a valid extraction. */
  models: ModelConfig[];
  llmConcurrency: number;
  maxDocumentsPerRun: number;
  /**
   * Extraction time budget per run. After it no new LLM call starts; the remaining documents stay pending
   * (counted as `extract_deferred`), so merge, score and purge finish within the job's 60-minute limit.
   */
  extractBudgetMinutes: number;
  scoreActiveSinceDays: number;
  textRetentionDays: number;
}

/** Model fallback order (spec 4.3). `max_tokens` and `temperature` are set by `streamChat`. */
export const MODELS: ModelConfig[] = [
  // glm-5.3-flash first since 2026-10-10: in the first production run kimi-k3 timed out on every call
  // after 14:53 UTC while glm answered all 22 calls in 2-31 s.
  { id: "z-ai/glm-5.3-flash", extraBody: { reasoning_effort: "low" } },
  { id: "moonshotai/kimi-k3", extraBody: { chat_template_kwargs: { thinking: false } } },
  { id: "google/gemma-4-31b-it", extraBody: {} },
];

export const defaultConfig: PipelineConfig = {
  telegramChannels: ["airdrops_io"],
  defillama: { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180 },
  models: MODELS,
  llmConcurrency: 3,
  maxDocumentsPerRun: 150,
  extractBudgetMinutes: 35,
  scoreActiveSinceDays: 60,
  textRetentionDays: 90,
};

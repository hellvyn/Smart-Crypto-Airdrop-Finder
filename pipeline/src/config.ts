import type { ModelConfig } from "./llm/nvidia.js";

export interface PipelineConfig {
  telegramChannels: string[];
  defillama: { minTvl: number; excludedCategories: string[]; limit: number };
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

/** Model fallback order from the global constraints. `max_tokens` and `temperature` are set by `streamChat`. */
export const MODELS: ModelConfig[] = [
  { id: "moonshotai/kimi-k3", extraBody: { chat_template_kwargs: { thinking: false } } },
  { id: "z-ai/glm-5.3-flash", extraBody: { reasoning_effort: "low" } },
  { id: "google/gemma-4-31b-it", extraBody: {} },
];

export const defaultConfig: PipelineConfig = {
  telegramChannels: ["airdrops_io"],
  defillama: { minTvl: 10_000_000, excludedCategories: ["CEX"], limit: 50 },
  models: MODELS,
  llmConcurrency: 3,
  maxDocumentsPerRun: 150,
  extractBudgetMinutes: 35,
  scoreActiveSinceDays: 60,
  textRetentionDays: 90,
};

/** Number of sources a run collects from: airdrops.io, each Telegram channel, and DefiLlama. */
export function sourceCount(config: PipelineConfig): number {
  return 2 + config.telegramChannels.length;
}

import type { ModelConfig, ProviderId } from "./llm/nvidia.js";

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

/**
 * Model fallback order (curation spec decision #30). `max_tokens` and `temperature` are set by `streamChat`.
 * freellm `auto` routes each request to a free model; the NVIDIA models are the fallback, behind the circuit
 * breaker, for when the router is rate limited or down.
 */
export const MODELS: ModelConfig[] = [
  { provider: "freellm", id: "auto", extraBody: {} },
  // glm-5.3-flash first among the NVIDIA models since 2026-10-10: in the first production run kimi-k3 timed out
  // on every call after 14:53 UTC while glm answered all 22 calls in 2-31 s.
  { provider: "nvidia", id: "z-ai/glm-5.3-flash", extraBody: { reasoning_effort: "low" } },
  { provider: "nvidia", id: "moonshotai/kimi-k3", extraBody: { chat_template_kwargs: { thinking: false } } },
  { provider: "nvidia", id: "google/gemma-4-31b-it", extraBody: {} },
];

export interface ProviderConfig {
  /** Without a trailing slash; `/chat/completions` is appended. */
  baseUrl: string;
  /** Empty means no `Authorization` header. */
  apiKey: string;
}

const FREELLM_DEFAULT_BASE_URL = "https://freellm.hellvyn.id/v1";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Endpoint and key per provider: freellm from `LLM_BASE_URL` (empty or unset: the default URL) and `LLM_API_KEY`,
 * NVIDIA from `NVIDIA_API_KEY`. A missing key is an empty string.
 */
export function loadProviders(env: Record<string, string | undefined>): Record<ProviderId, ProviderConfig> {
  const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, "");
  return {
    freellm: {
      baseUrl: withoutTrailingSlash(env.LLM_BASE_URL || FREELLM_DEFAULT_BASE_URL),
      apiKey: env.LLM_API_KEY ?? "",
    },
    nvidia: { baseUrl: NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY ?? "" },
  };
}

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

import type { ModelConfig, ProviderId } from "./llm/nvidia.js";

/** A VC whose portfolio page is cross-checked for `vc_backer` (curation spec §5.2). */
export interface VcConfig {
  id: string;
  name: string;
  /** Other names the VC goes by (a former name, a short form). */
  aliases: string[];
  tier: 1 | 2;
  portfolioUrl: string;
}

export interface PipelineConfig {
  telegramChannels: string[];
  defillama: { minTvl: number; excludedCategories: string[]; limit: number; newWithinDays: number };
  /**
   * AlphaDrops collector (curation spec §15.1): at most `maxDetails` detail pages per run, `delayMs` apart.
   * `intermediaryHosts` (exact host match) are never a project's domain: the collector drops a website link that
   * ends there, and extraction and merge refuse them as official URLs and domains (`isNonProjectHost`).
   */
  alphadrops: { enabled: boolean; maxDetails: number; delayMs: number; intermediaryHosts: string[] };
  /** Tried in order until one returns a valid extraction. */
  models: ModelConfig[];
  llmConcurrency: number;
  maxDocumentsPerRun: number;
  /**
   * Extraction time budget per run. After it no new LLM call starts; the remaining documents stay pending
   * (counted as `extract_deferred`), so merge, score and purge finish within the job's 60-minute limit.
   */
  extractBudgetMinutes: number;
  /**
   * GoPlus time budget, counted from the start of `score`: after it no new GoPlus request starts. With
   * `goplusMaxConsecutiveFailures` domains in a row without an answer, the rest are not asked either. Domains not
   * asked count as not run (`phishing_list_failed`, and `phishing_list_skipped`), so a slow or rate-limiting GoPlus
   * cannot keep the job from saving its risk assessments within the 60-minute limit.
   */
  goplusBudgetMinutes: number;
  goplusMaxConsecutiveFailures: number;
  /**
   * AI analysis budget per run, counted from the start of `analyze`: after it no new LLM call starts. At most
   * `maxAnalysesPerRun` analyses start per run. Analyses not started stay as they were (counted as
   * `ai_analyses_deferred`) and run on a later day; an unchanged input reuses the stored analysis without a call.
   */
  analyzeBudgetMinutes: number;
  maxAnalysesPerRun: number;
  scoreActiveSinceDays: number;
  textRetentionDays: number;
  /** VCs whose portfolio pages give verified `vc_backer` signals (`VC_LIST`). */
  vcs: VcConfig[];
}

/**
 * VC candidates of curation plan 5 Task 4 (tier 1 as the plan sets it). None of these pages could be fetched from
 * the development environment (every host refused by its proxy), so none is verified yet: run
 * `scripts/vc-portfolio-check.ts` where they are reachable and strike every VC whose page has no portfolio links in
 * its HTML or whose terms forbid reading it (docs/ops/pipeline.md, "Daftar VC"). An unreachable or link-less page
 * only leaves that VC "not checked" in a run; it never removes signals from the other VCs.
 */
export const VC_LIST: VcConfig[] = [
  { id: "a16z-crypto", name: "a16z crypto", aliases: ["a16z", "Andreessen Horowitz"], tier: 1, portfolioUrl: "https://a16zcrypto.com/portfolio/" },
  { id: "paradigm", name: "Paradigm", aliases: [], tier: 1, portfolioUrl: "https://www.paradigm.xyz/portfolio" },
  { id: "polychain", name: "Polychain Capital", aliases: ["Polychain"], tier: 1, portfolioUrl: "https://polychain.capital/portfolio" },
  { id: "pantera", name: "Pantera Capital", aliases: ["Pantera"], tier: 1, portfolioUrl: "https://panteracapital.com/portfolio/" },
  { id: "multicoin", name: "Multicoin Capital", aliases: ["Multicoin"], tier: 1, portfolioUrl: "https://multicoin.capital/portfolio/" },
  { id: "dragonfly", name: "Dragonfly", aliases: ["Dragonfly Capital"], tier: 1, portfolioUrl: "https://www.dragonfly.xyz/portfolio" },
  { id: "coinbase-ventures", name: "Coinbase Ventures", aliases: [], tier: 1, portfolioUrl: "https://www.coinbase.com/ventures" },
  { id: "yzi-labs", name: "YZi Labs", aliases: ["Binance Labs"], tier: 1, portfolioUrl: "https://www.yzilabs.com/portfolio" },
  { id: "framework", name: "Framework Ventures", aliases: ["Framework"], tier: 2, portfolioUrl: "https://framework.ventures/portfolio" },
  { id: "variant", name: "Variant", aliases: ["Variant Fund"], tier: 2, portfolioUrl: "https://variant.fund/portfolio/" },
  { id: "electric-capital", name: "Electric Capital", aliases: [], tier: 2, portfolioUrl: "https://www.electriccapital.com/portfolio" },
  { id: "hack-vc", name: "Hack VC", aliases: [], tier: 2, portfolioUrl: "https://hack.vc/portfolio" },
  { id: "placeholder", name: "Placeholder", aliases: ["Placeholder VC"], tier: 2, portfolioUrl: "https://www.placeholder.vc/portfolio" },
  { id: "delphi-ventures", name: "Delphi Ventures", aliases: ["Delphi Digital"], tier: 2, portfolioUrl: "https://delphiventures.io/" },
  { id: "jump-crypto", name: "Jump Crypto", aliases: ["Jump"], tier: 2, portfolioUrl: "https://jumpcrypto.com/portfolio/" },
];

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
  defillama: { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180 },
  alphadrops: {
    enabled: true,
    maxDetails: 80,
    delayMs: 1500,
    intermediaryHosts: ["s.kaito.ai", "linktr.ee", "galxe.com", "app.galxe.com", "zealy.io", "layer3.xyz", "bit.ly", "t.co"],
  },
  models: MODELS,
  llmConcurrency: 3,
  maxDocumentsPerRun: 150,
  extractBudgetMinutes: 35,
  goplusBudgetMinutes: 12,
  goplusMaxConsecutiveFailures: 5,
  analyzeBudgetMinutes: 10,
  maxAnalysesPerRun: 60,
  scoreActiveSinceDays: 60,
  textRetentionDays: 90,
  vcs: VC_LIST,
};

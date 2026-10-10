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
  email: EmailConfig;
}

/**
 * Daily digest settings. `enabled` = a Brevo API key is configured. Digest budget per UTC day =
 * floor(dailyLimit * (1 - reserveRatio)) minus digests already sent that day; the reserve is left for Supabase
 * Auth emails sent through the same provider.
 */
export interface EmailConfig {
  enabled: boolean;
  dailyLimit: number;
  reserveRatio: number;
  /** Absolute http(s) base URL of the web app, without trailing slash. Email links are built only from it. */
  siteUrl: string;
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
  // Brevo Free: 300 emails per day, 20% kept for auth emails.
  email: { enabled: false, dailyLimit: 300, reserveRatio: 0.2, siteUrl: "" },
};

export const DEFAULT_SENDER_NAME = "Smart Airdrop Finder";

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Parses `EMAIL_FROM`: `"Name <addr>"` or `"addr"` (name defaults to "Smart Airdrop Finder"). Null when invalid. */
export function parseEmailFrom(value: string): { name: string; email: string } | null {
  const trimmed = value.trim();
  const named = /^(.*?)\s*<([^<>]*)>$/.exec(trimmed);
  const rawName = named ? (named[1] ?? "").trim().replace(/^"(.*)"$/, "$1").trim() : "";
  const email = named ? (named[2] ?? "").trim() : trimmed;
  if (!ADDRESS.test(email)) return null;
  return { name: rawName === "" ? DEFAULT_SENDER_NAME : rawName, email };
}

/** Absolute http(s) URL without query or fragment, trailing slashes removed; null when invalid. */
function parseSiteUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.search !== "" || url.hash !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href.replace(/\/+$/, "");
}

export type EmailEnv =
  | { ok: true; email: EmailConfig; brevo: { apiKey: string; from: { name: string; email: string } } | null }
  | { ok: false };

/**
 * Reads the email settings from the environment. Without `BREVO_API_KEY` email is disabled. With it,
 * `EMAIL_FROM` and `SITE_URL` are required and must be valid; otherwise `{ ok: false }` (a config error).
 */
export function loadEmailEnv(env: Record<string, string | undefined>): EmailEnv {
  const apiKey = (env.BREVO_API_KEY ?? "").trim();
  if (apiKey === "") return { ok: true, email: { ...defaultConfig.email }, brevo: null };
  const from = parseEmailFrom(env.EMAIL_FROM ?? "");
  const siteUrl = parseSiteUrl(env.SITE_URL ?? "");
  if (from === null || siteUrl === null) return { ok: false };
  return { ok: true, email: { ...defaultConfig.email, enabled: true, siteUrl }, brevo: { apiKey, from } };
}

import type { ModelConfig } from "./nvidia.js";

export interface ProviderConfig {
  /** Without a trailing slash; `/chat/completions` is appended. */
  baseUrl: string;
  /** Empty means no `Authorization` header. */
  apiKey: string;
}

/** Endpoint and key of each provider. Anthropic is called through its SDK, which knows its own endpoint. */
export interface Providers {
  freellm: ProviderConfig;
  nvidia: ProviderConfig;
  /** Empty means no key: Claude models are left out of the chain (`usableModels`). */
  anthropic: { apiKey: string };
}

const FREELLM_DEFAULT_BASE_URL = "https://freellm.hellvyn.id/v1";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Endpoint and key per provider: freellm from `LLM_BASE_URL` (empty or unset: the default URL) and `LLM_API_KEY`,
 * NVIDIA from `NVIDIA_API_KEY`, Anthropic from `ANTHROPIC_API_KEY` (trimmed: a key pasted with a trailing newline
 * still works, and a blank one counts as no key). A missing key is an empty string.
 */
export function loadProviders(env: Record<string, string | undefined>): Providers {
  const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, "");
  return {
    freellm: {
      baseUrl: withoutTrailingSlash(env.LLM_BASE_URL || FREELLM_DEFAULT_BASE_URL),
      apiKey: env.LLM_API_KEY ?? "",
    },
    nvidia: { baseUrl: NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY ?? "" },
    anthropic: { apiKey: (env.ANTHROPIC_API_KEY ?? "").trim() },
  };
}

/**
 * `models` without the ones that cannot work with these keys: a Claude model needs `ANTHROPIC_API_KEY` (freellm and
 * NVIDIA can go without a key, e.g. behind a proxy that adds it). A model left out costs no request and no circuit
 * breaker failure.
 */
export function usableModels(models: ModelConfig[], providers: Providers): ModelConfig[] {
  return models.filter((m) => m.provider !== "anthropic" || providers.anthropic.apiKey !== "");
}

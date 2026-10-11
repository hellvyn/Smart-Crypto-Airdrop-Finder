import type { ModelConfig } from "./nvidia.js";

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

/**
 * Model order of the AI analyses (`analyze` stage): Claude Sonnet first, then the extraction chain unchanged.
 * Owner decision of 2026-10-11: the analyses use up a prepaid Claude API credit that expires on 2026-10-27. Any
 * Claude failure (no credit left, invalid key, rate limit after the retries, overload, timeout, refusal, cut-off or
 * unusable answer) moves on to freellm `auto` and NVIDIA as before. Without `ANTHROPIC_API_KEY` Claude is left out
 * (`usableModels`); removing this entry restores the old order. Thinking depth and output budget: `claudeChat`.
 */
export const ANALYZE_MODELS: ModelConfig[] = [{ provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} }, ...MODELS];

/** Model order of the farming coach chat (`streamText`): the same chain as the AI analyses, Claude Sonnet first. */
export const COACH_MODELS: ModelConfig[] = ANALYZE_MODELS;

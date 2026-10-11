import type { Providers } from "./providers.js";
import { claudeChat } from "./claude.js";
import type { ClaudeClient } from "./claude.js";
import { streamChat } from "./nvidia.js";
import type { ChatFn } from "./structured.js";

/**
 * The run's `ChatFn`: a Claude model goes to `claude` (the SDK client), every other model to its OpenAI-compatible
 * endpoint through `streamChat`. Without a Claude client (no `ANTHROPIC_API_KEY`) a Claude model fails at once with
 * `httpStatus: 0` and no request; `usableModels` normally keeps such a model out of the chain before that.
 */
export function createChat(providers: Providers, deps: { fetch: typeof fetch; claude: ClaudeClient | null }): ChatFn {
  return async (model, messages) => {
    if (model.provider === "anthropic") {
      if (deps.claude === null) return { content: "", finishReason: null, latencyMs: 0, httpStatus: 0, servedModel: null };
      return claudeChat(model, messages, { client: deps.claude, apiKey: providers.anthropic.apiKey });
    }
    return streamChat(model, messages, { fetch: deps.fetch, ...providers[model.provider] });
  };
}

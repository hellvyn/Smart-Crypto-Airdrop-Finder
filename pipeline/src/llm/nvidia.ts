/**
 * The providers the pipeline can call: the OpenAI-compatible endpoints freellm and NVIDIA (`streamChat`), and
 * Anthropic through its SDK (`claudeChat`). Base URLs and keys come from `loadProviders`.
 */
export type ProviderId = "freellm" | "nvidia" | "anthropic";

export interface ModelConfig {
  provider: ProviderId;
  /** Model name sent to the provider. */
  id: string;
  extraBody: Record<string, unknown>;
}

/** `"<provider>:<id>"`: how a model is stored in `extractions.model` and keyed in the circuit breaker. */
export function modelKey(model: ModelConfig): string {
  return `${model.provider}:${model.id}`;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatResult {
  content: string;
  finishReason: string | null;
  latencyMs: number;
  /** HTTP status of the response, or 0 when the request failed before or during the response. */
  httpStatus: number;
  /** Response body (max 500 chars) of a non-2xx response; absent otherwise. */
  errorBody?: string;
  /**
   * The model that actually answered: the `model` field of the first stream chunk that has one. A router such as
   * freellm `auto` picks a different model per request. Null when the request failed or no chunk named a model.
   */
  servedModel: string | null;
}

/**
 * Total time one request may take. Spike 3 saw slow reasoning streams near 320 s, but the daily job has a
 * 60-minute limit and a 35-minute extraction budget, so a stuck model is cut off after 3 minutes.
 */
export const REQUEST_TIMEOUT_MS = 180_000;
const ERROR_BODY_MAX_CHARS = 500;

interface StreamChunk {
  model?: unknown;
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
}

/**
 * Calls an OpenAI-compatible chat completions endpoint (freellm or NVIDIA) with `stream: true` and accumulates
 * the answer. Streaming is required: both providers return 502 after about 30 s on a non-streamed request.
 * An empty `apiKey` sends no `Authorization` header.
 * Never throws: network errors, timeouts and stream failures return `httpStatus: 0`.
 */
export async function streamChat(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: { fetch: typeof fetch; apiKey: string; baseUrl: string },
): Promise<ChatResult> {
  const started = Date.now();
  const failed = (httpStatus: number, errorBody?: string): ChatResult => {
    const result: ChatResult = {
      content: "",
      finishReason: null,
      latencyMs: Date.now() - started,
      httpStatus,
      servedModel: null,
    };
    if (errorBody !== undefined) result.errorBody = errorBody;
    return result;
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (deps.apiKey !== "") headers["Authorization"] = `Bearer ${deps.apiKey}`;

  const body = {
    model: model.id,
    messages,
    temperature: 0,
    max_tokens: 8192,
    stream: true,
    stream_options: { include_usage: true },
    ...model.extraBody,
  };

  try {
    const response = await deps.fetch(`${deps.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      let text = "";
      try {
        text = await response.text();
      } catch {
        // An unreadable error body is not worth failing over.
      }
      return failed(response.status, text.slice(0, ERROR_BODY_MAX_CHARS));
    }
    if (!response.body) return failed(0);

    // The SSE response carries no charset, so always decode as UTF-8.
    const decoder = new TextDecoder("utf-8");
    const reader = response.body.getReader();
    let content = "";
    let finishReason: string | null = null;
    let servedModel: string | null = null;
    let buffer = "";
    let done = false;

    const handleLine = (rawLine: string): void => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        return;
      }
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        return;
      }
      if (servedModel === null && typeof chunk.model === "string" && chunk.model !== "") servedModel = chunk.model;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const piece = choice.delta?.content;
      if (typeof piece === "string") content += piece;
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    };

    while (!done) {
      const { value, done: streamEnded } = await reader.read();
      if (streamEnded) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1 && !done) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    if (!done) {
      buffer += decoder.decode();
      if (buffer !== "") handleLine(buffer);
    } else {
      await reader.cancel().catch(() => {});
    }

    return { content, finishReason, latencyMs: Date.now() - started, httpStatus: response.status, servedModel };
  } catch {
    return failed(0);
  }
}

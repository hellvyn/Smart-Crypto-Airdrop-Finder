export interface ModelConfig {
  id: string;
  extraBody: Record<string, unknown>;
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
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const REQUEST_TIMEOUT_MS = 300_000;
const ERROR_BODY_MAX_CHARS = 500;

interface StreamChunk {
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
}

/**
 * Calls the NVIDIA chat completions endpoint with `stream: true` and accumulates the answer.
 * Never throws: network errors, timeouts and stream failures return `httpStatus: 0`.
 */
export async function streamChat(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: { fetch: typeof fetch; apiKey: string; baseUrl?: string },
): Promise<ChatResult> {
  const started = Date.now();
  const failed = (httpStatus: number, errorBody?: string): ChatResult => {
    const result: ChatResult = { content: "", finishReason: null, latencyMs: Date.now() - started, httpStatus };
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
    const response = await deps.fetch(`${deps.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`, {
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

    return { content, finishReason, latencyMs: Date.now() - started, httpStatus: response.status };
  } catch {
    return failed(0);
  }
}

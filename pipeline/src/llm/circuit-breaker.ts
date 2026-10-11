/**
 * Per-run circuit breaker for LLM models. A model that fails `threshold` times in a row (timeouts, 5xx, rate
 * limits that outlast their retries) is skipped for the rest of the run, so a degraded endpoint costs a few
 * timeouts instead of one per document. Any HTTP 200 reply counts as a success: the model is reachable, and
 * an unparsable answer depends on the document, not on the endpoint. Once open, a circuit stays open.
 * Callers key circuits by `"<provider>:<id>"` (see `modelKey`), so the same model id on two providers is two circuits.
 */
export interface CircuitBreaker {
  isOpen(modelId: string): boolean;
  recordSuccess(modelId: string): void;
  recordFailure(modelId: string): void;
  /** Models whose circuit opened during this run, in the order they opened. */
  opened(): string[];
}

export function createCircuitBreaker(threshold: number): CircuitBreaker {
  const failures = new Map<string, number>();
  const open: string[] = [];
  return {
    isOpen: (modelId) => open.includes(modelId),
    recordSuccess: (modelId) => {
      failures.set(modelId, 0);
    },
    recordFailure: (modelId) => {
      const count = (failures.get(modelId) ?? 0) + 1;
      failures.set(modelId, count);
      if (count >= threshold && !open.includes(modelId)) open.push(modelId);
    },
    opened: () => [...open],
  };
}

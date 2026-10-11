import type { Http } from "../collectors/types.js";

/**
 * `http` with at least `minIntervalMs` between the starts of two `get` requests, by `clock` (ms): before a request,
 * it sleeps whatever is left of the interval since the previous start (nothing before the first). Retries made
 * through it are paced too. Concurrent callers take their turn in call order. `resolveRedirect` is not paced.
 */
export function pacedHttp(
  http: Http,
  minIntervalMs: number,
  clock: () => number,
  sleep: (ms: number) => Promise<void>,
): Http {
  let lastStart: number | null = null;
  let turn: Promise<void> = Promise.resolve();
  return {
    get(url) {
      const myTurn = turn.then(async () => {
        if (lastStart !== null) {
          const wait = lastStart + minIntervalMs - clock();
          if (wait > 0) await sleep(wait);
        }
        lastStart = clock();
      });
      // The next caller waits for this request's start, not for its answer.
      turn = myTurn;
      return myTurn.then(() => http.get(url));
    },
    resolveRedirect: (url) => http.resolveRedirect(url),
  };
}

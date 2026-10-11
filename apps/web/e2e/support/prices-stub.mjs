// Test harness only: a local stand-in for DefiLlama's coins API (coins.llama.fi), so the e2e never needs the network.
// The web server reaches it through PRICES_API_BASE, which lib/prices.ts honours only for a loopback address.
// Every coin costs $0.32 on any past day and $0.304 now; a coin whose id starts with "e2e-noprice" has no price.
import { createServer } from "node:http";

const PORT = Number(process.env.PRICES_STUB_PORT ?? 3101);
const HISTORICAL = 0.32;
const CURRENT = 0.304;

function answer(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/health") return answer(res, 200, { ok: true });
  const match = /^\/prices\/(?:historical\/(\d+)|current)\/(coingecko:[^/]+)$/.exec(path);
  if (!match) return answer(res, 404, { error: "not found" });
  const [, timestamp, key] = match;
  if (key.startsWith("coingecko:e2e-noprice")) return answer(res, 200, { coins: {} });
  const price = timestamp ? HISTORICAL : CURRENT;
  return answer(res, 200, {
    coins: { [key]: { symbol: "E2E", price, timestamp: Number(timestamp ?? Math.floor(Date.now() / 1000)), confidence: 0.99 } },
  });
}).listen(PORT, "127.0.0.1");

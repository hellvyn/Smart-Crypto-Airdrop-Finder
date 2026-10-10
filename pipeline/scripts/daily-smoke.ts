// End-to-end smoke of runDaily against a local Supabase, with fake HTTP and a fake LLM (no external network).
// Run on a freshly reset database (`supabase db reset`), because it reuses fixed fixture URLs.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter pipeline exec tsx scripts/daily-smoke.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Http } from "../src/collectors/types.js";
import { defaultConfig } from "../src/config.js";
import type { ChatFn } from "../src/llm/extract.js";
import { runDaily } from "../src/run.js";
import { SupabaseRepo } from "../src/store/supabase-repo.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) throw new Error("refusing to run against a non-local Supabase");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const repo = new SupabaseRepo(db);
const fixture = (name: string): string => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8");

const T0 = new Date("2026-10-10T23:00:00Z");
const T1 = new Date("2026-10-11T23:00:00Z");

const telegram = (extra: string): string => fixture("telegram.html").replace("</section>", `${extra}</section>`);
const endedPost = `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="airdrops_io/104">
<div class="tgme_widget_message_text" dir="auto">DeepBook claim has ended</div>
<a class="tgme_widget_message_date" href="https://t.me/airdrops_io/104"><time datetime="2026-10-11T08:00:00+00:00">x</time></a>
</div></div>`;

function fakeHttp(telegramPage: string): Http {
  const pages: Record<string, string> = {
    "https://airdrops.io/": fixture("airdrops-home.html"),
    "https://airdrops.io/deepbook/": fixture("airdrops-detail.html"),
    "https://airdrops.io/ink-chain/":
      '<html><body><h1>Ink Chain</h1><div class="airdrop-info"><p>Chain: Ink</p></div>' +
      '<p>Bridge now. Site <a href="https://inkonchain.com/">Ink</a>.</p><div class="airdrop-bottom"></div></body></html>',
    "https://t.me/s/airdrops_io": telegramPage,
    "https://api.llama.fi/protocols": JSON.stringify([
      { name: "Hyperdrive Lend", slug: "hyperdrive-lend", url: "https://hyperdrive.fi", chains: ["Hyperliquid L1"], tvl: 25e6, change_7d: 12.5, category: "Lending", gecko_id: null, symbol: "-" },
    ]),
    "https://api.llama.fi/hacks": "[]",
  };
  return {
    async get(target) {
      if (target.startsWith("https://api.gopluslabs.io/")) return { status: 200, body: '{"code":1,"result":{"phishing_site":0}}' };
      if (target.startsWith("https://rdap.org/domain/")) {
        return { status: 200, body: '{"events":[{"eventAction":"registration","eventDate":"2020-01-01T00:00:00Z"}]}' };
      }
      const body = pages[target];
      return body === undefined ? { status: 404, body: "" } : { status: 200, body };
    },
    async resolveRedirect(target) {
      return target === "https://airdrops.io/visit/53a3/?k=6efe1f6681" ? "https://deepbook.tech/waitlist?ref=abc" : null;
    },
  };
}

const p = (o: Record<string, unknown>) => ({
  token_symbol: null, chains: [], status_evidence: "quote", tasks: [], deadlines: [], official_urls: [], confidence: 0.9, ...o,
});
const replies: Record<string, unknown> = {
  "https://airdrops.io/deepbook/": {
    is_airdrop_content: true,
    projects: [p({ name: "DeepBook", status: "live", chains: ["Sui"], tasks: ["Join the waitlist"],
      deadlines: [{ kind: "claim", date: null, precision: "approximate", text: "Claims are open for 30 days" }],
      official_urls: ["https://deepbook.tech/waitlist"] })],
  },
  "https://airdrops.io/ink-chain/": {
    is_airdrop_content: true,
    projects: [p({ name: "Ink Chain", status: "speculative", official_urls: ["https://inkonchain.com/"] })],
  },
  "https://t.me/airdrops_io/101": { is_airdrop_content: false, projects: [] },
  "https://t.me/airdrops_io/102": { is_airdrop_content: true, projects: [p({ name: "$INK", token_symbol: "INK", status: "announced" })] },
  "https://t.me/airdrops_io/104": { is_airdrop_content: true, projects: [p({ name: "DeepBook", status: "ended" })] },
};
const chat: ChatFn = async (_model, messages) => {
  const reply = replies[/^Source: (\S+)/.exec(messages[1]?.content ?? "")?.[1] ?? ""];
  return reply === undefined
    ? { content: "", finishReason: null, latencyMs: 1, httpStatus: 500 }
    : { content: JSON.stringify(reply), finishReason: "stop", latencyMs: 1, httpStatus: 200 };
};

async function count(table: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table} failed: ${error.message}`);
  return n ?? 0;
}

async function main(): Promise<void> {
  const deps = { repo, chat, sleep: async () => {} };
  const first = await runDaily({ ...deps, http: fakeHttp(telegram("")), now: () => T0 }, defaultConfig);
  console.log(JSON.stringify(first));
  const second = await runDaily({ ...deps, http: fakeHttp(telegram(endedPost)), now: () => T1 }, defaultConfig);
  console.log(JSON.stringify(second));

  assert.equal(first.source_failed, 0);
  assert.equal(first.projects_created, 3);
  assert.equal(second.docs_changed, 1); // only the new Telegram post
  const deepbook = await repo.findProjectsByNameKey("deepbook");
  assert.equal(deepbook.length, 1);
  assert.equal(deepbook[0]?.status, "ended");
  assert.equal((await repo.findProjectsByNameKey("ink")).length, 1);
  const changes = await db.from("project_changes").select("field, old_value, new_value").eq("field", "status");
  assert.deepEqual(changes.data, [{ field: "status", old_value: "live", new_value: "ended" }]);
  console.log(
    JSON.stringify({
      projects: await count("projects"),
      documents: await count("documents"),
      evidence: await count("evidence"),
      risk_assessments: await count("risk_assessments"),
      pipeline_runs: await count("pipeline_runs"),
    }),
  );
  console.log("daily smoke ok");
}

await main();

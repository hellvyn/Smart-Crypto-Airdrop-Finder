import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

// Integration test against the local Supabase stack (migration 0017): two connections each call coach_begin with one
// slot left, and exactly one may get it. A pgTAP file runs in one transaction and cannot race two sessions, so this
// is the concurrency check. It is skipped when the local stack is not running (the CI unit-test job has none; run it
// with `npx -y supabase@2.120.0 start`). It reads no secrets from the repo: the keys come from the environment or from
// `supabase status`, and the users it creates are deleted at the end.

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ROUNDS = 3;

type Keys = { url: string; anonKey: string; serviceKey: string };

async function stackIsUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function resolveKeys(): Promise<Keys | null> {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!(await stackIsUp(url))) return null;
  if (!anonKey || !serviceKey) {
    try {
      const text = execFileSync("npx", ["-y", "supabase@2.120.0", "status", "-o", "env"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const env: Record<string, string> = {};
      for (const line of text.split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
      }
      url = env.API_URL ?? url;
      anonKey ??= env.ANON_KEY;
      serviceKey ??= env.SERVICE_ROLE_KEY;
    } catch {
      return null;
    }
  }
  return anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
}

const keys = await resolveKeys();
// CI's e2e job (which has the stack) sets REQUIRE_LOCAL_STACK=1, so a stack that is not reachable fails the run there
// instead of skipping the test silently.
if (!keys && process.env.REQUIRE_LOCAL_STACK === "1") {
  throw new Error("coach-quota.int.test.ts: REQUIRE_LOCAL_STACK=1 but the local Supabase stack is not reachable");
}
const opts = { auth: { autoRefreshToken: false, persistSession: false } };

describe.skipIf(!keys)("coach_begin under concurrency (0017)", () => {
  const admin: SupabaseClient = createClient(keys!.url, keys!.serviceKey, opts);
  const userIds: string[] = [];

  afterAll(async () => {
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`cleanup failed for a test user: ${error.message}`);
    }
  });

  async function member(): Promise<{ id: string; db: SupabaseClient }> {
    const email = `coach-quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("no user");
    userIds.push(created.data.user.id);
    const db = createClient(keys!.url, keys!.anonKey, opts);
    const signedIn = await db.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    return { id: created.data.user.id, db };
  }

  it("gives the last slot to exactly one of two simultaneous calls", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { id, db } = await member();
      const thread = await db.rpc("coach_new_thread", { p_project_id: null });
      expect(thread.error).toBeNull();
      const threadId = thread.data as string;

      // 19 answered messages from just now (so a WIB midnight cannot fall between the seed and the calls): one slot left.
      // The quota is counted from coach_usage, so the ledger rows are seeded with the messages.
      const at = new Date(Date.now() - 60_000).toISOString();
      const asked = Array.from({ length: 19 }, () => randomUUID());
      const users = await admin.from("coach_messages").insert(
        asked.map((mid) => ({ id: mid, thread_id: threadId, user_id: id, role: "user", kind: "chat", content: "seed", created_at: at })),
      );
      expect(users.error).toBeNull();
      const replies = await admin.from("coach_messages").insert(
        asked.map((mid) => ({ thread_id: threadId, user_id: id, role: "assistant", kind: "chat", content: "seed", reply_to: mid, created_at: at })),
      );
      expect(replies.error).toBeNull();
      const ledger = await admin
        .from("coach_usage")
        .insert(asked.map((mid) => ({ id: mid, kind: "message", user_id: id, created_at: at, replied: true })));
      expect(ledger.error).toBeNull();

      const [a, b] = await Promise.all([
        db.rpc("coach_begin", { p_thread_id: threadId, p_kind: "chat", p_content: "satu" }),
        db.rpc("coach_begin", { p_thread_id: threadId, p_kind: "chat", p_content: "dua" }),
      ]);
      const results = [a, b];
      const wins = results.filter((r) => r.error === null);
      const losses = results.filter((r) => r.error !== null);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect(losses[0]!.error!.code).toBe("P0001");
      expect(losses[0]!.error!.message).toBe("quota");

      const counted = await admin
        .from("coach_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id)
        .eq("kind", "message");
      expect(counted.count).toBe(20);
    }
  }, 60_000);
});

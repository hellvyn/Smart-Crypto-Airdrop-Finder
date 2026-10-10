import { describe, expect, it } from "vitest";
import { listConfirmedEmails } from "../src/store/supabase-repo.js";
import type { UserLister } from "../src/store/supabase-repo.js";

type FakeUser = { id: string; email?: string; email_confirmed_at?: string };

/** A fake `auth.admin` that serves the given pages (1-based) and records each request. */
function fakeAdmin(pages: FakeUser[][], extra: { total?: number } = {}) {
  const calls: { page: number; perPage: number }[] = [];
  const admin: UserLister = {
    async listUsers(params) {
      calls.push(params);
      return { data: { users: pages[params.page - 1] ?? [], ...extra }, error: null };
    },
  };
  return { admin, calls };
}

const user = (n: number, confirmed = true): FakeUser => ({
  id: `u${n}`,
  email: `u${n}@example.test`,
  ...(confirmed ? { email_confirmed_at: "2026-10-01T00:00:00Z" } : {}),
});

describe("listConfirmedEmails", () => {
  it("keeps paging past short pages until an empty one (pages of 2, 2, 1, 0 with perPage 1000)", async () => {
    const { admin, calls } = fakeAdmin([[user(1), user(2)], [user(3), user(4)], [user(5)], []]);
    const emails = await listConfirmedEmails(admin);
    expect([...emails.keys()]).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(calls).toEqual([
      { page: 1, perPage: 1000 },
      { page: 2, perPage: 1000 },
      { page: 3, perPage: 1000 },
      { page: 4, perPage: 1000 },
    ]);
  });

  it("stops once it has seen `total` users", async () => {
    const { admin, calls } = fakeAdmin([[user(1), user(2)], [user(3), user(4)], [user(5)], [user(6)]], { total: 5 });
    expect((await listConfirmedEmails(admin)).size).toBe(5);
    expect(calls).toHaveLength(3);
  });

  it("leaves out users without a confirmed email or without an email", async () => {
    const { admin } = fakeAdmin([[user(1), user(2, false), { id: "u3", email_confirmed_at: "2026-10-01T00:00:00Z" }], []]);
    expect(await listConfirmedEmails(admin)).toEqual(new Map([["u1", "u1@example.test"]]));
  });

  it("stops when a page brings no new users (a server that ignores `page`)", async () => {
    const calls: number[] = [];
    const admin: UserLister = {
      async listUsers(params) {
        calls.push(params.page);
        return { data: { users: [user(1), user(2)] }, error: null };
      },
    };
    expect((await listConfirmedEmails(admin)).size).toBe(2);
    expect(calls).toEqual([1, 2]);
  });

  it("throws on an error without echoing user data", async () => {
    const admin: UserLister = {
      async listUsers() {
        return { data: { users: [] }, error: { message: "boom" } };
      },
    };
    await expect(listConfirmedEmails(admin)).rejects.toThrow("supabase listDigestRecipients.users failed: boom");
  });
});

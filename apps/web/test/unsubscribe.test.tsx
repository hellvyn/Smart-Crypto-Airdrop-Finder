import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const redirect = vi.fn();
const getUser = vi.fn();
const serverDb = { rpc: (...args: unknown[]) => rpc(...args) } as unknown as SupabaseClient;

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => serverDb }));
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    redirect(p);
    throw new Error("NEXT_REDIRECT");
  },
}));

import UnsubscribePage, { metadata } from "../app/unsubscribe/page";
import { submitUnsubscribe, unsubscribe } from "../app/unsubscribe/actions";

const TOKEN = "7b0f2d1e-3c4a-4b5d-9e6f-0a1b2c3d4e5f";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  redirect.mockReset();
  getUser.mockReset().mockResolvedValue(null);
});

const render = async (params: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve(params) }));

describe("unsubscribe action", () => {
  it("calls unsubscribe_digest with the token and maps true to done", async () => {
    await expect(unsubscribe(TOKEN)).resolves.toBe("done");
    expect(rpc).toHaveBeenCalledWith("unsubscribe_digest", { token: TOKEN });
  });

  it("maps false (unknown token) to invalid", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(unsubscribe(TOKEN)).resolves.toBe("invalid");
  });

  it("accepts an uppercase UUID", async () => {
    await expect(unsubscribe(TOKEN.toUpperCase())).resolves.toBe("done");
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each(["", "not-a-uuid", `${TOKEN}x`, ` ${TOKEN}`, "1' or '1'='1"])("rejects %j without calling the database", async (bad) => {
    await expect(unsubscribe(bad)).resolves.toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws on an RPC error and does not echo the token", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = await unsubscribe(TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("does not need a signed-in user", async () => {
    await unsubscribe(TOKEN);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("submitUnsubscribe form entry", () => {
  const form = (token?: string) => {
    const fd = new FormData();
    if (token !== undefined) fd.set("token", token);
    return fd;
  };

  it("redirects to the done view without the token in the URL", async () => {
    await expect(submitUnsubscribe(form(TOKEN))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/unsubscribe?done=1");
  });

  it("redirects to the invalid view for an unknown token", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(submitUnsubscribe(form(TOKEN))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/unsubscribe");
  });

  it("treats a missing token as invalid without calling the database", async () => {
    await expect(submitUnsubscribe(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/unsubscribe");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("unsubscribe page", () => {
  it("is noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("renders the form with the token only in a hidden field, and never calls the RPC on GET", async () => {
    const html = await render({ token: TOKEN });
    expect(html).toContain("Unsubscribe from daily digest");
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="token"');
    expect(html).toContain(`value="${TOKEN}"`);
    expect(html.split(TOKEN)).toHaveLength(2); // exactly one occurrence
    expect(rpc).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "nope", [TOKEN, TOKEN]])("shows the invalid copy and no form for token %j", async (token) => {
    const html = await render({ token });
    expect(html).toContain("This link is invalid or already used.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Unsubscribe from daily digest");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the done copy without a Settings link when signed out", async () => {
    const html = await render({ done: "1" });
    expect(html).toContain("You are unsubscribed.");
    expect(html).not.toContain("/settings");
    expect(html).not.toContain("<form");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("links to Settings in the done view for a signed-in user", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    const html = await render({ done: "1" });
    expect(html).toContain("You are unsubscribed.");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Turn it back on in Settings");
  });
});

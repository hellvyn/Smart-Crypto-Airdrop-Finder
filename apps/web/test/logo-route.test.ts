// GET /logo/[projectId]: the stored logo bytes, served from our own origin (owner request 2026-10-11).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: { message: string } | null };
let answer: Answer;
const queries: { table: string; calls: unknown[][] }[] = [];
const createPublicClient = vi.fn(() => ({
  from: (table: string) => {
    const rec = { table, calls: [] as unknown[][] };
    queries.push(rec);
    const q = {
      select: (...a: unknown[]) => (rec.calls.push(["select", ...a]), q),
      eq: (...a: unknown[]) => (rec.calls.push(["eq", ...a]), q),
      maybeSingle: async () => answer,
    };
    return q;
  },
}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => createPublicClient() }));
// The route must never read or write the session cookies: its answer is cached publicly.
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("cookies() must not be used by the logo route");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => {
    throw new Error("the cookie client must not be used by the logo route");
  },
}));

import { GET } from "../app/logo/[projectId]/route";

const ID = "5b3c1a2e-0000-4000-8000-0000000000aa";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const get = (id: string) => GET(new Request(`http://x/logo/${id}`), { params: Promise.resolve({ projectId: id }) });

beforeEach(() => {
  queries.length = 0;
  createPublicClient.mockClear();
  answer = { data: { mime: "image/png", data_b64: PNG_B64 }, error: null };
});

describe("GET /logo/[projectId]", () => {
  it("returns the stored bytes with the stored mime, nosniff, a sandboxing CSP and a public day-long cache", async () => {
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG_B64, "base64"))).toBe(true);
    expect(queries).toEqual([
      { table: "project_logos", calls: [["select", "mime, data_b64"], ["eq", "project_id", ID]] },
    ]);
  });

  it.each(["image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"])("serves %s as stored", async (mime) => {
    answer = { data: { mime, data_b64: PNG_B64 }, error: null };
    expect((await get(ID)).headers.get("content-type")).toBe(mime);
  });

  it("is 404 without a logo", async () => {
    answer = { data: null, error: null };
    const res = await get(ID);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each(["not-a-uuid", "../../etc/passwd", `${ID}x`, "", "5B3C1A2E-0000-4000-8000-0000000000AA%00"])(
    "is 404 for the bad id %j, without asking the database",
    async (id) => {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(createPublicClient).not.toHaveBeenCalled();
    },
  );

  it("never serves a mime outside the raster allow-list (e.g. SVG or HTML), even if a row had one", async () => {
    for (const mime of ["image/svg+xml", "text/html", ""]) {
      answer = { data: { mime, data_b64: PNG_B64 }, error: null };
      const res = await get(ID);
      expect(res.status, mime).toBe(404);
      expect(res.headers.get("content-type"), mime).not.toBe(mime || "x");
    }
  });

  it("is 503, not cached, when the database fails", async () => {
    answer = { data: null, error: { message: "boom" } };
    const res = await get(ID);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

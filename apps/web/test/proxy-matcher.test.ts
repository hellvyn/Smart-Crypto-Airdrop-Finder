// The session proxy (proxy.ts) must not run on the logo route: it may refresh the session and set cookies, and a
// logo response is cached publicly (Cache-Control: public), so a cookie on it could be served to someone else.
import { describe, expect, it, vi } from "vitest";

// Next's server modules expect the global the Next.js runtime installs.
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
});

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";

describe("proxy matcher", () => {
  it("skips /logo/<id>", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/logo/5b3c1a2e-0000-4000-8000-0000000000aa" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: "/logo/not-a-uuid" })).toBe(false);
  });

  it("still runs on the pages, a page that only starts with logo included", () => {
    for (const url of ["/", "/airdrops", "/projects/demo", "/watchlist", "/login", "/logos", "/logout"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });
});

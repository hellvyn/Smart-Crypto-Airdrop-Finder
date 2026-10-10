import { describe, expect, it } from "vitest";
import { isProtectedPath, legacyListRedirect, loginRedirectPath, proxyRedirect, signedInLoginTarget } from "./routes";

describe("isProtectedPath", () => {
  it("protects the signed-in app pages and their sub-paths", () => {
    expect(isProtectedPath("/watchlist")).toBe(true);
    expect(isProtectedPath("/watchlist/")).toBe(true);
    expect(isProtectedPath("/wallets")).toBe(true);
    expect(isProtectedPath("/wallets/123")).toBe(true);
    expect(isProtectedPath("/settings")).toBe(true);
  });

  it("leaves the public pages and login open", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("keeps the list and project pages public and account pages protected", () => {
    expect(isProtectedPath("/airdrops")).toBe(false);
    expect(isProtectedPath("/projects/ink")).toBe(false);
    expect(isProtectedPath("/watchlist")).toBe(true);
  });

  it("matches whole path segments only", () => {
    expect(isProtectedPath("/watchlists-public")).toBe(false);
    expect(isProtectedPath("/settingsx")).toBe(false);
  });
});

describe("loginRedirectPath", () => {
  it("sends the user to /login with the page they wanted", () => {
    expect(loginRedirectPath("/watchlist", "")).toBe("/login?next=%2Fwatchlist");
    expect(loginRedirectPath("/wallets", "?chain=base")).toBe("/login?next=%2Fwallets%3Fchain%3Dbase");
  });
});

describe("legacyListRedirect", () => {
  it("sends an old list link with a query (bookmarks of the v1 list at /) to /airdrops, query intact", () => {
    expect(legacyListRedirect("/", "?status=live")).toBe("/airdrops?status=live");
    expect(legacyListRedirect("/", "?status=live&risk=high&chain=base&page=2")).toBe(
      "/airdrops?status=live&risk=high&chain=base&page=2",
    );
  });

  it("leaves the landing alone when there is no query", () => {
    expect(legacyListRedirect("/", "")).toBeNull();
  });

  it("keeps the account-deleted notice on the landing", () => {
    expect(legacyListRedirect("/", "?deleted=1")).toBeNull();
  });

  it("only applies to the root path", () => {
    expect(legacyListRedirect("/airdrops", "?status=live")).toBeNull();
    expect(legacyListRedirect("/projects/ink", "?status=live")).toBeNull();
    expect(legacyListRedirect("/login", "?next=%2Fwatchlist")).toBeNull();
  });
});

describe("proxyRedirect", () => {
  const get = { serverAction: false };

  it("sends a signed-out visit to an account page to /login with the page it asked for", () => {
    expect(proxyRedirect({ ...get, pathname: "/settings", search: "", signedIn: false })).toBe("/login?next=%2Fsettings");
    expect(proxyRedirect({ ...get, pathname: "/settings", search: "", signedIn: true })).toBeNull();
  });

  it("lets a signed-out server action through, so the action's own check can redirect the page", () => {
    // A redirect response to the action's POST is not something the page can follow: it shows an error page.
    expect(proxyRedirect({ pathname: "/settings", search: "", signedIn: false, serverAction: true })).toBeNull();
    expect(proxyRedirect({ pathname: "/", search: "?status=live", signedIn: false, serverAction: true })).toBeNull();
  });

  it("sends old list links to /airdrops whether signed in or not", () => {
    expect(proxyRedirect({ ...get, pathname: "/", search: "?status=live", signedIn: false })).toBe("/airdrops?status=live");
    expect(proxyRedirect({ ...get, pathname: "/", search: "?status=live", signedIn: true })).toBe("/airdrops?status=live");
    expect(proxyRedirect({ ...get, pathname: "/", search: "", signedIn: false })).toBeNull();
    expect(proxyRedirect({ ...get, pathname: "/airdrops", search: "?status=live", signedIn: false })).toBeNull();
  });
});

describe("signedInLoginTarget", () => {
  it("sends a signed-in user from /login to the list by default", () => {
    expect(signedInLoginTarget(undefined)).toBe("/airdrops");
    expect(signedInLoginTarget("")).toBe("/airdrops");
  });

  it("follows a safe next page", () => {
    expect(signedInLoginTarget("/settings")).toBe("/settings");
    expect(signedInLoginTarget("/airdrops?status=live")).toBe("/airdrops?status=live");
  });

  it("ignores an off-site next", () => {
    expect(signedInLoginTarget("//evil.example/steal")).toBe("/airdrops");
    expect(signedInLoginTarget("https://evil.example")).toBe("/airdrops");
  });

  it("never sends the user back to /login (no redirect loop)", () => {
    expect(signedInLoginTarget("/login")).toBe("/airdrops");
    expect(signedInLoginTarget("/login?next=%2Flogin")).toBe("/airdrops");
    expect(signedInLoginTarget("/login/")).toBe("/airdrops");
  });
});

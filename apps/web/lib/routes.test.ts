import { describe, expect, it } from "vitest";
import { isProtectedPath, loginRedirectPath } from "./routes";

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

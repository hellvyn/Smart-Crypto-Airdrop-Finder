// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/app/(auth)/actions", () => ({ signOut: async () => {} }));

import { SiteHeader } from "@/components/site-header";

afterEach(cleanup);
beforeEach(() => getUser.mockReset());

describe("SiteHeader (design C)", () => {
  it("shows the brand and a Login link to a visitor, with no account links", async () => {
    getUser.mockResolvedValue(null);
    render(await SiteHeader());
    expect(screen.getByRole("link", { name: "AirdropIQ" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Login" }).getAttribute("href")).toBe("/login");
    for (const name of ["Garapan saya", "Watchlist", "Wallets", "Settings"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("has no signup or register link anywhere (#46)", async () => {
    getUser.mockResolvedValue(null);
    const { container } = render(await SiteHeader());
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => /sign.?up|register|daftar/i.test(h))).toEqual([]);
    expect(container.textContent).not.toMatch(/sign ?up|daftar|register/i);
  });

  it("shows account links, the email and Sign out to a signed-in user, but no Login", async () => {
    getUser.mockResolvedValue({ id: "u1", email: "someone@example.test" });
    render(await SiteHeader());
    expect(screen.getByRole("link", { name: "Garapan saya" }).getAttribute("href")).toBe("/garapan");
    expect(screen.getByRole("link", { name: "Watchlist" }).getAttribute("href")).toBe("/watchlist");
    expect(screen.getByRole("link", { name: "Wallets" }).getAttribute("href")).toBe("/wallets");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByTestId("user-email").textContent).toBe("someone@example.test");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Login" })).toBeNull();
  });

  it("links the public pages", async () => {
    getUser.mockResolvedValue(null);
    render(await SiteHeader());
    expect(screen.getByRole("link", { name: "Airdrop" }).getAttribute("href")).toBe("/airdrops");
    expect(screen.getByRole("link", { name: "Kenapa AirdropIQ" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Track record" })).toBeTruthy();
  });
});

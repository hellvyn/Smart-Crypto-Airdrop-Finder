import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE_FORM,
  formValuesFrom,
  linkify,
  parseLinksHeader,
  validateProfileForm,
  type ProfileFormValues,
} from "@/lib/coach-text";

const filled: ProfileFormValues = {
  level: "beginner",
  capital_band: "free",
  has_wallet: "yes",
  wallet_count: "2",
  minutes_per_day: "30",
  goal: "learn",
  chains: ["base"],
};

describe("validateProfileForm", () => {
  it("names every empty required field", () => {
    const result = validateProfileForm(EMPTY_PROFILE_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      level: "Pilih level kamu.",
      capital_band: "Pilih modal yang siap kamu pakai.",
      has_wallet: "Pilih udah atau belum punya wallet.",
      minutes_per_day: "Pilih waktu per hari.",
      goal: "Pilih tujuan kamu.",
    });
  });

  it("wants a wallet count from 1 to 10 when the member has a wallet", () => {
    for (const bad of ["", "0", "11", "2.5", "abc"]) {
      const result = validateProfileForm({ ...filled, wallet_count: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.wallet_count).toBe("Isi jumlah wallet, 1 sampai 10.");
    }
    expect(validateProfileForm({ ...filled, wallet_count: "10" }).ok).toBe(true);
  });

  it("does not ask for a count when there is no wallet, and sends null", () => {
    const result = validateProfileForm({ ...filled, has_wallet: "no", wallet_count: "7" });
    expect(result).toEqual({
      ok: true,
      profile: {
        level: "beginner",
        capital_band: "free",
        has_wallet: false,
        wallet_count: null,
        minutes_per_day: 30,
        goal: "learn",
        chains: ["base"],
      },
    });
  });

  it("round-trips a saved profile into form values", () => {
    const result = validateProfileForm(filled);
    expect(result.ok).toBe(true);
    if (result.ok) expect(formValuesFrom(result.profile)).toEqual(filled);
  });
});

describe("parseLinksHeader", () => {
  it("reads the encoded JSON the chat route sends", () => {
    const header = encodeURIComponent(JSON.stringify([{ name: "Base Swap", href: "/projects/base-swap" }]));
    expect(parseLinksHeader(header)).toEqual([{ name: "Base Swap", href: "/projects/base-swap" }]);
  });

  it("drops anything that is not an internal project link, and survives garbage", () => {
    const header = encodeURIComponent(
      JSON.stringify([
        { name: "Evil", href: "https://evil.example/x" },
        { name: "Proto", href: "//evil.example" },
        { name: "Js", href: "javascript:alert(1)" },
        { name: "Ok", href: "/projects/ok" },
        { name: 5, href: "/projects/five" },
      ]),
    );
    expect(parseLinksHeader(header)).toEqual([{ name: "Ok", href: "/projects/ok" }]);
    expect(parseLinksHeader("%E0%A4%A")).toEqual([]);
    expect(parseLinksHeader(null)).toEqual([]);
    expect(parseLinksHeader(encodeURIComponent("{}"))).toEqual([]);
  });
});

describe("linkify", () => {
  it("links a name only as a whole word, never inside another word", () => {
    const links = [{ name: "Sei", href: "/projects/sei" }];
    expect(linkify("Seiring waktu, coba Sei. Modern Sei2 bukan.", links)).toEqual([
      { text: "Seiring waktu, coba " },
      { text: "Sei", href: "/projects/sei" },
      { text: ". Modern Sei2 bukan." },
    ]);
  });

  const links = [
    { name: "Base", href: "/projects/base" },
    { name: "Base Swap", href: "/projects/base-swap" },
  ];

  it("turns candidate names into links and leaves the rest as it was", () => {
    expect(linkify("Coba Base Swap dulu, lalu Base.", links)).toEqual([
      { text: "Coba " },
      { text: "Base Swap", href: "/projects/base-swap" },
      { text: " dulu, lalu " },
      { text: "Base", href: "/projects/base" },
      { text: "." },
    ]);
  });

  it("returns the whole text when there is nothing to link", () => {
    expect(linkify("Halo, <b>dunia</b> https://x.example", links)).toEqual([{ text: "Halo, <b>dunia</b> https://x.example" }]);
    expect(linkify("Base", [])).toEqual([{ text: "Base" }]);
    expect(linkify("", links)).toEqual([]);
  });
});

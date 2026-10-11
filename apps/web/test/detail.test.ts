// Pure helpers of the project page (lib/detail.ts).
import { describe, expect, it } from "vitest";
import { claimOpenChecked, domainAge, registeredOn, sourceName, summaryDeadlines, summaryLinks } from "@/lib/detail";

describe("claimOpenChecked (#42)", () => {
  const today = "2026-10-10";
  const official = { url: "https://claim.nebula.example/", kind: "claim", status: "official" as const };
  const deadline = (date: string | null) => ({ kind: "claim" as const, date, precision: "exact" as const, text: "" });

  it("is true with a claim deadline from today on and every claim link checked as official", () => {
    expect(claimOpenChecked([deadline("2026-10-10")], [official, { url: "https://x.example/", kind: "app", status: null }], today)).toBe(true);
  });

  it("is false when the claim deadline has passed or is undated", () => {
    expect(claimOpenChecked([deadline("2026-10-09")], [official], today)).toBe(false);
    expect(claimOpenChecked([deadline(null)], [official], today)).toBe(false);
    expect(claimOpenChecked([{ ...deadline("2026-11-01"), kind: "snapshot" }], [official], today)).toBe(false);
  });

  it("is false without a claim link, or when any claim link is not official or was never checked", () => {
    expect(claimOpenChecked([deadline("2026-11-01")], [], today)).toBe(false);
    for (const status of ["different_domain", "phishing", "unchecked", null] as const) {
      expect(claimOpenChecked([deadline("2026-11-01")], [official, { url: "https://b.example/", kind: "claim", status }], today)).toBe(false);
    }
  });
});

describe("domainAge", () => {
  it.each([
    [820, "2 tahun 3 bulan"],
    [730, "2 tahun"],
    [150, "5 bulan"],
    [12, "12 hari"],
    [0, "0 hari"],
  ])("%i days reads %s", (days, text) => {
    expect(domainAge(days)).toBe(text);
  });
});

describe("registeredOn", () => {
  it("is the check time minus the age, as a calendar day", () => {
    expect(registeredOn("2026-10-10T00:00:00Z", 820)).toBe("12 Jul 2024");
  });
});

describe("sourceName", () => {
  it("is the host without www, or the text itself when it is no URL", () => {
    expect(sourceName("https://www.airdrops.io/nebula/")).toBe("airdrops.io");
    expect(sourceName("https://t.me/airdrops_io/101")).toBe("t.me");
    expect(sourceName("not a url")).toBe("not a url");
  });
});

describe("summaryDeadlines", () => {
  it("keeps one deadline per kind: a dated one beats 'belum diketahui', and a more exact one beats a looser one", () => {
    const out = summaryDeadlines([
      { kind: "campaign_end", date: null, precision: "exact", text: "" },
      { kind: "tge", date: "2026-10-01", precision: "quarter", text: "" },
      { kind: "campaign_end", date: "2026-10-27", precision: "exact", text: "" },
      { kind: "tge", date: "2026-10-20", precision: "exact", text: "" },
      { kind: "snapshot", date: null, precision: "approximate", text: "" },
    ]);
    expect(out.map((d) => [d.kind, d.date])).toEqual([
      ["campaign_end", "2026-10-27"],
      ["tge", "2026-10-20"],
      ["snapshot", null],
    ]);
  });
});

describe("summaryLinks", () => {
  it("keeps one link per site and names the well-known ones", () => {
    const link = (url: string) => ({ url, kind: "website" }) as never;
    const out = summaryLinks([
      link("https://mint.io/a"),
      link("https://www.mint.io/b"),
      link("https://x.com/proj"),
      link("https://t.me/proj"),
      link("https://nft.getminted.io/"),
      link("https://getminted.io/"),
    ]);
    expect(out.map((l) => l.label)).toEqual(["mint.io", "X", "Telegram", "nft.getminted.io", "getminted.io"]);
  });
});


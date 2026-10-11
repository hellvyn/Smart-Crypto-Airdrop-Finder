import { describe, expect, it } from "vitest";
import {
  capitalLabel,
  checkedLabel,
  compactUsd,
  curatedHref,
  endedLabel,
  isCheckFrozen,
  isCheckStale,
  logoLetter,
  logoTone,
  notCuratedReason,
  parseCuratedFilters,
  coverageLine,
  deadlineKindLabel,
  evidenceFieldLabel,
  parseCapital,
  parseTab,
  PAGE_SIZE,
  isStale,
  listQueryString,
  parseChain,
  parseFilters,
  rawChainParam,
  parsePage,
  pickLastSuccessfulRun,
  pickNextDeadline,
  precisionLabel,
  riskLabel,
  safeHttpUrl,
  statusLabel,
} from "../lib/view";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("isStale", () => {
  it("is stale beyond 36 hours", () => expect(isStale(hoursAgo(37), NOW)).toBe(true));
  it("is fresh within 36 hours", () => expect(isStale(hoursAgo(35), NOW)).toBe(false));
  it("is stale when there has been no successful run", () => expect(isStale(null, NOW)).toBe(true));
});

describe("labels", () => {
  it("shows unknown status as Belum pasti", () => expect(statusLabel("unknown")).toBe("Belum pasti"));
  it("labels the other statuses", () => {
    expect(statusLabel("live")).toBe("Live");
    expect(statusLabel("announced")).toBe("Diumumkan");
    expect(statusLabel("speculative")).toBe("Spekulatif");
    expect(statusLabel("ended")).toBe("Ended");
  });
  it("labels risk levels without numbers", () => {
    expect(riskLabel(null)).toBe("Belum dinilai");
    expect(riskLabel("insufficient_data")).toBe("Data belum cukup");
    expect(riskLabel("low")).toBe("Rendah");
    expect(riskLabel("medium")).toBe("Sedang");
    expect(riskLabel("high")).toBe("Tinggi");
    expect(riskLabel("critical")).toBe("Kritis");
  });
  it("never produces a SAFE label", () => {
    for (const l of [null, "low", "medium", "high", "critical", "insufficient_data"] as const) {
      expect(riskLabel(l)).not.toMatch(/safe|\baman\b/i);
    }
  });
  it("labels deadline kinds, keeping an unknown kind readable", () => {
    expect(deadlineKindLabel("claim")).toBe("Claim");
    expect(deadlineKindLabel("snapshot")).toBe("Snapshot");
    expect(deadlineKindLabel("campaign_end")).toBe("Akhir campaign");
    expect(deadlineKindLabel("withdraw_funds")).toBe("Tarik dana");
    expect(deadlineKindLabel("tge")).toBe("TGE");
    expect(deadlineKindLabel("other")).toBe("Lainnya");
    expect(deadlineKindLabel("mystery_kind")).toBe("mystery kind");
  });
  it("labels date precision", () => {
    expect(precisionLabel("exact")).toBe("tanggal tepat");
    expect(precisionLabel("approximate")).toBe("tanggal perkiraan");
    expect(precisionLabel("month")).toBe("bulannya aja");
    expect(precisionLabel("quarter")).toBe("kuartalnya aja");
  });
  it("labels evidence fields", () => {
    expect(evidenceFieldLabel("status")).toBe("Status");
    expect(evidenceFieldLabel("defillama_listing")).toBe("Listing DefiLlama");
    expect(evidenceFieldLabel("dangerous_ask")).toBe("Permintaan berbahaya");
    expect(evidenceFieldLabel("some_field")).toBe("some field");
  });
});

describe("safeHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeHttpUrl("ftp://example.com")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("pickNextDeadline", () => {
  const rows = [
    { date: "2026-10-01", kind: "claim", precision: "exact" }, // past
    { date: "2026-10-10", kind: "snapshot", precision: "exact" }, // today counts
    { date: "2026-10-12", kind: "claim", precision: "month" }, // not firm
    { date: null, kind: "tge", precision: "approximate" }, // no date
    { date: "2026-10-11", kind: "claim", precision: "approximate" },
  ];
  it("picks the earliest firm deadline on or after today", () => {
    expect(pickNextDeadline(rows, "2026-10-10")).toEqual({ date: "2026-10-10", kind: "snapshot", precision: "exact" });
    expect(pickNextDeadline(rows, "2026-10-11")?.kind).toBe("claim");
  });
  it("returns null when nothing qualifies", () => {
    expect(pickNextDeadline(rows, "2027-01-01")).toBeNull();
  });
});

describe("pickLastSuccessfulRun", () => {
  it("ignores unfinished runs and runs with run_error", () => {
    const d = pickLastSuccessfulRun([
      { finishedAt: null, stats: {} },
      { finishedAt: "2026-10-10T05:00:00Z", stats: { run_error: "boom" } },
      { finishedAt: "2026-10-09T05:00:00Z", stats: { docs: 3 } },
      { finishedAt: "2026-10-08T05:00:00Z", stats: {} },
    ]);
    expect(d?.toISOString()).toBe("2026-10-09T05:00:00.000Z");
    expect(pickLastSuccessfulRun([])).toBeNull();
  });
});

describe("coverageLine", () => {
  const ids = [
    "dangerous_asks",
    "phishing_list",
    "domain_age",
    "lookalike",
    "token_security",
    "contract_verified",
    "hack_history",
    "corroboration",
    "ai_review",
  ] as const;

  it("counts ran checks and names the ones that did not run, the AI review included", () => {
    const line = coverageLine(ids.map((id, i) => ({ id, ran: i !== 2 && id !== "ai_review" })));
    expect(line).toBe("7/9 cek jalan. Belum bisa dicek: Umur domain, Review AI.");
  });

  it("counts a missing AI review row as not run", () => {
    const line = coverageLine(ids.filter((id) => id !== "ai_review").map((id) => ({ id, ran: true })));
    expect(line).toBe("8/9 cek jalan. Belum bisa dicek: Review AI.");
  });

  it("names every check by its Indonesian label", () => {
    expect(coverageLine([])).toBe(
      "0/9 cek jalan. Belum bisa dicek: Minta seed phrase / bayar dulu, Database phishing, Umur domain, " +
        "Domain tiruan, Risiko kontrak token, Kontrak verified, Riwayat hack, Cross-check antar source, Review AI.",
    );
  });

  it("says nothing more when every check ran", () => {
    expect(coverageLine(ids.map((id) => ({ id, ran: true })))).toBe("9/9 cek jalan");
  });
});

describe("paging helpers", () => {
  it("parses ?page= with 1-based fallback", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(undefined)).toBe(1);
    for (const bad of ["0", "-2", "abc", "1.5", "", "2e3", "99999999999"]) expect(parsePage(bad)).toBe(1);
  });

  it("builds a query string that keeps the filters", () => {
    expect(listQueryString({}, 1)).toBe("");
    expect(listQueryString({ status: ["live", "ended"], risk: ["high"], chain: "base" }, 2)).toBe(
      "status=live&status=ended&risk=high&chain=base&page=2",
    );
    expect(listQueryString({ chain: "a b&c" }, 1)).toBe("chain=a+b%26c");
  });
});

describe("chain filter parsing", () => {
  it("accepts plain chain names, trimmed and lowercased", () => {
    expect(parseChain("base")).toBe("base");
    expect(parseChain("  BNB Chain ")).toBe("bnb chain");
    expect(parseChain("zk-sync.era_1")).toBe("zk-sync.era_1");
  });

  it("rejects anything that could break the array literal", () => {
    for (const bad of ["a,b", "a}", "{a", 'x"y', "back\\slash", "NULL", "null", "", "   ", "-x", "a".repeat(60), "a\nb", "é"]) {
      expect(parseChain(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseChain(undefined)).toBeNull();
  });

  it("parseFilters applies no chain filter for an invalid value, but rawChainParam still reports it", () => {
    expect(parseFilters({ chain: "a,b" }).chain).toBeUndefined();
    expect(rawChainParam({ chain: " A,B " })).toBe("a,b");
    expect(parseFilters({ chain: "Base" }).chain).toBe("base");
    expect(parseFilters({ chain: ["base", "x"] }).chain).toBe("base");
  });

  it("parseFilters drops unknown status and risk values", () => {
    expect(parseFilters({ status: ["live", "nope"], risk: ["high", "safe"] })).toEqual({
      status: ["live"],
      risk: ["high"],
      chain: undefined,
    });
  });
});

describe("parseTab", () => {
  it("accepts the three tabs and falls back to live_now", () => {
    expect(parseTab("live_now")).toBe("live_now");
    expect(parseTab("early_bets")).toBe("early_bets");
    expect(parseTab("ended")).toBe("ended");
    expect(parseTab("x")).toBe("live_now");
    expect(parseTab("ENDED")).toBe("live_now");
    expect(parseTab("")).toBe("live_now");
    expect(parseTab(undefined)).toBe("live_now");
  });
});

describe("parseCapital", () => {
  it("accepts all, free and deposit and falls back to all", () => {
    expect(parseCapital("free")).toBe("free");
    expect(parseCapital("deposit")).toBe("deposit");
    expect(parseCapital("all")).toBe("all");
    expect(parseCapital("x")).toBe("all");
    expect(parseCapital("unknown")).toBe("all");
    expect(parseCapital(undefined)).toBe("all");
  });
});

describe("capitalLabel", () => {
  it.each([
    ["deposit", 1000, "Butuh $1.000+"],
    ["deposit", 50, "Butuh $50+"],
    ["deposit", 1234.6, "Butuh $1.235+"],
    ["deposit", 2500000, "Butuh $2.500.000+"],
    ["deposit", null, "Butuh $"],
    ["deposit", 0, "Butuh $"],
    ["deposit", Number.NaN, "Butuh $"],
    ["free", null, "Gratis"],
    ["free", 100, "Gratis"],
    ["unknown", null, "Modal belum jelas"],
    ["unknown", 100, "Modal belum jelas"],
  ] as const)("capitalLabel(%s, %s)", (capital, minUsd, want) => {
    expect(capitalLabel(capital, minUsd)).toBe(want);
  });
});

describe("checkedLabel", () => {
  // 2026-10-10T12:00Z is 19:00 WIB on 10 October. The pipeline runs at 23:00 UTC, which is 06:00 WIB the next day.
  const now = new Date("2026-10-10T12:00:00Z");
  it.each([
    ["this morning's 06:00 WIB run (the previous day in UTC)", "2026-10-09T23:00:00Z", "Dicek hari ini"],
    ["a minute ago", "2026-10-10T11:59:00Z", "Dicek hari ini"],
    ["a clock slightly ahead", "2026-10-10T12:05:00Z", "Dicek hari ini"],
    ["yesterday in WIB", "2026-10-09T05:00:00Z", "Dicek kemarin"],
    ["two WIB days ago, 44 hours", "2026-10-08T16:00:00Z", "Dicek 2 hari lalu"],
    ["exactly 48 hours", "2026-10-08T12:00:00Z", "Dicek 2 hari lalu"],
    ["just over 48 hours", "2026-10-08T11:59:00Z", "Belum dicek lagi sejak 8 Okt"],
    ["three days ago", "2026-10-07T12:00:00Z", "Belum dicek lagi sejak 7 Okt"],
    ["last year", "2025-12-30T12:00:00Z", "Belum dicek lagi sejak 30 Des 2025"],
  ])("%s", (_, at, want) => {
    expect(checkedLabel(new Date(at), now, false)).toBe(want);
  });

  it("shows a frozen project's last check as a date, however old", () => {
    expect(checkedLabel(new Date("2026-09-28T03:00:00Z"), now, true)).toBe("Last check 28 Sep");
    expect(checkedLabel(new Date("2026-10-10T11:00:00Z"), now, true)).toBe("Last check 10 Okt");
    expect(checkedLabel(new Date("2025-06-01T03:00:00Z"), now, true)).toBe("Last check 1 Jun 2025");
  });
});

describe("isCheckFrozen (ruling 6: an ended project stops being re-checked 90 days after it ended)", () => {
  // The pipeline scores an ended project while ended_on >= the UTC day 90 days back (pipeline ENDED_SCORING_DAYS).
  // 2026-10-10 minus 90 days is 2026-07-12.
  const now = new Date("2026-10-10T12:00:00Z");
  it.each([
    ["ended 90 days ago: still re-checked", "ended", "2026-07-12", false],
    ["ended 91 days ago: frozen", "ended", "2026-07-11", true],
    ["ended last week", "ended", "2026-10-03", false],
    ["ended a year ago", "ended", "2025-09-01", true],
    ["ended tab without an end date", "ended", null, false],
    ["an old end date outside the ended tab", "live_now", "2025-09-01", false],
    ["early bets", "early_bets", null, false],
  ] as const)("%s", (_, tab, endedOn, want) => {
    expect(isCheckFrozen(tab, endedOn, now)).toBe(want);
  });

  it("a frozen ended row reads Last check, a recent one keeps Dicek", () => {
    const checkedAt = new Date("2026-04-01T23:00:00Z");
    expect(checkedLabel(checkedAt, now, isCheckFrozen("ended", "2026-03-20", now))).toBe("Last check 2 Apr");
    expect(checkedLabel(new Date("2026-10-09T23:00:00Z"), now, isCheckFrozen("ended", "2026-10-01", now))).toBe(
      "Dicek hari ini",
    );
  });
});

describe("isCheckStale", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("is stale only past 48 hours, like checkedLabel", () => {
    expect(isCheckStale(new Date("2026-10-08T12:00:00Z"), now)).toBe(false);
    expect(isCheckStale(new Date("2026-10-08T11:59:00Z"), now)).toBe(true);
  });
});

describe("endedLabel", () => {
  it("writes the end date as Ended {tanggal}, in UTC whatever the server zone", () => {
    expect(endedLabel("2025-01-15")).toBe("Ended 15 Jan 2025");
    expect(endedLabel("2026-10-05")).toBe("Ended 5 Okt 2026");
  });
});

describe("compactUsd", () => {
  it.each([
    [45_000_000, "45 jt"],
    [210_400_000, "210,4 jt"],
    [1_250_000_000, "1,3 M"],
    [850_000, "850 rb"],
    [999, "999"],
  ])("%s -> %s", (n, want) => {
    expect(compactUsd(n)).toBe(want);
  });
});

describe("parseCuratedFilters", () => {
  const sp = { status: "live", risk: "low", chain: "Base", worth: ["high", "nope", "low"], modal: "free", sort: "worth" };
  it("gives members the worth filter and the capital option", () => {
    expect(parseCuratedFilters(sp, true)).toEqual({
      status: ["live"],
      risk: ["low"],
      chain: "base",
      worth: ["high", "low"],
      capital: "free",
    });
  });

  it("drops worth for visitors, so ?worth=high never reaches a query (#45)", () => {
    expect(parseCuratedFilters(sp, false)).toEqual({ status: ["live"], risk: ["low"], chain: "base", capital: "free" });
  });

  it("reads an unknown modal as all", () => {
    expect(parseCuratedFilters({ modal: "lots" }, true).capital).toBe("all");
  });
});

describe("curatedHref", () => {
  it("always names the tab, keeps every filter and leaves out modal=all and page 1", () => {
    expect(curatedHref("early_bets", { capital: "all" })).toBe("/airdrops?tab=early_bets");
    expect(
      curatedHref(
        "ended",
        { status: ["live", "ended"], risk: ["high"], chain: "base", worth: ["high"], capital: "free" },
        3,
      ),
    ).toBe("/airdrops?tab=ended&status=live&status=ended&risk=high&chain=base&worth=high&modal=free&page=3");
  });
});

describe("notCuratedReason", () => {
  it("is null for a project whose latest curation passed, in any tab, so no banner and no noindex", () => {
    expect(notCuratedReason({ passed: true, publicFailReason: null })).toBeNull();
    // A project that passed and then ended is not failed (#40); a stray reason on a passed row is not shown either.
    expect(notCuratedReason({ passed: true, publicFailReason: "Risiko tinggi" })).toBeNull();
  });

  it("is the public fail reason of a curation that did not pass", () => {
    expect(notCuratedReason({ passed: false, publicFailReason: "Risiko tinggi" })).toBe("Risiko tinggi");
  });

  it("says belum dinilai when there is no curation at all", () => {
    expect(notCuratedReason(null)).toBe("belum dinilai");
  });

  it("does not claim belum dinilai for a failed curation without a stored reason", () => {
    expect(notCuratedReason({ passed: false, publicFailReason: null })).toBe("alasannya belum tercatat");
    expect(notCuratedReason({ passed: false, publicFailReason: "   " })).toBe("alasannya belum tercatat");
  });
});

describe("logo fallback tile", () => {
  it.each([
    ["Demo Protocol", "D"],
    ["  zkSync Era", "Z"],
    ["$PUMP", "P"],
    ["1inch", "1"],
    ["éclair", "É"],
    ["🚀 Rocket", "R"],
    ["$$$", "$"],
    ["", "?"],
  ])("letter of %j is %s", (name, letter) => {
    expect(logoLetter(name)).toBe(letter);
  });

  it("picks the tile colour from the slug: the same slug always gets the same one, and slugs spread over all six", () => {
    // Sum of the UTF-16 code units modulo 6: "a" = 97 -> 1, "ab" = 195 -> 3, "" -> 0.
    expect(logoTone("")).toBe("ink");
    expect(logoTone("a")).toBe("pass");
    expect(logoTone("ab")).toBe("caution");
    expect(logoTone("demo")).toBe(logoTone("demo"));
    const tones = new Set(["a", "b", "c", "d", "e", "f"].map(logoTone));
    expect(tones).toEqual(new Set(["ink", "pass", "ended", "caution", "accent", "ink-2"]));
  });
});

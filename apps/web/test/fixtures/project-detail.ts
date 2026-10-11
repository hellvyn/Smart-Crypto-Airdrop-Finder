// A complete ProjectDetail for component tests: a passing, low-risk project whose every check ran, with nothing
// found. Tests override what they look at.
import type { StoredAnalyst } from "@saf/core";
import type { DetailCheck, ProjectDetail } from "@/lib/view";

export const SOURCE_A = "https://airdrops.io/nebula/";
export const SOURCE_B = "https://t.me/airdrops_io/101";

export function check(id: DetailCheck["id"], over: Partial<DetailCheck> = {}): DetailCheck {
  return { id, ran: true, detail: null, flagged: false, ...over };
}

/** Every check ran; the key checks and two advanced ones carry a detail, as the pipeline stores them (#53). */
export function allChecks(): DetailCheck[] {
  return [
    check("dangerous_asks", { detail: { sources: 4 } }),
    check("phishing_list", { detail: { checked: 8, hits: 0 } }),
    check("domain_age", { detail: { domain: "nebula.example", ageDays: 820 } }),
    check("lookalike", { detail: { compared: 1240 } }),
    check("token_security", { ran: false }),
    check("contract_verified", { ran: false }),
    check("hack_history", { detail: { count: 0 } }),
    check("corroboration", { detail: { sources: 3 } }),
    check("ai_review"),
  ];
}

export function analyst(over: Partial<StoredAnalyst> = {}): StoredAnalyst {
  return {
    verdict: "garap",
    confidence: "sedang",
    points: [
      {
        text: "Alokasi buat community udah ditulis di docs resmi.",
        quote: "10% of supply is reserved for the community",
        source_url: SOURCE_A,
      },
    ],
    effort: { minutes_per_day: 10, capital_usd_min: 100, note: "Butuh volume trading tiap hari." },
    steps_id: [],
    ...over,
  };
}

export function projectDetail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    slug: "nebula",
    name: "Nebula Perps",
    status: "live",
    riskLevel: "low",
    chains: ["arbitrum"],
    nextDeadline: null,
    lastSeen: "2026-10-09T00:00:00Z",
    tokenSymbol: null,
    conflict: false,
    risk: { level: "low", reasons: [], checks: allChecks(), computedAt: "2026-10-09T23:00:00Z" },
    curation: {
      passed: true,
      worthLevel: null,
      tab: "live_now",
      reasons: null,
      publicFailReason: null,
      endedOn: null,
      checkedAt: "2026-10-09T23:00:00Z",
    },
    signals: [],
    analyst: null,
    scamFlags: null,
    contradictions: [],
    steps: [],
    facts: [],
    evidence: [],
    sourceUrls: [SOURCE_A, SOURCE_B],
    deadlines: [],
    links: [],
    claimOpenChecked: false,
    ...over,
  };
}

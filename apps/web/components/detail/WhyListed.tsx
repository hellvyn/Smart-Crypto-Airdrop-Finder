import type { CurationReason } from "@saf/core";
import { SectionCard } from "@/components/ui";
import { detail as copy, list } from "@/lib/copy";
import { compactUsd, type CuratedSignal, type EvidenceRow } from "@/lib/view";

const w = copy.why;
const MAX_REPORTED = 3;

function investorOf(v: Record<string, unknown>): string | null {
  return typeof v.investor === "string" && v.investor.trim() !== "" ? v.investor.trim() : null;
}

/**
 * The rows: verified VCs, the backers AlphaDrops reports, verified TVL, a verified CoinGecko listing, curated sources,
 * then the backers the project only claims (from the signals and the extraction facts, once per investor). Only a
 * verified signal is labelled Verified; a claimed backer is always "Klaim project, belum verified" (#41).
 */
type Row = { text: string; label: string; verified: boolean };

function rows(signals: CuratedSignal[], facts: EvidenceRow[]): Row[] {
  const out: Row[] = [];
  const vcs = new Set<string>();
  for (const s of signals) {
    const investor = investorOf(s.value);
    if (s.kind === "vc_backer" && s.verified && investor !== null && !vcs.has(investor)) {
      vcs.add(investor);
      out.push({ text: list.signals.vc(investor), label: w.verified(w.sources.vc), verified: true });
    }
  }
  const reported = new Map<string, { name: string; lead: boolean }>();
  for (const s of signals) {
    const name = s.kind === "reported_backer" ? investorOf(s.value) : null;
    if (name === null) continue;
    const known = reported.get(name.toLowerCase());
    if (known) known.lead ||= s.value.lead === true;
    else reported.set(name.toLowerCase(), { name, lead: s.value.lead === true });
  }
  if (reported.size > 0) {
    const all = [...reported.values()];
    const ordered = [...all.filter((r) => r.lead), ...all.filter((r) => !r.lead)];
    const names = ordered.slice(0, MAX_REPORTED).map((r) => (r.lead ? list.signals.lead(r.name) : r.name));
    if (ordered.length > MAX_REPORTED) names.push(list.signals.more);
    out.push({ text: list.signals.reported(names.join(", ")), label: w.reportedLabel, verified: false });
  }
  const tvls = signals.flatMap((s) =>
    s.kind === "tvl" && s.verified && typeof s.value.tvl_usd === "number" && Number.isFinite(s.value.tvl_usd) ? [s.value.tvl_usd] : [],
  );
  if (tvls.length > 0) out.push({ text: list.signals.tvl(compactUsd(Math.max(...tvls))), label: w.verified(w.sources.tvl), verified: true });
  if (signals.some((s) => s.kind === "coingecko_listed" && s.verified)) {
    out.push({ text: list.signals.coingecko, label: w.verified(w.sources.coingecko), verified: true });
  }
  const curated = new Set<string>();
  for (const s of signals) {
    if (s.kind !== "curated_source") continue;
    const kind = typeof s.value.source_kind === "string" ? s.value.source_kind : s.source;
    const name = Object.hasOwn(w.curatedSourceNames, kind) ? w.curatedSourceNames[kind]! : kind;
    if (curated.has(name)) continue;
    curated.add(name);
    out.push({ text: list.signals.curatedSource, label: name, verified: false });
  }
  const claimed = new Set<string>();
  const claims = [
    ...signals.filter((s) => s.kind === "claimed_backer").map((s) => ({ investor: investorOf(s.value), quote: s.value.quote })),
    ...facts.filter((f) => f.field === "claimed_backer").map((f) => ({ investor: f.value.trim() || null, quote: f.quote })),
  ];
  for (const c of claims) {
    if (c.investor === null || claimed.has(c.investor.toLowerCase())) continue;
    claimed.add(c.investor.toLowerCase());
    const quote = typeof c.quote === "string" && c.quote.trim() !== "" ? c.quote.trim() : null;
    out.push({ text: quote ? w.claimQuote(quote) : c.investor, label: w.claimedLabel, verified: false });
  }
  return out;
}

/**
 * "06 · Kenapa lolos" ("Kenapa gak lolos" when the latest curation did not pass): the signals behind the listing, each
 * with its source label, and for a member the notes of our assessment (`curations.reasons`, member-only, #55; null
 * for a visitor).
 */
export function WhyListed({
  passed,
  signals,
  facts,
  reasons,
}: {
  passed: boolean;
  signals: CuratedSignal[];
  facts: EvidenceRow[];
  reasons: CurationReason[] | null;
}) {
  const items = rows(signals, facts);
  return (
    <SectionCard number="06" title={passed ? copy.sections.why : copy.sections.whyNot}>
      {items.length === 0 ? (
        <p className="muted">{w.empty}</p>
      ) : (
        <ul className="detail-why">
          {items.map((r, i) => (
            <li key={i} data-testid="why-row">
              <b data-part="text">{r.text}</b>
              <span data-part="label" data-verified={r.verified ? "true" : undefined}>
                {r.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {reasons && reasons.length > 0 ? (
        <ul className="detail-plain-list" aria-label={w.notes}>
          {reasons.map((r, i) => (
            <li key={`${r.code}-${i}`}>{r.message}</li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

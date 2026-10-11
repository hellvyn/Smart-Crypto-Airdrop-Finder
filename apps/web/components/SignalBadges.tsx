import { Tag, type TagTone } from "@/components/ui";
import { list } from "@/lib/copy";
import { compactUsd, type CuratedSignal } from "@/lib/view";

const copy = list.signals;
/** AlphaDrops backers named in the badge; more are shown as "…". */
const MAX_REPORTED = 3;

function investorOf(s: CuratedSignal): string | null {
  const v = s.value.investor;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * The badges of the signals curation used (#41), strongest first: each verified VC ("VC: Paradigm ✓"), the backers
 * AlphaDrops reports in one badge ("Menurut AlphaDrops: a16z (lead), …"), verified TVL, a verified CoinGecko
 * listing, and "Sumber kurasi". Only a verified `vc_backer` gets "✓". Claimed backers are left out of the list row,
 * and so are unverified VC, TVL and CoinGecko signals: curation did not count them either.
 */
function signalBadges(signals: CuratedSignal[]): { text: string; tone: TagTone }[] {
  const out: { text: string; tone: TagTone }[] = [];
  const vcs = new Set<string>();
  for (const s of signals) {
    const investor = investorOf(s);
    if (s.kind === "vc_backer" && s.verified && investor !== null && !vcs.has(investor)) {
      vcs.add(investor);
      out.push({ text: copy.vc(investor), tone: "verified" });
    }
  }

  const reported = signals
    .filter((s) => s.kind === "reported_backer" && investorOf(s) !== null)
    .map((s) => ({ name: investorOf(s) as string, lead: s.value.lead === true }));
  if (reported.length > 0) {
    const ordered = [...reported.filter((r) => r.lead), ...reported.filter((r) => !r.lead)];
    const names = ordered.slice(0, MAX_REPORTED).map((r) => (r.lead ? copy.lead(r.name) : r.name));
    if (ordered.length > MAX_REPORTED) names.push(copy.more);
    out.push({ text: copy.reported(names.join(", ")), tone: "reported" });
  }

  const tvls = signals.flatMap((s) =>
    s.kind === "tvl" && s.verified && typeof s.value.tvl_usd === "number" && Number.isFinite(s.value.tvl_usd)
      ? [s.value.tvl_usd]
      : [],
  );
  if (tvls.length > 0) out.push({ text: copy.tvl(compactUsd(Math.max(...tvls))), tone: "plain" });
  if (signals.some((s) => s.kind === "coingecko_listed" && s.verified)) out.push({ text: copy.coingecko, tone: "plain" });
  if (signals.some((s) => s.kind === "curated_source")) out.push({ text: copy.curatedSource, tone: "plain" });
  return out;
}

export function SignalBadges({ signals }: { signals: CuratedSignal[] }) {
  const badges = signalBadges(signals);
  if (badges.length === 0) return null;
  return (
    <p className="badges signal-badges">
      {badges.map((b) => (
        <Tag key={b.text} tone={b.tone} data-testid="signal">
          {b.text}
        </Tag>
      ))}
    </p>
  );
}

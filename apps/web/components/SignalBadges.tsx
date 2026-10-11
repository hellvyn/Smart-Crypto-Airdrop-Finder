import { Tag, type TagTone } from "@/components/ui";
import { investorOf, reportedBackersText } from "@/lib/backers";
import { list } from "@/lib/copy";
import { compactUsd, type CuratedSignal } from "@/lib/view";

const copy = list.signals;

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

  const reported = reportedBackersText(signals);
  if (reported !== null) out.push({ text: reported, tone: "reported" });

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

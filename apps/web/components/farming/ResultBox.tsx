import { submitResultForm, submitShareAnonymous } from "@/app/(app)/garapan/actions";
import { ExternalLink } from "@/components/ExternalLink";
import { Button } from "@/components/ui";
import { garapan as copy } from "@/lib/copy";
import type { FarmingResult, MemberAverage } from "@/lib/farming";
import { formatShortDay, formatTokens, formatUsd, plainAmount } from "./format";

const r = copy.result;

interface Props {
  projectId: string;
  projectName: string;
  tokenSymbol: string | null;
  result: FarmingResult | null;
  average: MemberAverage | null;
  /** The member's local today: the latest claim date the form offers. */
  today: string;
}

/**
 * Credit for the price data, required by the CoinGecko Demo plan. Prices come from CoinGecko or, as the fallback,
 * DefiLlama; which one priced a stored value is not recorded, so both are named.
 */
export function PriceSource({ testId }: { testId?: string }) {
  const s = copy.priceSource;
  return (
    <p className="farm-price-source" data-testid={testId}>
      {s.label} <ExternalLink href={s.coingeckoUrl}>{s.coingecko}</ExternalLink>,{" "}
      <ExternalLink href={s.defillamaUrl}>{s.defillama}</ExternalLink>
    </p>
  );
}

/**
 * Amount and claim date with "Simpan", and "Gak dapet" in a form of its own, so it saves a result without reward
 * whatever the required fields hold.
 */
function ResultForm({ projectId, today, result }: { projectId: string; today: string; result: FarmingResult | null }) {
  return (
    <div className="farm-result-forms">
      <form action={submitResultForm} className="farm-result-form">
        <input type="hidden" name="from" value="garapan" />
        <input type="hidden" name="projectId" value={projectId} />
        <div className="farm-result-fields">
          <label>
            {r.amountLabel}
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder={r.amountPlaceholder}
              required
              defaultValue={result?.amount != null ? plainAmount(result.amount) : undefined}
            />
          </label>
          <label>
            {r.dateLabel}
            <input name="claimedOn" type="date" max={today} required defaultValue={result?.claimedOn ?? undefined} />
          </label>
        </div>
        <Button variant="primary" type="submit">
          {r.save}
        </Button>
      </form>
      <form action={submitResultForm} className="farm-result-none">
        <input type="hidden" name="from" value="garapan" />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="noReward" value="1" />
        <Button variant="secondary" type="submit">
          {r.noReward}
        </Button>
      </form>
    </div>
  );
}

/** "≈ $412 waktu claim (7 Okt) · sekarang ≈ $380", without the second part when today's price is unknown. */
function valueLine(result: FarmingResult): string | null {
  if (result.usdAtClaim === null || result.claimedOn === null) return null;
  const atClaim = r.valueAtClaim(formatUsd(result.usdAtClaim), formatShortDay(result.claimedOn));
  return result.usdNow === null ? atClaim : `${atClaim} · ${r.valueNow(formatUsd(result.usdNow))}`;
}

/**
 * The airdrop result of an ended project on "Garapan saya" (mockup CGarapan, #51): the form "Dapet berapa dari
 * airdrop ini?" until the member enters one, then "Hasil kamu" with its USD value, "Ubah", the anonymous-sharing
 * opt-in and, once 5 members share, their average.
 */
export function ResultBox({ projectId, projectName, tokenSymbol, result, average, today }: Props) {
  const titleId = `farm-${projectId}-result`;
  if (!result) {
    return (
      <section className="farm-result" aria-labelledby={titleId}>
        <h3 id={titleId} className="ui-display farm-group-title">
          {r.askTitle}
        </h3>
        <p className="farm-result-note">{r.askNote}</p>
        <ResultForm projectId={projectId} today={today} result={null} />
      </section>
    );
  }

  const value = result.noReward ? null : valueLine(result);
  const shownAverage = average ? r.average(projectName, formatUsd(average.avgUsd), average.contributors) : null;
  return (
    <section className="farm-result" data-saved="true" aria-labelledby={titleId}>
      <div className="farm-result-head">
        <h3 id={titleId} className="ui-display farm-group-title">
          {r.title}
        </h3>
        <details className="farm-result-edit">
          <summary>{r.edit}</summary>
          <ResultForm projectId={projectId} today={today} result={result} />
        </details>
      </div>
      <p className="ui-display farm-result-amount">
        {result.noReward || result.amount === null ? r.noReward : r.amount(formatTokens(result.amount), tokenSymbol)}
      </p>
      {result.noReward ? null : value ? (
        <p className="farm-result-value">{value}</p>
      ) : (
        <p className="farm-result-note">{r.priceMissing}</p>
      )}
      {shownAverage ? <p className="farm-result-note">{shownAverage}</p> : null}
      <form action={submitShareAnonymous} className="farm-share-form">
        <input type="hidden" name="from" value="garapan" />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="share" value={result.shareAnonymous ? "0" : "1"} />
        <button type="submit" role="checkbox" aria-checked={result.shareAnonymous} className="farm-check farm-share">
          <span className="farm-box" aria-hidden="true">
            {result.shareAnonymous ? "✓" : ""}
          </span>
          <span className="farm-share-text">{r.share}</span>
        </button>
      </form>
      {value || shownAverage ? <PriceSource /> : null}
    </section>
  );
}

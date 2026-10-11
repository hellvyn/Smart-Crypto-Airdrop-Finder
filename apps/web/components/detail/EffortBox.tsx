import type { StoredAnalyst } from "@saf/core";
import { MemberOnly, SectionCard } from "@/components/ui";
import { detail as copy } from "@/lib/copy";
import { sourceName } from "@/lib/detail";
import type { EvidenceRow } from "@/lib/view";

const e = copy.effort;
const USD = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** What each source says about effort: its difficulty and cost ratings and the capital it asks for. */
function sourceSays(facts: EvidenceRow[]): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const f of facts) {
    const rating = f.field.startsWith("source_rating:") ? f.field.slice("source_rating:".length) : null;
    if (rating === "difficulty" || rating === "cost") {
      out.push({ name: e.ratingNames[rating], text: e.rating(sourceName(f.sourceUrl), f.value) });
    } else if (f.field === "capital_required" && Object.hasOwn(e.capitalWords, f.value)) {
      out.push({ name: e.ratingNames.capital, text: e.rating(sourceName(f.sourceUrl), e.capitalWords[f.value]!) });
    }
  }
  return out;
}

/**
 * "05 · Estimasi effort" (member-only, #45, #46): the AI's minutes per day and starting capital with its note, beside
 * what each source rates ("airdrops.io: Easy"). A visitor gets the box with "Member only" only.
 */
export function EffortBox({ member, analyst, facts }: { member: boolean; analyst: StoredAnalyst | null; facts: EvidenceRow[] }) {
  const title = copy.sections.effort;
  if (!member) {
    return (
      <SectionCard number="05" title={title} badge={copy.aiLabel}>
        <MemberOnly title={title} />
      </SectionCard>
    );
  }
  const says = sourceSays(facts);
  const minutes = analyst?.effort.minutes_per_day ?? null;
  const capital = analyst?.effort.capital_usd_min ?? null;
  return (
    <SectionCard number="05" title={title} badge={copy.aiLabel}>
      {analyst === null ? (
        <p className="muted">{copy.aiUnavailable}</p>
      ) : (
        <>
          <dl className="detail-effort">
            <div>
              <dt className="ui-display">{minutes === null ? e.unknown : e.minutes(minutes)}</dt>
              <dd>{e.minutesLabel}</dd>
            </div>
            <div>
              <dt className="ui-display">{capital === null ? e.unknown : capital === 0 ? e.free : e.capital(USD.format(capital))}</dt>
              <dd>{e.capitalLabel}</dd>
            </div>
          </dl>
          {analyst.effort.note ? <p>{analyst.effort.note}</p> : null}
        </>
      )}
      {says.length > 0 ? (
        <ul className="detail-plain-list" aria-label={e.sourcesLabel}>
          {says.map((r, i) => (
            <li key={i}>
              <span className="muted">{r.name}</span> <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

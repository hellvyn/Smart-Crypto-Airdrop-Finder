import Link from "next/link";
import { BriefingFold } from "@/components/BriefingFold";
import { MAX_GARAPAN_DEADLINES, wibDay, type Briefing, type GarapanDeadline } from "@/lib/briefing";
import { changeText, type ChangeFeed } from "@/lib/changes";
import { briefing as copy, changes as changesCopy } from "@/lib/copy";
import { dayLabel, deadlineKindLabel } from "@/lib/view";

/** The most watchlist changes the box lists; the panel below it has the rest. */
const MAX_CHANGES = 3;

const projectHref = (slug: string): string => `/projects/${encodeURIComponent(slug)}`;

/**
 * "Briefing pagi · {tanggal}" above the list (coach and briefing spec §5.6), for members only (the page does not render
 * it for a visitor). The AI part is the latest stored briefing, with its own date when it is not today's; the personal
 * part is the member's watchlist changes and the nearest deadlines of what they farm. Nothing to show: no box.
 */
export function BriefingBox({
  briefing,
  feed,
  garapan,
  now,
}: {
  briefing: Briefing | null;
  feed: ChangeFeed;
  garapan: GarapanDeadline[];
  now: Date;
}) {
  const items = briefing?.items ?? [];
  const changes = feed.changes.slice(0, MAX_CHANGES);
  const deadlines = garapan.slice(0, MAX_GARAPAN_DEADLINES);
  if (items.length === 0 && changes.length === 0 && deadlines.length === 0) return null;

  return (
    <BriefingFold title={copy.heading(dayLabel(briefing?.day ?? wibDay(now)))}>
      {items.length > 0 ? (
        <ul className="briefing-list" aria-label={copy.itemsLabel}>
          {items.map((item) => (
            <li key={item.projectId}>
              <Link href={projectHref(item.slug)}>{item.name}</Link> <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {changes.length > 0 ? (
        <ul className="briefing-list" aria-label={copy.changesLabel}>
          {changes.map((item, i) => (
            <li key={`${item.kind}-${item.at}-${i}`}>
              {item.kind === "curated_in_many" ? (
                <Link href="/watchlist">{changesCopy.curatedInMany(item.count)}</Link>
              ) : (
                <>
                  <Link href={projectHref(item.project.slug)}>{item.project.name}</Link> <span>{changeText(item)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {deadlines.length > 0 ? (
        <ul className="briefing-list" aria-label={copy.garapanLabel}>
          {deadlines.map((d) => {
            const date = dayLabel(d.date);
            return (
              <li key={`${d.slug}-${d.kind}-${d.date}`}>
                <Link href={projectHref(d.slug)}>{d.name}</Link>{" "}
                <span>{copy.deadline(deadlineKindLabel(d.kind), d.approximate ? copy.approximateDate(date) : date)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </BriefingFold>
  );
}

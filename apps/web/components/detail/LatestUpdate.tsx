import { ExternalLink } from "../ExternalLink";
import { detail as copy } from "@/lib/copy";
import { formatCalendarDay, linkableSource, newestUpdate } from "@/lib/detail";
import type { EvidenceRow } from "@/lib/view";

/** "Update terbaru" (side box): the newest update a source mentions, with its date and source. */
export function LatestUpdate({ facts, sourceUrls }: { facts: EvidenceRow[]; sourceUrls: string[] }) {
  const update = newestUpdate(facts);
  const source = update ? linkableSource(update.sourceUrl, sourceUrls) : null;
  return (
    <section className="detail-side-box" aria-labelledby="latest-update-title">
      <h2 id="latest-update-title" className="detail-side-title">
        {copy.sections.latestUpdate}
      </h2>
      {update === null ? (
        <p className="muted">{copy.latestUpdate.empty}</p>
      ) : (
        <>
          <p>{update.quote}</p>
          <p className="detail-quote">
            {update.value ? formatCalendarDay(update.value) : null}
            {update.value && source ? " · " : null}
            {source ? <ExternalLink href={source}>{copy.latestUpdate.source}</ExternalLink> : null}
          </p>
        </>
      )}
    </section>
  );
}

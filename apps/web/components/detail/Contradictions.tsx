import { ExternalLink } from "../ExternalLink";
import { SectionCard } from "@/components/ui";
import { detail as copy } from "@/lib/copy";
import { linkableSource } from "@/lib/detail";
import type { Contradiction, EvidenceRow } from "@/lib/view";

function Quote({ quote, url, n, sourceUrls }: { quote: string; url: string; n: number; sourceUrls: string[] }) {
  const source = linkableSource(url, sourceUrls);
  return (
    <p className="detail-quote">
      {`"${quote}"`}
      {source ? (
        <>
          {" · "}
          <ExternalLink href={source}>{copy.contradictions.source(n)}</ExternalLink>
        </>
      ) : null}
    </p>
  );
}

/**
 * "02 · Sumber yang beda cerita": the contradictions the AI found between sources or inside one (public, A3), each
 * with both quotes, and the status quotes of sources that disagree on the status (`projects.conflict`). AI text is
 * plain text; a quote's URL is linked only when it is one of the project's source documents.
 */
export function Contradictions({
  items,
  statusQuotes,
  sourceUrls,
}: {
  items: Contradiction[];
  statusQuotes: EvidenceRow[];
  sourceUrls: string[];
}) {
  return (
    <SectionCard number="02" title={copy.sections.contradictions}>
      {items.length === 0 && statusQuotes.length === 0 ? <p className="muted">{copy.contradictions.empty}</p> : null}
      {items.map((item, i) => (
        <div key={i} className="detail-contradiction">
          <p>{item.explanation}</p>
          <Quote quote={item.quote_a} url={item.url_a} n={1} sourceUrls={sourceUrls} />
          <Quote quote={item.quote_b} url={item.url_b} n={2} sourceUrls={sourceUrls} />
        </div>
      ))}
      {statusQuotes.length > 0 ? (
        <div className="detail-contradiction">
          <p>{copy.contradictions.statusText}</p>
          <ul className="detail-plain-list" aria-label={copy.contradictions.statusQuotes}>
            {statusQuotes.map((e, i) => (
              <li key={i}>
                <Quote quote={e.quote} url={e.sourceUrl} n={i + 1} sourceUrls={sourceUrls} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

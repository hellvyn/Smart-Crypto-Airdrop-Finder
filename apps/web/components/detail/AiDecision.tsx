import type { StoredAnalyst } from "@saf/core";
import { ExternalLink } from "../ExternalLink";
import { MemberOnly, SectionCard } from "@/components/ui";
import { detail as copy } from "@/lib/copy";
import { linkableSource } from "@/lib/detail";

const LETTERS = "ABCDE";

/**
 * "01 · AI verdict" (#45, #46): the Analyst's verdict, confidence and points, each with its quote. A visitor gets the box
 * with "Member only" only; the page never queries the analysis for a visitor. AI text is plain text, and a point's
 * source becomes a link only when it is one of the project's source documents.
 */
export function AiDecision({
  member,
  analyst,
  sourceUrls,
}: {
  member: boolean;
  analyst: StoredAnalyst | null;
  sourceUrls: string[];
}) {
  const title = copy.sections.ai;
  return (
    <SectionCard number="01" title={title} badge={copy.aiLabel}>
      {!member ? (
        <MemberOnly title={title} />
      ) : analyst === null ? (
        <p className="muted">{copy.aiUnavailable}</p>
      ) : (
        <div className="detail-ai">
          <p className="detail-verdict-line">
            <span className="detail-verdict ui-display" data-verdict={analyst.verdict}>
              {copy.ai.verdict[analyst.verdict]}
            </span>
            <span>{copy.ai.confidence(analyst.confidence)}</span>
          </p>
          {analyst.points.length === 0 ? (
            <p className="muted">{copy.ai.noPoints}</p>
          ) : (
            <ol className="detail-points" aria-label={copy.ai.points}>
              {analyst.points.map((p, i) => {
                const source = linkableSource(p.source_url, sourceUrls);
                return (
                  <li key={i}>
                    <span className="detail-point-letter ui-display" aria-hidden="true">
                      {LETTERS[i] ?? String(i + 1)}
                    </span>
                    <div>
                      <p>{p.text}</p>
                      <p className="detail-quote">
                        {`"${p.quote}"`}
                        {source ? (
                          <>
                            {" · "}
                            <ExternalLink href={source}>{copy.ai.source}</ExternalLink>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </SectionCard>
  );
}

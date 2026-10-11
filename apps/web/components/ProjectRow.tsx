import Link from "next/link";
import { RiskBadge } from "./RiskBadge";
import { StatusBadge } from "./StatusBadge";
import { list, notCurated } from "@/lib/copy";
import { dayLabel, deadlineKindLabel, precisionLabel, type ProjectListItem } from "@/lib/view";

/**
 * One airdrop of a plain list (the watchlist): link, risk, status, chains and next deadline, and for a project that is
 * not on the curated list "Gak masuk list: {alasan}". The curated list on /airdrops shows cards (`ProjectCard`).
 */
export function ProjectRow({
  item,
  notCuratedReason = null,
}: {
  item: ProjectListItem;
  /** Why the project is not on the curated list (the watchlist passes it; the public reason only). */
  notCuratedReason?: string | null;
}) {
  const d = item.nextDeadline;
  const deadline = d ? `${deadlineKindLabel(d.kind)} ${dayLabel(d.date)} (${precisionLabel(d.precision)})` : list.noDeadline;

  return (
    <article className="project-row" data-testid="project-row" data-slug={item.slug}>
      <div className="project-row-main">
        <h2>
          <Link href={`/projects/${encodeURIComponent(item.slug)}`}>{item.name}</Link>
        </h2>
        <p className="badges">
          <RiskBadge level={item.riskLevel} />
          <StatusBadge status={item.status} />
        </p>
        {notCuratedReason !== null ? (
          <p className="project-row-not-curated" data-testid="not-curated">
            {notCurated.banner(notCuratedReason)}
          </p>
        ) : null}
        <p className="muted">
          <span>{item.chains.length > 0 ? item.chains.join(", ") : list.chainUnknown}</span>
          {" · "}
          <span>{deadline}</span>
        </p>
      </div>
    </article>
  );
}

import Link from "next/link";
import { RiskBadge } from "./RiskBadge";
import { StatusBadge } from "./StatusBadge";
import { deadlineKindLabel, formatDay, precisionLabel, type ProjectListItem } from "@/lib/view";

export function ProjectRow({ item }: { item: ProjectListItem }) {
  const d = item.nextDeadline;
  return (
    <article className="project-row" data-testid="project-row" data-slug={item.slug}>
      <h2>
        <Link href={`/projects/${encodeURIComponent(item.slug)}`}>{item.name}</Link>
      </h2>
      <p className="badges">
        <RiskBadge level={item.riskLevel} />
        <StatusBadge status={item.status} />
      </p>
      <p className="muted">
        <span>{item.chains.length > 0 ? item.chains.join(", ") : "Chain unknown"}</span>
        {" · "}
        <span>
          {d ? `${deadlineKindLabel(d.kind)} ${formatDay(d.date)} (${precisionLabel(d.precision)})` : "No confirmed deadline"}
        </span>
      </p>
    </article>
  );
}

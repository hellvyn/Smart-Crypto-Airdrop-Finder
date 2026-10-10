import { ExternalLink } from "./ExternalLink";
import { RiskLine } from "./RiskLine";
import { StatusBadge } from "./StatusBadge";
import {
  coverageLine,
  deadlineKindLabel,
  evidenceFieldLabel,
  formatDay,
  precisionLabel,
  safeHttpUrl,
  type ProjectDetail,
} from "@/lib/view";

type Evidence = ProjectDetail["evidence"][number];

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  info: "Info",
};

function hostOf(url: string): string {
  const safe = safeHttpUrl(url);
  return safe ? new URL(safe).hostname : url;
}

function EvidenceItem({ e }: { e: Evidence }) {
  return (
    <li>
      <p className="evidence-meta">
        <strong>{evidenceFieldLabel(e.field)}</strong> <span className="muted">· {e.value}</span>
      </p>
      <blockquote>{e.quote}</blockquote>
      <p className="muted">
        <ExternalLink href={e.sourceUrl}>{hostOf(e.sourceUrl)}</ExternalLink> · <time>{formatDay(e.at)}</time>
      </p>
    </li>
  );
}

export function ProjectDetailView({ project }: { project: ProjectDetail }) {
  // A claim URL that is not http(s) is not linkable: RiskLine hides the "Official checker" label, and the URL is
  // listed as plain text under Links instead.
  const otherLinks = project.links.filter((l) => l.kind !== "claim");
  const unsafeClaimLinks = project.links.filter((l) => l.kind === "claim" && safeHttpUrl(l.url) === null);
  const conflictEvidence = project.conflict ? project.evidence.filter((e) => e.field === "status") : [];
  const otherEvidence = project.conflict ? project.evidence.filter((e) => e.field !== "status") : project.evidence;

  return (
    <article>
      <h1>
        {project.name}
        {project.tokenSymbol ? <span className="muted"> ({project.tokenSymbol})</span> : null}
      </h1>

      <RiskLine level={project.risk?.level ?? project.riskLevel} links={project.links} testId="risk-line" />
      <p className="badges">
        <StatusBadge status={project.status} />
      </p>

      <p className="muted">
        {project.chains.length > 0 ? `Chains: ${project.chains.join(", ")}` : "Chain unknown"}
      </p>

      <section aria-labelledby="risk-heading">
        <h2 id="risk-heading">Risk</h2>
        {project.risk ? (
          <>
            <p className="muted">{coverageLine(project.risk.checks)}</p>
            {project.risk.reasons.length > 0 ? (
              <ul aria-label="Risk reasons">
                {project.risk.reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`}>
                    <strong>{SEVERITY_LABELS[r.severity] ?? r.severity} severity</strong>: <span>{r.message}</span>{" "}
                    <span className="muted">({r.source})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No risk reasons were recorded.</p>
            )}
            <p className="muted">Assessed {formatDay(project.risk.computedAt)}</p>
          </>
        ) : (
          <p className="muted">This project has not been assessed yet.</p>
        )}
      </section>

      {project.conflict ? (
        <section aria-labelledby="conflict-heading" className="banner banner-conflict">
          <h2 id="conflict-heading">Conflicting sources</h2>
          <p>Sources disagree about this airdrop&apos;s status. Treat it as unconfirmed.</p>
          <ul aria-label="Conflicting status quotes">
            {conflictEvidence.map((e, i) => (
              <EvidenceItem key={`${e.sourceUrl}-${i}`} e={e} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="deadlines-heading">
        <h2 id="deadlines-heading">Deadlines</h2>
        {project.deadlines.length > 0 ? (
          <ul>
            {project.deadlines.map((d, i) => (
              <li key={i}>
                <strong>{deadlineKindLabel(d.kind)}</strong>:{" "}
                {d.date ? `${formatDay(d.date)} (${precisionLabel(d.precision)})` : `date unknown (${precisionLabel(d.precision)})`}
                {d.text ? <span className="muted"> · {d.text}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No deadlines found.</p>
        )}
      </section>

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">Tasks</h2>
        {project.tasks.length > 0 ? (
          <ul>
            {project.tasks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No tasks found.</p>
        )}
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Links</h2>
        {otherLinks.length + unsafeClaimLinks.length > 0 ? (
          <ul>
            {[...otherLinks, ...unsafeClaimLinks].map((l) => (
              <li key={l.url}>
                <span className="muted">{l.kind}: </span>
                <ExternalLink href={l.url}>{l.url}</ExternalLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No other links found.</p>
        )}
      </section>

      <section aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence</h2>
        {otherEvidence.length > 0 ? (
          <ul aria-label="Evidence">
            {otherEvidence.map((e, i) => (
              <EvidenceItem key={`${e.sourceUrl}-${e.field}-${i}`} e={e} />
            ))}
          </ul>
        ) : (
          <p className="muted">{project.conflict ? "See the conflicting quotes above." : "No evidence recorded."}</p>
        )}
      </section>
    </article>
  );
}

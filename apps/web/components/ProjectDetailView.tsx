import { ExternalLink } from "./ExternalLink";
import { RiskLine } from "./RiskLine";
import { StatusBadge } from "./StatusBadge";
import { detail as copy } from "@/lib/copy";
import {
  coverageLine,
  deadlineKindLabel,
  evidenceFieldLabel,
  formatDay,
  precisionLabel,
  safeHttpUrl,
  severityLabel,
  type ProjectDetail,
} from "@/lib/view";

type Evidence = ProjectDetail["evidence"][number];

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
  // A claim URL that is not http(s) is not linkable: RiskLine hides the official checker label, and the URL is
  // listed as plain text under Link instead.
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
        {project.chains.length > 0 ? copy.chains(project.chains) : copy.chainUnknown}
      </p>

      <section aria-labelledby="risk-heading">
        <h2 id="risk-heading">{copy.riskHeading}</h2>
        {project.risk ? (
          <>
            <p className="muted">{coverageLine(project.risk.checks)}</p>
            {project.risk.reasons.length > 0 ? (
              <ul aria-label={copy.riskReasons}>
                {project.risk.reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`}>
                    <strong>{severityLabel(r.severity)}</strong>: <span>{r.message}</span>{" "}
                    <span className="muted">({r.source})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{copy.noReasons}</p>
            )}
            <p className="muted">{copy.assessed(formatDay(project.risk.computedAt))}</p>
          </>
        ) : (
          <p className="muted">{copy.notAssessed}</p>
        )}
      </section>

      {project.conflict ? (
        <section aria-labelledby="conflict-heading" className="banner banner-conflict">
          <h2 id="conflict-heading">{copy.conflictHeading}</h2>
          <p>{copy.conflictText}</p>
          <ul aria-label={copy.conflictQuotes}>
            {conflictEvidence.map((e, i) => (
              <EvidenceItem key={`${e.sourceUrl}-${i}`} e={e} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="deadlines-heading">
        <h2 id="deadlines-heading">{copy.deadlinesHeading}</h2>
        {project.deadlines.length > 0 ? (
          <ul>
            {project.deadlines.map((d, i) => (
              <li key={i}>
                <strong>{deadlineKindLabel(d.kind)}</strong>:{" "}
                {`${d.date ? formatDay(d.date) : copy.dateUnknown} (${precisionLabel(d.precision)})`}
                {d.text ? <span className="muted"> · {d.text}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{copy.noDeadlines}</p>
        )}
      </section>

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">{copy.tasksHeading}</h2>
        {project.tasks.length > 0 ? (
          <ul>
            {project.tasks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{copy.noTasks}</p>
        )}
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading">{copy.linksHeading}</h2>
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
          <p className="muted">{copy.noLinks}</p>
        )}
      </section>

      <section aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">{copy.evidenceHeading}</h2>
        {otherEvidence.length > 0 ? (
          <ul aria-label={copy.evidenceHeading}>
            {otherEvidence.map((e, i) => (
              <EvidenceItem key={`${e.sourceUrl}-${e.field}-${i}`} e={e} />
            ))}
          </ul>
        ) : (
          <p className="muted">{project.conflict ? copy.seeConflict : copy.noEvidence}</p>
        )}
      </section>
    </article>
  );
}

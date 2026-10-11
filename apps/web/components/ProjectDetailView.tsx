import { KEY_CHECKS } from "@saf/core";
import { ExternalLink } from "./ExternalLink";
import { StatusBadge } from "./StatusBadge";
import { AiDecision } from "./detail/AiDecision";
import { Contradictions } from "./detail/Contradictions";
import { EffortBox } from "./detail/EffortBox";
import { LatestUpdate } from "./detail/LatestUpdate";
import { SafetyBox } from "./detail/SafetyBox";
import { StepsList } from "./detail/StepsList";
import { WhyListed } from "./detail/WhyListed";
import { Stamp, Tag, WorthBadge } from "@/components/ui";
import { detail as copy, labels, landing, list } from "@/lib/copy";
import { formatCalendarDay, isCheckedKind, keyParameterValue, summaryDeadlines, summaryLinks, wibStampDay } from "@/lib/detail";
import {
  checkedLabel,
  deadlineKindLabel,
  endedLabel,
  isCheckFrozen,
  isCheckStale,
  notCuratedReason,
  precisionLabel,
  riskLabel,
  safeHttpUrl,
  type ProjectDetail,
} from "@/lib/view";

/** "Ringkasan" (side box): chain, deadlines, the project's own links and the key parameters a source states. */
function Summary({ project }: { project: ProjectDetail }) {
  const s = copy.summary;
  const ownLinks = summaryLinks(project.links.filter((l) => !isCheckedKind(l.kind)));
  const deadlines = summaryDeadlines(project.deadlines);
  // A key parameter that a deadline row already states (TGE) is left out; the same date would show twice.
  const keyParameters = project.facts.filter(
    (f) => f.field.startsWith("key_parameter:") && !(f.field === "key_parameter:tge" && deadlines.some((d) => d.kind === "tge")),
  );
  return (
    <section className="detail-side-box" aria-labelledby="summary-title">
      <h2 id="summary-title" className="detail-side-title">
        {copy.sections.summary}
      </h2>
      <ul className="detail-summary">
        <li>{project.chains.length > 0 ? copy.chains(project.chains) : copy.chainUnknown}</li>
        {deadlines.map((d, i) => (
          <li key={`d-${i}`}>
            {s.deadline(deadlineKindLabel(d.kind), d.date ? formatCalendarDay(d.date) : s.dateUnknown, precisionLabel(d.precision))}
          </li>
        ))}
        {ownLinks.map((l) => (
          <li key={l.url}>
            {l.label}: <ExternalLink href={l.url}>{safeHttpUrl(l.url) ? l.text : l.url}</ExternalLink>
          </li>
        ))}
        {keyParameters.map((f, i) => {
          const name = f.field.slice("key_parameter:".length);
          return (
            <li key={`k-${i}`}>
              {s.keyParameter(Object.hasOwn(s.keyParameters, name) ? s.keyParameters[name]! : name, keyParameterValue(f.value))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The project page (Plan 6 Task 5, spec §7.2, mockup CProject): the head, then 01 AI verdict, 02 sources that
 * disagree, 03 steps, 04 security check, 05 effort, 06 why it is listed, and the side boxes "Ringkasan" and "Update
 * terbaru". A visitor (#45) gets no worth level and "Member only" in the AI verdict and effort boxes; their data is
 * never queried for a visitor (lib/queries.ts). Every AI text is plain text. Steps are `project.steps` for every
 * reader (the grounded `tasks.text_id`, else the source step), never the Analyst's raw `steps_id` (G5 C1).
 */
export function ProjectDetailView({
  project,
  member,
  canExplain = false,
  now,
}: {
  project: ProjectDetail;
  member: boolean;
  /** The project is among this member's Coach candidates: only then do the steps offer "Jelasin langkah ini". */
  canExplain?: boolean;
  now: Date;
}) {
  const { risk, curation } = project;
  const keyChecksRan = risk ? risk.checks.filter((c) => c.ran && (KEY_CHECKS as readonly string[]).includes(c.id)).length : 0;
  const checkedAt = curation ? new Date(curation.checkedAt) : null;
  const frozen = curation?.tab ? isCheckFrozen(curation.tab, curation.endedOn, now) : false;
  const level = risk?.level ?? project.riskLevel;

  return (
    <article className="detail">
      <header className="detail-head">
        <div className="detail-head-text">
          <h1 className="ui-display detail-title">
            {project.name}
            {project.tokenSymbol ? <span className="muted"> ({project.tokenSymbol})</span> : null}
          </h1>
          <p className="badges">
            <StatusBadge status={project.status} />
            {curation?.tab === "ended" && curation.endedOn ? (
              <span className="detail-ended" data-testid="ended-on">
                {endedLabel(curation.endedOn)}
              </span>
            ) : null}
            <span className="detail-risk" data-testid="risk-head" data-level={level ?? "none"}>
              {copy.riskHead(riskLabel(level))}
            </span>
            {project.claimOpenChecked ? <Tag tone="claimOpen">{list.claimOpen}</Tag> : null}
            {checkedAt ? (
              <span
                className="detail-checked"
                data-testid="checked"
                data-tone={!frozen && isCheckStale(checkedAt, now) ? "warn" : undefined}
              >
                {checkedLabel(checkedAt, now, frozen)}
              </span>
            ) : null}
            {member && curation?.worthLevel ? <WorthBadge level={curation.worthLevel} /> : null}
          </p>
          {risk ? <p className="muted">{labels.keyChecks(keyChecksRan)}</p> : null}
        </div>
        {curation?.passed && keyChecksRan === 4 ? (
          <Stamp
            top={landing.stampTop}
            bottom={landing.stampBottom}
            note={wibStampDay(curation.checkedAt)}
            tone="pass"
            size="lg"
            rotate={-9}
          />
        ) : null}
      </header>

      <div className="detail-layout">
        <div className="detail-main">
          <AiDecision member={member} analyst={member ? project.analyst : null} sourceUrls={project.sourceUrls} />
          <Contradictions
            items={project.contradictions}
            statusQuotes={project.conflict ? project.evidence.filter((e) => e.field === "status") : []}
            sourceUrls={project.sourceUrls}
          />
          <StepsList steps={project.steps} links={project.links} canExplain={member && canExplain} projectId={project.id} />
          <SafetyBox
            risk={risk}
            links={project.links}
            member={member}
            scamFlags={member ? project.scamFlags : null}
          />
          <EffortBox member={member} analyst={member ? project.analyst : null} facts={project.facts} />
          <WhyListed
            passed={curation?.passed === true}
            signals={project.signals}
            facts={project.facts}
            reasons={member ? (curation?.reasons ?? null) : null}
            failReason={notCuratedReason(curation)}
          />
        </div>
        <aside className="detail-aside">
          <Summary project={project} />
          <LatestUpdate facts={project.facts} sourceUrls={project.sourceUrls} />
        </aside>
      </div>
    </article>
  );
}

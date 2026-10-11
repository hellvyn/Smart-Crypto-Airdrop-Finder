import Link from "next/link";
import { ProjectLogo } from "./ProjectLogo";
import { RiskBadge } from "./RiskBadge";
import { SignalBadges } from "./SignalBadges";
import { StatusBadge } from "./StatusBadge";
import { Tag, WorthBadge, type TagTone } from "@/components/ui";
import { labels, list, ui } from "@/lib/copy";
import {
  capitalLabel,
  checkedLabel,
  dayLabel,
  deadlineKindLabel,
  endedLabel,
  isCheckFrozen,
  isCheckStale,
  precisionLabel,
  type Capital,
  type CuratedItem,
} from "@/lib/view";

/** Capital tag tones (#52): free green, deposit plain on the member fill, unknown dashed. */
const CAPITAL_TONE: Record<Capital, TagTone> = { free: "verified", deposit: "plain", unknown: "reported" };

/**
 * One airdrop of /airdrops as a card (owner request 2026-10-11; replaces the CList row there). The whole card is a
 * single link to the project page, named by the project's name, with nothing interactive inside it. It holds the
 * logo (or a letter tile), the name, the worth level for members ("Member only" for visitors), risk, status, the
 * capital tag, the claim badge, chains and the next deadline ("Ended {tanggal}" in the ended tab), how many key
 * checks ran, when it was checked, its signals, and under an X avatar the unavatar.io credit.
 */
export function ProjectCard({ item, member, now }: { item: CuratedItem; member: boolean; now: Date }) {
  const d = item.nextDeadline;
  const deadline = d ? `${deadlineKindLabel(d.kind)} ${dayLabel(d.date)} (${precisionLabel(d.precision)})` : list.noDeadline;
  const when = item.tab === "ended" && item.endedOn ? endedLabel(item.endedOn) : deadline;
  const checkedAt = new Date(item.checkedAt);
  const frozen = isCheckFrozen(item.tab, item.endedOn, now);
  const nameId = `project-card-${item.id}`;

  return (
    <article className="project-card" data-testid="project-card" data-slug={item.slug}>
      <Link href={`/projects/${encodeURIComponent(item.slug)}`} className="project-card-link" aria-labelledby={nameId}>
        <div className="project-card-head">
          <ProjectLogo id={item.id} slug={item.slug} name={item.name} source={item.logoSource} />
          <h2 id={nameId} className="project-card-name">
            {item.name}
          </h2>
          <div className="project-card-worth">
            {member ? (
              item.worthLevel ? <WorthBadge level={item.worthLevel} /> : null
            ) : (
              <span className="project-card-member-only">{ui.memberOnly}</span>
            )}
          </div>
        </div>
        <p className="badges">
          <RiskBadge level={item.riskLevel} />
          <StatusBadge status={item.status} />
          <Tag tone={CAPITAL_TONE[item.capital]} data-capital={item.capital}>
            {capitalLabel(item.capital, item.capitalMinUsd)}
          </Tag>
          {item.claimOpenChecked ? <Tag tone="claimOpen">{list.claimOpen}</Tag> : null}
        </p>
        <p className="muted">
          <span>{item.chains.length > 0 ? item.chains.join(", ") : list.chainUnknown}</span>
          {" · "}
          <span>{when}</span>
        </p>
        <p className="project-card-checks">
          <span>{labels.keyChecks(item.keyChecksRan)}</span>
          {" · "}
          <span
            className="project-card-checked"
            data-testid="checked"
            data-tone={!frozen && isCheckStale(checkedAt, now) ? "warn" : undefined}
          >
            {checkedLabel(checkedAt, now, frozen)}
          </span>
        </p>
        <SignalBadges signals={item.signals} />
        {item.logoSource === "x_avatar" ? (
          <p className="project-card-credit" data-testid="logo-credit">
            {list.logoCredit}
          </p>
        ) : null}
      </Link>
    </article>
  );
}

import Link from "next/link";
import { RiskBadge } from "./RiskBadge";
import { SignalBadges } from "./SignalBadges";
import { StatusBadge } from "./StatusBadge";
import { Tag, WorthBadge, type TagTone } from "@/components/ui";
import { labels, list, ui } from "@/lib/copy";
import {
  capitalLabel,
  checkedLabel,
  deadlineKindLabel,
  endedLabel,
  formatDay,
  isCheckFrozen,
  isCheckStale,
  precisionLabel,
  type Capital,
  type CuratedItem,
  type ProjectListItem,
} from "@/lib/view";

/** Capital tag tones (#52): free green, deposit plain on the member fill, unknown dashed. */
const CAPITAL_TONE: Record<Capital, TagTone> = { free: "verified", deposit: "plain", unknown: "reported" };

function isCurated(item: ProjectListItem | CuratedItem): item is CuratedItem {
  return "tab" in item;
}

/**
 * One airdrop of a list. A curated row (the /airdrops tabs) also shows its capital tag, the claim badge, how many key
 * checks ran, when it was checked, its signals, and the worth level for members ("Member only" for visitors). In the
 * ended tab, "Ended {tanggal}" takes the place of the next deadline. The watchlist passes plain list items.
 */
export function ProjectRow({
  item,
  member = false,
  now = new Date(),
}: {
  item: ProjectListItem | CuratedItem;
  member?: boolean;
  now?: Date;
}) {
  const curated = isCurated(item) ? item : null;
  const d = item.nextDeadline;
  const deadline = d ? `${deadlineKindLabel(d.kind)} ${formatDay(d.date)} (${precisionLabel(d.precision)})` : list.noDeadline;
  const when = curated?.tab === "ended" && curated.endedOn ? endedLabel(curated.endedOn) : deadline;
  const checkedAt = curated ? new Date(curated.checkedAt) : null;
  const frozen = curated ? isCheckFrozen(curated.tab, curated.endedOn, now) : false;

  return (
    <article className="project-row" data-testid="project-row" data-slug={item.slug}>
      <div className="project-row-main">
        <h2>
          <Link href={`/projects/${encodeURIComponent(item.slug)}`}>{item.name}</Link>
        </h2>
        <p className="badges">
          <RiskBadge level={item.riskLevel} />
          <StatusBadge status={item.status} />
          {curated ? (
            <Tag tone={CAPITAL_TONE[curated.capital]} data-capital={curated.capital}>
              {capitalLabel(curated.capital, curated.capitalMinUsd)}
            </Tag>
          ) : null}
          {curated?.claimOpenChecked ? <Tag tone="claimOpen">{list.claimOpen}</Tag> : null}
        </p>
        <p className="muted">
          <span>{item.chains.length > 0 ? item.chains.join(", ") : list.chainUnknown}</span>
          {" · "}
          <span>{when}</span>
        </p>
        {curated && checkedAt ? (
          <>
            <p className="project-row-checks">
              <span>{labels.keyChecks(curated.keyChecksRan)}</span>
              {" · "}
              <span
                className="project-row-checked"
                data-testid="checked"
                data-tone={!frozen && isCheckStale(checkedAt, now) ? "warn" : undefined}
              >
                {checkedLabel(checkedAt, now, frozen)}
              </span>
            </p>
            <SignalBadges signals={curated.signals} />
          </>
        ) : null}
      </div>
      {curated ? (
        <div className="project-row-worth">
          {member ? (
            curated.worthLevel ? <WorthBadge level={curated.worthLevel} /> : null
          ) : (
            <span className="project-row-member-only">{ui.memberOnly}</span>
          )}
        </div>
      ) : null}
    </article>
  );
}

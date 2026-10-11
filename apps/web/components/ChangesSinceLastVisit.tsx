import Link from "next/link";
import { markChangesSeen } from "@/app/(app)/changes/actions";
import { MarkChangesSeenButton } from "@/components/MarkChangesSeenButton";
import type { ChangeFeed, ChangeItem, ChangeProject, DeadlineItem } from "@/lib/changes";
import { changes as copy } from "@/lib/copy";
import { dayLabel, deadlineKindLabel, riskLabel, statusLabel } from "@/lib/view";

function changeText(item: Exclude<ChangeItem, { kind: "curated_in_many" }>): string {
  switch (item.kind) {
    case "curated_in":
      return copy.curatedIn;
    case "curated_out":
      return copy.curatedOut;
    case "ended":
      return copy.ended;
    case "status":
      return copy.status(statusLabel(item.from), statusLabel(item.to));
    case "risk":
      return copy.risk(riskLabel(item.from), riskLabel(item.to));
  }
}

function deadlineText(item: DeadlineItem): string {
  const date = dayLabel(item.date);
  const kind = deadlineKindLabel(item.deadlineKind).toLowerCase();
  return copy.deadline(kind, item.approximate ? copy.approximateDate(date) : date);
}

function ProjectLine({ project, text }: { project: ChangeProject; text: string }) {
  return (
    <>
      <Link href={`/projects/${encodeURIComponent(project.slug)}`}>{project.name}</Link> <span>{text}</span>
    </>
  );
}

/**
 * "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7) on /airdrops and /watchlist. Two groups: what changed on the
 * member's watched projects since they last pressed "Tandai sudah dibaca" (newest first, with that button), and the
 * near deadlines, which are reminders and stay while they are near. Nothing at all when both are empty.
 */
export function ChangesSinceLastVisit({ feed }: { feed: ChangeFeed }) {
  const { changes, deadlines } = feed;
  if (changes.length === 0 && deadlines.length === 0) return null;
  return (
    <section className="changes" aria-labelledby="changes-title">
      <div className="changes-head">
        <h2 id="changes-title">{copy.heading}</h2>
        {changes.length > 0 ? (
          <form action={markChangesSeen}>
            <MarkChangesSeenButton />
          </form>
        ) : null}
      </div>
      {changes.length > 0 ? (
        <ul className="changes-list" aria-label={copy.changesLabel}>
          {changes.map((item, i) => (
            <li key={`${item.kind}-${item.at}-${i}`}>
              {item.kind === "curated_in_many" ? (
                <Link href="/watchlist">{copy.curatedInMany(item.count)}</Link>
              ) : (
                <ProjectLine project={item.project} text={changeText(item)} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {deadlines.length > 0 ? (
        <>
          <h3 id="changes-deadlines-title" className="changes-subhead">
            {copy.deadlinesHeading}
          </h3>
          <ul className="changes-list" aria-labelledby="changes-deadlines-title">
            {deadlines.map((d) => (
              <li key={`${d.project.slug}-${d.deadlineKind}-${d.date}`}>
                <ProjectLine project={d.project} text={deadlineText(d)} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import { markChangesSeen } from "@/app/(public)/airdrops/actions";
import { Button } from "@/components/ui";
import type { ChangeItem } from "@/lib/changes";
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
    case "deadline": {
      const date = dayLabel(item.date);
      const kind = deadlineKindLabel(item.deadlineKind).toLowerCase();
      return copy.deadline(kind, item.approximate ? copy.approximateDate(date) : date);
    }
  }
}

/**
 * "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7): what changed on the member's watched projects since they last
 * pressed "Tandai sudah dibaca", newest first. Nothing at all when there is no change.
 */
export function ChangesSinceLastVisit({ items }: { items: ChangeItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="changes" aria-labelledby="changes-title">
      <div className="changes-head">
        <h2 id="changes-title">{copy.heading}</h2>
        <form action={markChangesSeen}>
          <Button variant="secondary" type="submit">
            {copy.markSeen}
          </Button>
        </form>
      </div>
      <ul className="changes-list">
        {items.map((item, i) =>
          item.kind === "curated_in_many" ? (
            <li key={`${item.kind}-${item.at}`}>{copy.curatedInMany(item.count)}</li>
          ) : (
            <li key={`${item.kind}-${item.project.slug}-${item.at}-${i}`}>
              <Link href={`/projects/${encodeURIComponent(item.project.slug)}`}>{item.project.name}</Link>{" "}
              <span>{changeText(item)}</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

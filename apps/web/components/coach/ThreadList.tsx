import Link from "next/link";
import { deleteCoachThread } from "@/app/(public)/coach/actions";
import type { ThreadRow } from "@/lib/coach-view";
import { coach } from "@/lib/copy";

const copy = coach.threads;
const DATE = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });

function labelOf(thread: ThreadRow): string {
  if (thread.kind === "project") return thread.projectName ? copy.project(thread.projectName) : copy.chat;
  return thread.kind === "plan" ? copy.plan : copy.chat;
}

/** The member's threads of the last 30 days, newest first (spec §5.5). Each can be opened again or deleted. */
export function ThreadList({ threads }: { threads: ThreadRow[] }) {
  return (
    <section className="coach-threads" aria-labelledby="coach-threads-title">
      <h2 id="coach-threads-title" className="coach-section-title">
        {copy.title}
      </h2>
      {threads.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <ul className="coach-thread-list">
          {threads.map((thread) => {
            const label = labelOf(thread);
            return (
              <li key={thread.id}>
                <span className="coach-thread-label">{label}</span>
                <span className="muted">{DATE.format(new Date(thread.createdAt))}</span>
                <Link href={`/coach?thread=${thread.id}`}>{copy.open}</Link>
                <form action={deleteCoachThread}>
                  <input type="hidden" name="threadId" value={thread.id} />
                  <button type="submit" aria-label={copy.removeLabel(label)}>
                    {copy.remove}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

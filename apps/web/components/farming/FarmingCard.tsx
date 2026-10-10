import Link from "next/link";
import type { ReactNode } from "react";
import {
  submitAddTask,
  submitArchiveTask,
  submitCheck,
  submitRefresh,
  submitStopFarming,
} from "@/app/(app)/garapan/actions";
import { Button, Stamp } from "@/components/ui";
import type { FarmingCard as FarmingCardData, FarmingTask } from "@/lib/farming";
import { formatDay } from "./dates";
import { Heatmap } from "./Heatmap";

const END_LABELS = { snapshot: "snapshot", campaign_end: "akhir campaign", ended: "ended" } as const;

/** Daily tasks of the card ticked today, out of all its active daily tasks. */
export function dailyProgress(card: FarmingCardData): { done: number; total: number } {
  const daily = card.tasks.filter((t) => t.cadence === "daily");
  const ticked = new Set(card.checkedToday);
  return { done: daily.filter((t) => ticked.has(t.id)).length, total: daily.length };
}

function countdown(card: FarmingCardData): string | null {
  const { range, daysLeft } = card;
  if (range.endKind === "ended") return `Ended ${formatDay(range.end)}`;
  if (daysLeft === null || range.endKind === null) return null;
  return `Sisa ${daysLeft} hari sampai ${END_LABELS[range.endKind]}`;
}

/** The span the heatmap covers, naming its end only when that end is the deadline or the ended day itself. */
function rangeLabel(card: FarmingCardData): string {
  const { start, end, endKind, endsOn } = card.range;
  const span = `${formatDay(start)} sampai ${formatDay(end)}`;
  return endKind === null || endsOn !== end ? span : `${span} (${END_LABELS[endKind]})`;
}

/** The task's box for today: the form always sends the wanted state, so a double submit cannot undo itself. */
function CheckBox({ task, checked }: { task: FarmingTask; checked: boolean }) {
  return (
    <form action={submitCheck} className="farm-check-form">
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="done" value={checked ? "0" : "1"} />
      <button type="submit" role="checkbox" aria-checked={checked} className="farm-check">
        <span className="farm-box" aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
        <span className="farm-task-text">{task.text}</span>
      </button>
    </form>
  );
}

/** Archives, never deletes: a delete would take the task's past checks (and heatmap days) with it. */
function ArchiveButton({ task }: { task: FarmingTask }) {
  return (
    <form action={submitArchiveTask}>
      <input type="hidden" name="taskId" value={task.id} />
      <button type="submit" className="farm-archive" aria-label={`Arsipkan task: ${task.text}`}>
        Arsipkan
      </button>
    </form>
  );
}

function Group({ id, title, aside, children }: { id: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="farm-group" aria-labelledby={id}>
      <div className="farm-group-head">
        <h3 id={id} className="ui-display farm-group-title">
          {title}
        </h3>
        {aside ? <span className="farm-group-aside">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Checklist({ card }: { card: FarmingCardData }) {
  const ticked = new Set(card.checkedToday);
  const main = card.tasks.filter((t) => t.cadence === "once");
  const daily = card.tasks.filter((t) => t.cadence === "daily");
  const weekly = card.tasks.filter((t) => t.cadence === "weekly");
  const today = dailyProgress(card);
  const ids = (part: string) => `farm-${card.projectId}-${part}`;
  return (
    <>
      {main.length > 0 ? (
        <Group id={ids("main")} title="Task utama" aside={`${card.mainProgress.done}/${card.mainProgress.total} selesai`}>
          <ul className="farm-tasks">
            {main.map((task) => (
              <li key={task.id} className="farm-task">
                <CheckBox task={task} checked={ticked.has(task.id)} />
                <ArchiveButton task={task} />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      <Group id={ids("today")} title="Hari ini" aside={daily.length > 0 ? `${today.done} dari ${today.total} task hari ini` : undefined}>
        {daily.length > 0 ? (
          <ul className="farm-tasks">
            {daily.map((task) => (
              <li key={task.id} className="farm-task">
                <CheckBox task={task} checked={ticked.has(task.id)} />
                <ArchiveButton task={task} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="farm-note">Belum ada daily task. Tambah task sendiri.</p>
        )}
      </Group>
      {weekly.length > 0 ? (
        <Group id={ids("weekly")} title="Weekly">
          <ul className="farm-tasks">
            {weekly.map((task) => {
              const doneThisWeek = card.weeklyDone[task.id] === true;
              const checkedToday = ticked.has(task.id);
              return (
                <li key={task.id} className="farm-task">
                  {/* A check from an earlier day this week cannot be undone, so that task has no box. */}
                  {checkedToday || !doneThisWeek ? (
                    <CheckBox task={task} checked={checkedToday} />
                  ) : (
                    <span className="farm-task-text farm-task-plain">{task.text}</span>
                  )}
                  <span className="farm-weekly-status" data-done={doneThisWeek}>
                    {doneThisWeek ? "Minggu ini udah" : "Belum minggu ini"}
                  </span>
                  <ArchiveButton task={task} />
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
      <details className="farm-add">
        <summary>+ Tambah task sendiri</summary>
        <form action={submitAddTask} className="farm-add-form">
          <input type="hidden" name="projectId" value={card.projectId} />
          <label>
            Task
            <input name="text" required maxLength={200} />
          </label>
          <label>
            Seberapa sering
            <select name="cadence" defaultValue="daily">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="once">Sekali</option>
            </select>
          </label>
          <Button variant="secondary" type="submit">
            Tambah task
          </Button>
        </form>
      </details>
      <form action={submitRefresh}>
        <input type="hidden" name="projectId" value={card.projectId} />
        <button type="submit" className="farm-refresh">
          Ambil ulang step dari source
        </button>
      </form>
    </>
  );
}

/**
 * One farmed project on "Garapan saya" (mockup CGarapan): the checklist on the left (main tasks, today's dailies,
 * weeklies, the member's own task form) and the progress heatmap on the right. When the campaign ended the checklist
 * is locked and only the history is shown.
 */
export function FarmingCard({ card }: { card: FarmingCardData }) {
  const ended = card.range.endKind === "ended";
  const due = countdown(card);
  const titleId = `farm-${card.projectId}-name`;
  return (
    <article className="farm-card" aria-labelledby={titleId}>
      <div className="farm-head">
        <div className="farm-title">
          {ended ? <Stamp top="ENDED" bottom="" tone="ended" size="sm" rotate={-4} /> : null}
          <h2 id={titleId} className="ui-display farm-name">
            <Link href={`/projects/${card.slug}`}>{card.name}</Link>
          </h2>
        </div>
        <div className="farm-badges">
          {due ? (
            <span className="farm-countdown" data-ended={ended}>
              {due}
            </span>
          ) : null}
          <span className="farm-streak">Streak: {card.streak} hari</span>
        </div>
      </div>
      <div className="farm-body">
        <div className="farm-checklist">
          {ended ? (
            <p className="farm-note">Campaign udah ended. Checklist dikunci, riwayat garapanmu tetap tersimpan di sini.</p>
          ) : (
            <Checklist card={card} />
          )}
          <form action={submitStopFarming}>
            <input type="hidden" name="projectId" value={card.projectId} />
            <button type="submit" className="farm-stop">
              Berhenti garap
            </button>
          </form>
        </div>
        <div className="farm-progress">
          <div className="farm-group-head">
            <h3 className="ui-display farm-group-title">Progres</h3>
            <span className="farm-range">{rangeLabel(card)}</span>
          </div>
          <Heatmap cells={card.heatmap} label={`Progres ${card.name}`} today={card.today} />
        </div>
      </div>
    </article>
  );
}

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
import { garapan as copy } from "@/lib/copy";
import type { FarmingCard as FarmingCardData, FarmingResult, FarmingTask, MemberAverage } from "@/lib/farming";
import { deadlineKindLabel, precisionLabel } from "@/lib/view";
import { formatDay } from "./dates";
import { Heatmap } from "./Heatmap";
import { ResultBox } from "./ResultBox";

/** Sent by every form on the card: after a success the action goes back to a plain /garapan (no stale ?error=). */
function FromGarapan() {
  return <input type="hidden" name="from" value="garapan" />;
}

/** Daily tasks of the card ticked today, out of all its active daily tasks. */
export function dailyProgress(card: FarmingCardData): { done: number; total: number } {
  const daily = card.tasks.filter((t) => t.cadence === "daily");
  const ticked = new Set(card.checkedToday);
  return { done: daily.filter((t) => ticked.has(t.id)).length, total: daily.length };
}

function countdown(card: FarmingCardData): string | null {
  const { range, daysLeft } = card;
  if (range.endKind === "ended") return copy.endedOn(formatDay(range.end));
  if (daysLeft === null || range.endKind === null) return null;
  return copy.daysLeft(daysLeft, copy.endKind[range.endKind]);
}

/** The span the heatmap covers, naming its end only when that end is the deadline or the ended day itself. */
function rangeLabel(card: FarmingCardData): string {
  const { start, end, endKind, endsOn } = card.range;
  const span = copy.range(formatDay(start), formatDay(end));
  return endKind === null || endsOn !== end ? span : copy.rangeWithEnd(span, copy.endKind[endKind]);
}

/** The task's box for today: the form always sends the wanted state, so a double submit cannot undo itself. */
function CheckBox({ task, checked }: { task: FarmingTask; checked: boolean }) {
  return (
    <form action={submitCheck} className="farm-check-form">
      <FromGarapan />
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
      <FromGarapan />
      <input type="hidden" name="taskId" value={task.id} />
      <button type="submit" className="farm-archive" aria-label={copy.archiveLabel(task.text)}>
        {copy.archive}
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
        <Group id={ids("main")} title={copy.mainTasks} aside={copy.mainProgress(card.mainProgress.done, card.mainProgress.total)}>
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
      <Group id={ids("today")} title={copy.today} aside={daily.length > 0 ? copy.todayProgress(today.done, today.total) : undefined}>
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
          <p className="farm-note">{copy.noDaily}</p>
        )}
      </Group>
      {weekly.length > 0 ? (
        <Group id={ids("weekly")} title={copy.weekly}>
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
                    {doneThisWeek ? copy.weeklyDone : copy.weeklyOpen}
                  </span>
                  <ArchiveButton task={task} />
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
      <details className="farm-add">
        <summary>{copy.addSummary}</summary>
        <form action={submitAddTask} className="farm-add-form">
          <FromGarapan />
          <input type="hidden" name="projectId" value={card.projectId} />
          <label>
            {copy.taskLabel}
            <input name="text" required maxLength={200} />
          </label>
          <label>
            {copy.cadenceLabel}
            <select name="cadence" defaultValue="daily">
              <option value="daily">{copy.cadence.daily}</option>
              <option value="weekly">{copy.cadence.weekly}</option>
              <option value="once">{copy.cadence.once}</option>
            </select>
          </label>
          <Button variant="primary" type="submit">
            {copy.addButton}
          </Button>
        </form>
      </details>
      <form action={submitRefresh}>
        <FromGarapan />
        <input type="hidden" name="projectId" value={card.projectId} />
        <button type="submit" className="farm-refresh">
          {copy.refresh}
        </button>
      </form>
    </>
  );
}

/** "Deadline terdekat: Claim 15 Okt 2026 (tanggal tepat)", with the labels the list and project page use. */
function nextDeadlineLabel(card: FarmingCardData): string | null {
  const d = card.nextDeadline;
  return d ? copy.nextDeadline(deadlineKindLabel(d.kind), formatDay(d.date), precisionLabel(d.precision)) : null;
}

/**
 * One farmed project on "Garapan saya" (mockup CGarapan): the checklist on the left (main tasks, today's dailies,
 * weeklies, the member's own task form) and the progress heatmap on the right. When the campaign ended the checklist
 * is locked and only the history is shown. Once the project ended (`card.ended`), the member can enter what the
 * airdrop gave (`result`, with the member `average` when there is one).
 */
export function FarmingCard({
  card,
  result = null,
  average = null,
}: {
  card: FarmingCardData;
  result?: FarmingResult | null;
  average?: MemberAverage | null;
}) {
  const ended = card.range.endKind === "ended";
  const due = countdown(card);
  const deadline = nextDeadlineLabel(card);
  const titleId = `farm-${card.projectId}-name`;
  return (
    <article className="farm-card" aria-labelledby={titleId}>
      <div className="farm-head">
        <div className="farm-title">
          {ended ? <Stamp top={copy.endedStamp} bottom="" tone="ended" size="sm" rotate={-4} /> : null}
          <div>
            <h2 id={titleId} className="ui-display farm-name">
              <Link href={`/projects/${card.slug}`}>{card.name}</Link>
            </h2>
            {deadline ? <span className="farm-meta">{deadline}</span> : null}
          </div>
        </div>
        <div className="farm-badges">
          {due ? (
            <span className="farm-countdown" data-ended={ended}>
              {due}
            </span>
          ) : null}
          <span className="farm-streak">{copy.streak(card.streak)}</span>
        </div>
      </div>
      <div className="farm-body">
        <div className="farm-checklist">
          {ended ? (
            <p className="farm-note">{copy.endedNote}</p>
          ) : (
            <Checklist card={card} />
          )}
          {card.ended ? (
            <ResultBox
              projectId={card.projectId}
              projectName={card.name}
              tokenSymbol={card.tokenSymbol}
              result={result}
              average={average}
              today={card.today}
            />
          ) : null}
          <form action={submitStopFarming}>
            <FromGarapan />
            <input type="hidden" name="projectId" value={card.projectId} />
            <Button variant="danger" type="submit">
              {copy.stop}
            </Button>
          </form>
        </div>
        <div className="farm-progress">
          <div className="farm-group-head">
            <h3 className="ui-display farm-group-title">{copy.progress}</h3>
            <span className="farm-range">{rangeLabel(card)}</span>
          </div>
          <Heatmap cells={card.heatmap} label={copy.progressLabel(card.name)} today={card.today} />
        </div>
      </div>
    </article>
  );
}

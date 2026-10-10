import type { HeatmapCell } from "@saf/core";
import { formatDay, formatMonth, isoWeekday } from "./dates";

/** Row labels, Monday to Sunday; every other row is left blank like the mockup. */
const DAY_LABELS = ["Sen", "", "Rab", "", "Jum", "", "Min"];
/** A month label needs about three columns; one closer to the next label is dropped. */
const MIN_LABEL_GAP = 3;

type Slot = HeatmapCell | null;

/** The cells (consecutive days) in Monday-to-Sunday columns; null fills the days outside the range. */
function toWeeks(cells: HeatmapCell[]): Slot[][] {
  if (cells.length === 0) return [];
  const slots: Slot[] = [...Array<null>(isoWeekday(cells[0]!.day)).fill(null), ...cells];
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks: Slot[][] = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

/** Per column, the short month name when its first day starts a month the previous column did not show. */
function monthLabels(weeks: Slot[][]): (string | null)[] {
  const firstDays = weeks.map((week) => week.find((slot): slot is HeatmapCell => slot !== null)!.day);
  const starts = firstDays.flatMap((day, i) => (i === 0 || day.slice(0, 7) !== firstDays[i - 1]!.slice(0, 7) ? [i] : []));
  const labels: (string | null)[] = weeks.map(() => null);
  starts.forEach((col, k) => {
    const next = starts[k + 1];
    if (next === undefined || next - col >= MIN_LABEL_GAP) labels[col] = formatMonth(firstDays[col]!);
  });
  return labels;
}

function cellText(cell: HeatmapCell): string {
  return cell.upcoming ? `${formatDay(cell.day)}: belum lewat` : `${formatDay(cell.day)}: ${cell.done}/${cell.total} daily task`;
}

function cellClass(cell: HeatmapCell, today: string | undefined): string {
  const classes = ["heat-cell", cell.upcoming ? "heat-upcoming" : `heat-level-${cell.level ?? "none"}`];
  if (cell.day === today) classes.push("heat-today");
  return classes.join(" ");
}

/**
 * A GitHub-style grid of the farming days: seven rows (Monday to Sunday) by one column per week, month names above.
 * The shade gets darker with the share of daily tasks done (none, 0%, 1–49%, 50–99%, 100%); days after today are
 * dashed outlines. Every day also says its numbers in its tooltip and accessible name, so colour is never the only
 * cue. Wide ranges scroll inside their own box.
 */
export function Heatmap({ cells, label, today }: { cells: HeatmapCell[]; label: string; today?: string }) {
  const weeks = toWeeks(cells);
  const labels = monthLabels(weeks);
  return (
    <div className="heat-scroll" role="group" aria-label={label} tabIndex={0}>
      <div className="heat-grid">
        <div className="heat-days" aria-hidden="true">
          <span className="heat-month-spacer" />
          {DAY_LABELS.map((name, i) => (
            <span key={i} className="heat-day-label">
              {name}
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="heat-week">
            <span className="heat-month" aria-hidden="true">
              {labels[w] ?? ""}
            </span>
            {week.map((cell, d) =>
              cell === null ? (
                <span key={`pad-${d}`} className="heat-pad" aria-hidden="true" />
              ) : (
                <span
                  key={cell.day}
                  className={cellClass(cell, today)}
                  data-day={cell.day}
                  role="img"
                  aria-label={cellText(cell)}
                  title={cellText(cell)}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

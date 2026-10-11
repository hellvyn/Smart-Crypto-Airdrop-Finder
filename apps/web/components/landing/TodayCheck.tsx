import { Stamp } from "@/components/ui";
import { landing } from "@/lib/copy";

const copy = landing.today;

/** Counts from the latest daily run (Plan 6 `getRunSummary`). */
export type RunSummary = { checked: number; passed: number };

/**
 * The "Update hari ini" box in the landing hero, with the LOLOS 4/4 CEK stamp. The numbers only show once a run
 * summary is passed in; without a successful run that has curation numbers, the box shows its title, the run time
 * and the stamp.
 */
export function TodayCheck({ summary }: { summary: RunSummary | null }) {
  return (
    <div className="landing-today">
      <div className="landing-today-head">
        <span className="landing-today-title">{copy.title}</span>
        <span className="landing-today-time">{copy.time}</span>
      </div>
      {summary ? (
        <>
          <div className="landing-today-numbers">
            <div data-testid="today-checked">
              <div className="landing-today-number">{summary.checked}</div>
              <div className="landing-today-label">{copy.checked}</div>
            </div>
            <div data-testid="today-passed">
              <div className="landing-today-number" data-tone="pass">
                {summary.passed}
              </div>
              <div className="landing-today-label">{copy.passed}</div>
            </div>
          </div>
          <div className="landing-today-foot">
            {copy.shownWithoutPass}
            <b>0</b>
          </div>
        </>
      ) : null}
      <div className="landing-today-stamp">
        <Stamp top={landing.stampTop} bottom={landing.stampBottom} tone="pass" size="md" rotate={-10} />
      </div>
    </div>
  );
}

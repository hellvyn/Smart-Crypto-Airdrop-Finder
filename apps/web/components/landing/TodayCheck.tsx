import { Stamp } from "@/components/ui";

/** Counts from the latest daily run (Plan 6 `getRunSummary`). */
export type RunSummary = { checked: number; passed: number };

/**
 * The "Update hari ini" box in the landing hero, with the LOLOS 4/4 CEK stamp. The numbers only show once a run
 * summary is passed in; until Plan 6 provides one, the box shows its title, the run time and the stamp.
 */
export function TodayCheck({ summary }: { summary: RunSummary | null }) {
  return (
    <div className="landing-today">
      <div className="landing-today-head">
        <span className="landing-today-title">Update hari ini</span>
        <span className="landing-today-time">06.00 WIB</span>
      </div>
      {summary ? (
        <>
          <div className="landing-today-numbers">
            <div data-testid="today-checked">
              <div className="landing-today-number">{summary.checked}</div>
              <div className="landing-today-label">airdrop dicek</div>
            </div>
            <div data-testid="today-passed">
              <div className="landing-today-number" data-tone="pass">
                {summary.passed}
              </div>
              <div className="landing-today-label">lolos</div>
            </div>
          </div>
          <div className="landing-today-foot">
            Tampil tanpa lolos check: <b>0</b>
          </div>
        </>
      ) : null}
      <div className="landing-today-stamp">
        <Stamp top="LOLOS" bottom="4/4 CEK" tone="pass" size="md" rotate={-10} />
      </div>
    </div>
  );
}

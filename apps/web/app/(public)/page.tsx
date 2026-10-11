import { PlanComparison } from "@/components/landing/PlanComparison";
import { TodayCheck } from "@/components/landing/TodayCheck";
import { TrackRecord } from "@/components/landing/TrackRecord";
import { Button, Stamp } from "@/components/ui";
import { landing as copy } from "@/lib/copy";
import { getRunSummary, getTrackRecord } from "@/lib/queries";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The public landing page (mockup docs/design/airdropiq-c/CLanding.dc.html). The list itself is at /airdrops; old
 * list links with a query (`/?status=live`) are sent there by the proxy. `/?deleted=1` is where deleting your
 * account ends up, so that notice lives here. "Update hari ini" shows the latest run's numbers, and the track record
 * renders once `getTrackRecord` has one (10 airdrops or more).
 */
export default async function LandingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { deleted } = await searchParams;
  const accountDeleted = (Array.isArray(deleted) ? deleted[0] : deleted) === "1";
  const db = await createServerClient();
  const [summary, trackRecord] = await Promise.all([getRunSummary(db), getTrackRecord(db)]);

  return (
    <div className="landing">
      {accountDeleted ? (
        <div className="landing-wrap">
          <p role="status" className="landing-notice">
            {copy.deleted}
          </p>
        </div>
      ) : null}

      <section className="landing-section landing-hero">
        <div className="landing-wrap landing-hero-grid">
          <div className="landing-hero-copy">
            <h1 className="ui-display landing-h1">{copy.heroTitle}</h1>
            <p className="landing-lead">{copy.heroLead}</p>
            <div className="landing-actions">
              <Button variant="primary" href={LIST_PATH}>
                {copy.seeAirdrops}
              </Button>
              <Button variant="secondary" href="#cara">
                {copy.why}
              </Button>
            </div>
          </div>
          <TodayCheck summary={summary} />
        </div>
      </section>

      <section id="cara" className="landing-section">
        <div className="landing-wrap landing-cara">
          <div className="landing-cara-head">
            <span className="landing-badge">{copy.recheckBadge}</span>
            <h2 className="ui-display landing-h2 landing-h2-big">{copy.whyTitle}</h2>
            <Stamp top={copy.stampTop} bottom={copy.stampBottom} note={copy.stampNote} tone="pass" size="lg" rotate={-8} />
          </div>
          <div className="landing-cara-body">
            {copy.whyBody.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>

      <TrackRecord record={trackRecord} />

      <PlanComparison />

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-row">
          <span>{copy.copyright}</span>
          <span>{copy.footer}</span>
        </div>
      </footer>
    </div>
  );
}

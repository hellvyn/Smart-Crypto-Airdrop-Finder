import { PlanComparison } from "@/components/landing/PlanComparison";
import { TodayCheck } from "@/components/landing/TodayCheck";
import { TrackRecord } from "@/components/landing/TrackRecord";
import { Button, Stamp } from "@/components/ui";
import { landing as copy } from "@/lib/copy";
import { LIST_PATH } from "@/lib/routes";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The public landing page (mockup docs/design/airdropiq-c/CLanding.dc.html). The list itself is at /airdrops; old
 * list links with a query (`/?status=live`) are sent there by the proxy. `/?deleted=1` is where deleting your
 * account ends up, so that notice lives here.
 */
export default async function LandingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { deleted } = await searchParams;
  const accountDeleted = (Array.isArray(deleted) ? deleted[0] : deleted) === "1";

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
          {/* Plan 6 passes getRunSummary() here. */}
          <TodayCheck summary={null} />
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

      {/* Plan 6 Task 4 passes getTrackRecord() here; until then the block does not render. */}
      <TrackRecord record={null} />

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

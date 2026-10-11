import { Stamp } from "@/components/ui";
import { landing } from "@/lib/copy";

const copy = landing.trackRecord;

/** Plan 6 `getTrackRecord`: outcomes of the airdrops that passed before their token listed and have now ended. */
export type TrackRecordSummary = { total: number; listed: number; noToken: number; riskRaised: number };

/** Fewer ended airdrops than this are not shown at all: two or three examples are not proof (spec 15.3, #43). */
const MIN_POPULATION = 10;

/** The landing's track record block (#jejak). Renders nothing until there is a record of at least 10 airdrops. */
export function TrackRecord({ record }: { record: TrackRecordSummary | null }) {
  if (!record || record.total < MIN_POPULATION) return null;
  return (
    <section id="jejak" className="landing-section">
      <div className="landing-wrap landing-jejak">
        <div className="landing-jejak-text">
          <h2 className="ui-display landing-h2">{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <div className="landing-jejak-card">
          <div className="landing-jejak-stamps">
            <Stamp top={String(record.listed)} bottom={copy.listed} tone="pass" size="lg" rotate={-8} />
            <Stamp top={String(record.noToken)} bottom={copy.noToken} tone="ended" size="lg" rotate={5} />
            <Stamp top={String(record.riskRaised)} bottom={copy.riskRaised} tone="caution" size="lg" rotate={-4} />
          </div>
          <p className="landing-jejak-note">{copy.note(record.total)}</p>
        </div>
      </div>
    </section>
  );
}

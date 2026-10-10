import { Stamp } from "@/components/ui";

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
          <h2 className="ui-display landing-h2">Track record kami</h2>
          <p>
            Gampang ngomong &quot;airdrop pilihan&quot;. Buktiin hasilnya yang susah. Jadi tiap airdrop yang kami loloskan
            sebelum TGE, kami catat ending-nya gimana. Angkanya baru muncul setelah minimal 10 airdrop selesai, soalnya
            dua tiga contoh belum bisa disebut bukti.
          </p>
        </div>
        <div className="landing-jejak-card">
          <div className="landing-jejak-stamps">
            <Stamp top={String(record.listed)} bottom="Token listing" tone="pass" size="lg" rotate={-8} />
            <Stamp top={String(record.noToken)} bottom="Ended tanpa token" tone="ended" size="lg" rotate={5} />
            <Stamp top={String(record.riskRaised)} bottom="Belakangan jadi risky" tone="caution" size="lg" rotate={-4} />
          </div>
          <p className="landing-jejak-note">
            Dari {record.total} airdrop yang lolos sebelum token listing dan sekarang udah ended.
          </p>
        </div>
      </div>
    </section>
  );
}

import { PlanComparison } from "@/components/landing/PlanComparison";
import { TodayCheck } from "@/components/landing/TodayCheck";
import { TrackRecord } from "@/components/landing/TrackRecord";
import { Button, Stamp } from "@/components/ui";
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
            Akun kamu udah dihapus.
          </p>
        </div>
      ) : null}

      <section className="landing-section landing-hero">
        <div className="landing-wrap landing-hero-grid">
          <div className="landing-hero-copy">
            <h1 className="ui-display landing-h1">Airdrop yang worth it digarap, udah kami cek duluan.</h1>
            <p className="landing-lead">
              Kami udah terlalu sering lihat orang kena link claim palsu di grup Telegram. Makanya aturannya simpel.
              Airdrop yang gak lolos 4 security check gak bakal tampil di sini, se-hype apa pun.
            </p>
            <div className="landing-actions">
              <Button variant="primary" href={LIST_PATH}>
                Lihat airdrop
              </Button>
              <Button variant="secondary" href="#cara">
                Kenapa AirdropIQ
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
            <span className="landing-badge">Re-check tiap pagi, 06.00 WIB</span>
            <h2 className="ui-display landing-h2 landing-h2-big">Tiap hari semua airdrop kami cek ulang dari nol.</h2>
            <Stamp top="LOLOS" bottom="4/4 CEK" note="ATAU GAK TAMPIL" tone="pass" size="lg" rotate={-8} />
          </div>
          <div className="landing-cara-body">
            <p>
              Jujur aja, kebanyakan web airdrop cuma copas announcement. Kami gak. Source-nya kami baca sendiri, link
              claim-nya kami cek, baru setelah itu airdrop-nya boleh masuk list.
            </p>
            <p>
              Badge verified cuma kami pasang kalau datanya cocok. Project ngaku di-backing VC gede tapi buktinya gak
              ada? Kami tulis apa adanya: masih klaim.
            </p>
          </div>
        </div>
      </section>

      {/* Plan 6 Task 4 passes getTrackRecord() here; until then the block does not render. */}
      <TrackRecord record={null} />

      <PlanComparison />

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-row">
          <span>© 2026 AirdropIQ</span>
          <span>Not financial advice. Tetap DYOR sebelum connect wallet.</span>
        </div>
      </footer>
    </div>
  );
}

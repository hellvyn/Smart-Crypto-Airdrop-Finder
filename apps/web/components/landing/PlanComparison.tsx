/** What a visitor gets for free and what is member only (spec 15.5). No price and no signup (#46). */
const ROWS: { title: string; note: string; free: boolean }[] = [
  { title: "List airdrop yang lolos check", note: "Yang live sekarang, early, dan yang udah ended.", free: true },
  { title: "Security check", note: "4 check utama, plus warning kalau ada pola scam.", free: true },
  { title: "Status link claim", note: "Official, beda domain, atau di-hide karena phishing.", free: true },
  { title: "Sumber yang beda cerita", note: "Kalau dua source gak sinkron, kamu lihat dua-duanya.", free: true },
  { title: "Step garap", note: "Step-by-step, udah dalam Bahasa Indonesia.", free: true },
  { title: "Track record", note: "Ending dari airdrop yang pernah kami loloskan.", free: true },
  { title: "Level worth it", note: "Sepadan gak sama effort-nya, plus urutan dari yang paling worth it.", free: false },
  { title: "AI verdict", note: "Garap, pantau, atau skip. Tiap alasan ada kutipan source-nya.", free: false },
  { title: "Estimasi effort", note: "Berapa menit per hari, modal, dan gas fee.", free: false },
  { title: "Morning briefing", note: "Airdrop baru dan update penting, dirangkum sebelum kamu buka grup.", free: false },
  { title: "Farming Coach", note: "Tanya mau garap yang mana dulu, sesuai modal dan jumlah wallet kamu.", free: false },
  { title: "Farming tracker & watchlist", note: "Daily checklist, heatmap, dan update kalau ada yang berubah.", free: false },
];

function Included() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="Ada" fill="none" stroke="var(--pass)" strokeWidth="4" strokeLinecap="square">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function NotIncluded() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Gak ada" fill="none" stroke="var(--muted)" strokeWidth="3" strokeLinecap="square">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** The "Apa bedanya gratis sama member?" table. On a narrow screen it scrolls inside its own box. */
export function PlanComparison() {
  return (
    <section className="landing-section landing-compare">
      <div className="landing-wrap landing-compare-wrap">
        <h2 id="bedanya" className="ui-display landing-h2 landing-center">
          Apa bedanya gratis sama member?
        </h2>
        <div className="landing-table-scroll">
          <table className="landing-table" aria-labelledby="bedanya">
            <thead>
              <tr>
                <th scope="col">Fitur</th>
                <th scope="col">Gratis</th>
                <th scope="col" data-member="">
                  Member
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.title}>
                  <th scope="row">
                    <span className="landing-feature">{row.title}</span>
                    <span className="landing-feature-note">{row.note}</span>
                  </th>
                  <td>{row.free ? <Included /> : <NotIncluded />}</td>
                  <td data-member="">
                    <Included />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

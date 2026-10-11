import { landing } from "@/lib/copy";

const copy = landing.compare;

/** What a visitor gets for free and what is member only (spec 15.5). No price and no signup (#46). */
const ROWS: readonly { title: string; note: string; free: boolean }[] = copy.rows;

function Included() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={copy.included} fill="none" stroke="var(--pass)" strokeWidth="4" strokeLinecap="square">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function NotIncluded() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label={copy.notIncluded} fill="none" stroke="var(--muted)" strokeWidth="3" strokeLinecap="square">
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
          {copy.title}
        </h2>
        <div className="landing-table-scroll">
          <table className="landing-table" aria-labelledby="bedanya">
            <thead>
              <tr>
                <th scope="col">{copy.feature}</th>
                <th scope="col">{copy.free}</th>
                <th scope="col" data-member="">
                  {copy.member}
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

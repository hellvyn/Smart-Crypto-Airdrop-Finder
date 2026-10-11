import Link from "next/link";
import { ChangesSinceLastVisit } from "@/components/ChangesSinceLastVisit";
import { Pagination } from "@/components/Pagination";
import { ProjectRow } from "@/components/ProjectRow";
import { StaleBanner } from "@/components/StaleBanner";
import { TabBar } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { EMPTY_CHANGE_FEED } from "@/lib/changes";
import { landing, list, pageTitle, ui } from "@/lib/copy";
import {
  getChangeFeed,
  getLastSuccessfulRunAt,
  getRunSummary,
  getTrackRecord,
  listChains,
  listCurated,
} from "@/lib/queries";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";
import {
  RISK_LEVELS,
  STATUSES,
  TABS,
  WORTH_LEVELS,
  curatedHref,
  parseCuratedFilters,
  parsePage,
  parseTab,
  rawChainParam,
  riskLabel,
  statusLabel,
  type CapitalFilter,
} from "@/lib/view";

type SearchParams = Record<string, string | string[] | undefined>;

export const metadata = { title: pageTitle(list.title) };

const CAPITAL_OPTIONS: readonly CapitalFilter[] = ["all", "free", "deposit"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The curated list (Plan 6 Task 4; mockup docs/design/airdropiq-c/CList.dc.html): the latest run's summary, the track
 * record once there is one, three tabs (`?tab=`), the "Modal:" sub-filter (`?modal=`), the filters, and the rows.
 * Visitors read `public_list` in the "Baru dicek" order: their `?worth=` is dropped and there is no `?sort=` to
 * pick, so nothing reveals the worth order (#45). Members also get the worth level, its filter and the "Paling worth
 * it" order, and "Perubahan sejak kunjungan terakhir" for their watched projects above the list.
 */
export default async function AirdropsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await getUser();
  const member = user !== null;
  const tab = parseTab(first(sp.tab));
  const filters = parseCuratedFilters(sp, member);
  const capital = filters.capital ?? "all";
  const page = parsePage(first(sp.page));
  const db = await createServerClient();
  const now = new Date();
  const [curated, lastRunAt, summary, trackRecord, chains, changes] = await Promise.all([
    listCurated(db, tab, filters, page, member),
    getLastSuccessfulRunAt(db),
    getRunSummary(db),
    getTrackRecord(db),
    listChains(db),
    user ? getChangeFeed(db, user.id, now) : EMPTY_CHANGE_FEED,
  ]);
  const { items, total, pageSize, capitalCounts } = curated;
  // An invalid chain value applies no filter but is still shown, as text only, in the form.
  const selectedChain = rawChainParam(sp);
  const selectedWorth = filters.worth?.[0] ?? "";
  // The "Modal:" option is not one of these: it has its own row, and "Hapus filter" keeps it.
  const hasFilters = !!(filters.status?.length || filters.risk?.length || selectedChain || filters.worth?.length);
  const sort = tab === "ended" ? list.sort.ended : member ? list.sort.member : list.sort.visitor;

  return (
    <>
      <StaleBanner lastRunAt={lastRunAt} now={now} />
      <ChangesSinceLastVisit feed={changes} />
      <section className="list-summary" aria-labelledby="list-summary-title">
        <h1 id="list-summary-title" className="ui-display list-summary-title">
          {list.summary.title}
        </h1>
        {summary ? (
          <div className="list-summary-numbers">
            <div data-testid="summary-checked">
              <b>{summary.checked}</b> {list.summary.checked}
            </div>
            <div data-testid="summary-passed">
              <b data-tone="pass">{summary.passed}</b> {list.summary.passed}
            </div>
          </div>
        ) : null}
      </section>

      {trackRecord ? (
        <section className="list-track-record" aria-labelledby="list-track-record-title">
          <h2 id="list-track-record-title">{landing.trackRecord.title}</h2>
          <p>
            {list.trackRecord(trackRecord)} {landing.trackRecord.note(trackRecord.total)}
          </p>
        </section>
      ) : null}

      <div className="list-tabs">
        <TabBar
          tabs={TABS.map((t) => ({ label: list.tabs[t], href: curatedHref(t, filters), active: t === tab }))}
        />
        <span className="list-sort">
          {list.sortLabel} <b>{sort}</b>
        </span>
      </div>

      <nav className="list-capital" aria-label={list.capitalLabel}>
        <span className="list-capital-label">{list.capitalLabel}</span>
        {CAPITAL_OPTIONS.map((c) => (
          <Link
            key={c}
            href={curatedHref(tab, { ...filters, capital: c })}
            className="list-capital-option"
            aria-current={c === capital ? "page" : undefined}
          >
            {list.option(list.capital[c], capitalCounts[c])}
          </Link>
        ))}
      </nav>

      <form method="get" action={LIST_PATH} className="filters" aria-label={list.filtersLabel}>
        <input type="hidden" name="tab" value={tab} />
        {capital !== "all" ? <input type="hidden" name="modal" value={capital} /> : null}
        <fieldset>
          <legend>{list.statusLegend}</legend>
          {STATUSES.map((s) => (
            <label key={s}>
              <input type="checkbox" name="status" value={s} defaultChecked={filters.status?.includes(s)} /> {statusLabel(s)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{list.riskLegend}</legend>
          {RISK_LEVELS.map((r) => (
            <label key={r}>
              <input type="checkbox" name="risk" value={r} defaultChecked={filters.risk?.includes(r)} /> {riskLabel(r)}
            </label>
          ))}
        </fieldset>
        <label>
          {list.chainLabel}
          <select name="chain" defaultValue={selectedChain ?? ""}>
            <option value="">{list.allChains}</option>
            {selectedChain && !chains.includes(selectedChain) ? (
              <option value={selectedChain}>{list.noMatches(selectedChain)}</option>
            ) : null}
            {chains.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {member ? (
          <label>
            {list.worthLabel}
            <select name="worth" defaultValue={selectedWorth}>
              <option value="">{list.worthAll}</option>
              {WORTH_LEVELS.map((w) => (
                <option key={w} value={w}>
                  {ui.worth[w]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit">{list.apply}</button>
        {hasFilters ? <a href={curatedHref(tab, { capital })}>{list.clear}</a> : null}
      </form>

      {items.length === 0 ? (
        <p>{page > 1 ? list.emptyPage : hasFilters ? list.emptyFiltered : list.emptyTab}</p>
      ) : (
        <div className="project-list">
          {items.map((item) => (
            <ProjectRow key={item.slug} item={item} member={member} now={now} />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} tab={tab} filters={filters} />
    </>
  );
}

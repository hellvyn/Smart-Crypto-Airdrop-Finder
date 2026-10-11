import { Pagination } from "@/components/Pagination";
import { ProjectRow } from "@/components/ProjectRow";
import { StaleBanner } from "@/components/StaleBanner";
import { list, pageTitle } from "@/lib/copy";
import { getLastSuccessfulRunAt, listChains, listProjects } from "@/lib/queries";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";
import {
  RISK_LEVELS,
  STATUSES,
  parseFilters,
  parsePage,
  rawChainParam,
  formatDateTime,
  riskLabel,
  statusLabel,
} from "@/lib/view";

type SearchParams = Record<string, string | string[] | undefined>;

export const metadata = { title: pageTitle(list.title) };

function many(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export default async function AirdropsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const db = await createServerClient();
  const now = new Date();
  const page = parsePage(many(sp.page)[0]);
  const [{ items, total, pageSize }, lastRunAt, chains] = await Promise.all([
    listProjects(db, filters, page),
    getLastSuccessfulRunAt(db),
    listChains(db),
  ]);
  // An invalid chain value applies no filter but is still shown, as text only, in the form.
  const selectedChain = rawChainParam(sp);
  const hasFilters = !!(filters.status?.length || filters.risk?.length || selectedChain);

  return (
    <>
      <h1>{list.heading}</h1>
      <StaleBanner lastRunAt={lastRunAt} now={now} />
      <p className="muted">{list.meta(lastRunAt ? formatDateTime(lastRunAt) : null, total)}</p>

      <form method="get" action={LIST_PATH} className="filters" aria-label={list.filtersLabel}>
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
        <button type="submit">{list.apply}</button>
        {hasFilters ? <a href={LIST_PATH}>{list.clear}</a> : null}
      </form>

      {items.length === 0 ? (
        <p>{page > 1 ? list.emptyPage : hasFilters ? list.emptyFiltered : list.empty}</p>
      ) : (
        <div className="project-list">
          {items.map((item) => (
            <ProjectRow key={item.slug} item={item} />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} filters={filters} />
    </>
  );
}

import { Pagination } from "@/components/Pagination";
import { ProjectRow } from "@/components/ProjectRow";
import { StaleBanner } from "@/components/StaleBanner";
import { getLastSuccessfulRunAt, listChains, listProjects } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";
import {
  RISK_LEVELS,
  STATUSES,
  parsePage,
  formatDateTime,
  riskLabel,
  statusLabel,
  type ListFilters,
} from "@/lib/view";

type SearchParams = Record<string, string | string[] | undefined>;

function many(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Filters come from the query string: ?status=live&status=announced&risk=high&chain=ethereum. Unknown values are dropped. */
function parseFilters(sp: SearchParams): ListFilters {
  const status = many(sp.status).filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
  const risk = many(sp.risk).filter((r): r is (typeof RISK_LEVELS)[number] => (RISK_LEVELS as readonly string[]).includes(r));
  const chain = many(sp.chain)[0]?.trim();
  return { status, risk, chain: chain || undefined };
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
  const selectedChain = filters.chain?.toLowerCase();
  const hasFilters = !!(filters.status?.length || filters.risk?.length || filters.chain);

  return (
    <>
      <h1>Airdrops</h1>
      <StaleBanner lastRunAt={lastRunAt} now={now} />
      <p className="muted">
        Last updated: {lastRunAt ? formatDateTime(lastRunAt) : "never"}. {total} {total === 1 ? "airdrop" : "airdrops"}. Nearest deadline first, then most recently seen.
      </p>

      <form method="get" className="filters" aria-label="Filters">
        <fieldset>
          <legend>Status</legend>
          {STATUSES.map((s) => (
            <label key={s}>
              <input type="checkbox" name="status" value={s} defaultChecked={filters.status?.includes(s)} /> {statusLabel(s)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Risk level</legend>
          {RISK_LEVELS.map((r) => (
            <label key={r}>
              <input type="checkbox" name="risk" value={r} defaultChecked={filters.risk?.includes(r)} /> {riskLabel(r)}
            </label>
          ))}
        </fieldset>
        <label>
          Chain
          <select name="chain" defaultValue={selectedChain ?? ""}>
            <option value="">All chains</option>
            {selectedChain && !chains.includes(selectedChain) ? (
              <option value={selectedChain}>{selectedChain} (no matches)</option>
            ) : null}
            {chains.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply filters</button>
        {hasFilters ? <a href="/">Clear filters</a> : null}
      </form>

      {items.length === 0 ? (
        <p>{page > 1 ? "No airdrops on this page." : hasFilters ? "No airdrops match these filters." : "No airdrops yet."}</p>
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

import Link from "next/link";
import { list } from "@/lib/copy";
import { curatedHref, type CuratedFilters, type Tab } from "@/lib/view";

/** Previous/next links that keep the tab and the filters. `total` is the number of matching projects across all pages. */
export function Pagination({
  page,
  pageSize,
  total,
  tab,
  filters,
}: {
  page: number;
  pageSize: number;
  total: number;
  tab: Tab;
  filters: CuratedFilters;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1 && page <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={list.pagination.label} className="pagination">
      {page > 1 ? (
        <Link href={curatedHref(tab, filters, Math.min(page - 1, lastPage))} rel="prev">
          {list.pagination.previous}
        </Link>
      ) : null}
      <span className="muted">{total === 0 || from > total ? list.pagination.pageOf(page, lastPage) : list.pagination.range(from, to, total)}</span>
      {page < lastPage ? (
        <Link href={curatedHref(tab, filters, page + 1)} rel="next">
          {list.pagination.next}
        </Link>
      ) : null}
    </nav>
  );
}

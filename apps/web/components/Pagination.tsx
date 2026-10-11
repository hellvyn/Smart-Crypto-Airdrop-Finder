import Link from "next/link";
import { list } from "@/lib/copy";
import { LIST_PATH } from "@/lib/routes";
import { listQueryString, type ListFilters } from "@/lib/view";

function href(f: ListFilters, page: number): string {
  const qs = listQueryString(f, page);
  return qs ? `${LIST_PATH}?${qs}` : LIST_PATH;
}

/** Previous/next links that keep the active filters. `total` is the number of matching projects across all pages. */
export function Pagination({
  page,
  pageSize,
  total,
  filters,
}: {
  page: number;
  pageSize: number;
  total: number;
  filters: ListFilters;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1 && page <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={list.pagination.label} className="pagination">
      {page > 1 ? (
        <Link href={href(filters, Math.min(page - 1, lastPage))} rel="prev">
          {list.pagination.previous}
        </Link>
      ) : null}
      <span className="muted">{total === 0 || from > total ? list.pagination.pageOf(page, lastPage) : list.pagination.range(from, to, total)}</span>
      {page < lastPage ? (
        <Link href={href(filters, page + 1)} rel="next">
          {list.pagination.next}
        </Link>
      ) : null}
    </nav>
  );
}

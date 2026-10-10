import Link from "next/link";
import { LIST_PATH } from "@/lib/routes";
import { listQueryString, type ListFilters } from "@/lib/view";

function href(f: ListFilters, page: number): string {
  const qs = listQueryString(f, page);
  return qs ? `${LIST_PATH}?${qs}` : LIST_PATH;
}

/** Prev/Next links that keep the active filters. `total` is the number of matching projects across all pages. */
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
    <nav aria-label="Pagination" className="pagination">
      {page > 1 ? (
        <Link href={href(filters, Math.min(page - 1, lastPage))} rel="prev">
          Previous
        </Link>
      ) : null}
      <span className="muted">{total === 0 || from > total ? `Page ${page} of ${lastPage}` : `${from}-${to} of ${total}`}</span>
      {page < lastPage ? (
        <Link href={href(filters, page + 1)} rel="next">
          Next
        </Link>
      ) : null}
    </nav>
  );
}

import type { ReactNode } from "react";
import { safeHttpUrl } from "@/lib/view";

/** An outbound link. Only http(s) URLs become anchors; anything else is shown as plain text. */
export function ExternalLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={safe} rel="noopener noreferrer nofollow" target="_blank" title={title}>
      {children}
    </a>
  );
}

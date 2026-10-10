import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One airdrop as a ruled ticket: a single link. At 960 px and wider the children sit in five columns
 * (stamp, name, signals, deadline, worth); below that they stack in one.
 */
export function Ticket({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="ui-ticket">
      {children}
    </Link>
  );
}

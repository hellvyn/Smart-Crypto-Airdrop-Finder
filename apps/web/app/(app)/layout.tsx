import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";

/** Every page in the (app) group requires a signed-in user (the proxy redirects first; this is the backstop). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <>{children}</>;
}

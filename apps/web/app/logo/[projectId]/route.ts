// GET /logo/{projectId} -> the project's stored logo (owner request 2026-10-11), so a visitor's browser loads it from
// our origin and never contacts a project domain. The bytes come from `project_logos` (public read) through a
// cookie-less anon client: this response is cached publicly, so it must never carry a session cookie. The proxy does
// not run here either (proxy.ts matcher).
import { getProjectLogo } from "@/lib/logos";
import { createPublicClient } from "@/lib/supabase/public";
import { isUuid } from "@/lib/uuid";

/**
 * Sent with every answer: never sniffed into another type, and nothing in it can run or load anything.
 * Note: when next.config.ts and a route handler set the same header, Next keeps the config's value. The site-wide
 * `Content-Security-Policy: frame-ancestors 'none'` would win over the CSP below, so the `/logo/:projectId` rule in
 * next.config.ts is what actually sends `default-src 'none'; sandbox` here. Do not remove that rule.
 */
const LOCKED = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

const answer = (status: number): Response =>
  new Response(null, { status, headers: { ...LOCKED, "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  // A malformed id is simply not found (never a database error, never a 500).
  if (!isUuid(projectId)) return answer(404);
  let logo: Awaited<ReturnType<typeof getProjectLogo>>;
  try {
    logo = await getProjectLogo(createPublicClient(), projectId);
  } catch {
    return answer(503);
  }
  if (logo === null) return answer(404);
  return new Response(logo.bytes, {
    status: 200,
    headers: {
      ...LOCKED,
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

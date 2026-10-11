import { notCurated } from "@/lib/copy";

/**
 * "Gak masuk list: {alasan}" above the project page (Plan 6 Task 6). The reason is always the public one
 * (`curations.public_fail_reason`, #55) or "belum dinilai", for a visitor and a member alike, so the page never
 * carries member-only text that a shared cache could hand to a visitor. Plain text, never markup.
 */
export function NotCuratedBanner({ reason }: { reason: string }) {
  return (
    <p className="banner banner-not-curated" data-testid="not-curated">
      {notCurated.banner(reason)}
    </p>
  );
}

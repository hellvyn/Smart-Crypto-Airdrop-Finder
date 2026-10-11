import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "../lib/view";

const getUser = vi.fn();
const getProjectDetail = vi.fn();

vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/queries", () => ({
  getProjectDetail: (...args: unknown[]) => getProjectDetail(...args),
  getLastSuccessfulRunAt: vi.fn(),
}));

import { generateMetadata } from "../app/(public)/projects/[slug]/page";

type Curation = ProjectDetail["curation"];
const curation = (over: Partial<NonNullable<Curation>>): Curation => ({
  passed: true,
  worthLevel: null,
  tab: "live_now",
  reasons: null,
  publicFailReason: null,
  endedOn: null,
  checkedAt: "2026-10-09T23:00:00Z",
  ...over,
});
const meta = (slug = "demo") => generateMetadata({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(null);
  getProjectDetail.mockReset();
});

// These tests run outside a request, where React's `cache()` does not memoize, so they do not prove that the page
// and its metadata share one read. They cover the noindex decision and how the project is read.
describe("project page metadata", () => {
  it("is noindex when the latest curation failed", async () => {
    getProjectDetail.mockResolvedValue({ curation: curation({ passed: false, tab: null, publicFailReason: "Risiko tinggi" }) });
    expect((await meta()).robots).toEqual({ index: false });
  });

  it("is noindex when there is no curation at all (belum dinilai)", async () => {
    getProjectDetail.mockResolvedValue({ curation: null });
    expect((await meta()).robots).toEqual({ index: false });
  });

  it.each([["live_now"], ["early_bets"], ["ended"]] as const)("stays indexable when the project passed in %s", async (tab) => {
    getProjectDetail.mockResolvedValue({
      slug: "polymarket",
      name: "Polymarket",
      chains: ["polygon"],
      curation: curation({ tab, endedOn: tab === "ended" ? "2025-01-15" : null }),
    });
    const m = await meta();
    expect(m.robots).toBeUndefined();
    expect(m.title).toBe("Polymarket · AirdropIQ");
    expect(m.alternates?.canonical).toBe("/projects/polymarket");
    expect(String(m.description)).toContain("Polymarket");
  });

  it("adds nothing for an unknown slug (the page itself answers 404)", async () => {
    getProjectDetail.mockResolvedValue(null);
    expect(await meta("nope")).toEqual({});
  });

  it("reads the project as a visitor or a member by the session, like the page", async () => {
    getProjectDetail.mockResolvedValue({ slug: "s", name: "S", chains: [], curation: curation({}) });
    await meta();
    expect(getProjectDetail.mock.calls[0]![2]).toMatchObject({ member: false });
    getUser.mockResolvedValue({ id: "u" });
    await meta("other");
    expect(getProjectDetail.mock.calls[1]![2]).toMatchObject({ member: true });
  });
});

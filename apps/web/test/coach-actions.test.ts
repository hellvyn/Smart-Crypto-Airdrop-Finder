import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.com" };
const PID = "44444444-4444-4444-8444-444444444444";
const THREAD = "22222222-2222-4222-8222-222222222222";

const requireUser = vi.fn();
const saveCoachProfile = vi.fn();
const getPlanCards = vi.fn();
const rpc = vi.fn();
const deleteEq = vi.fn();
const revalidatePath = vi.fn();

const db = { rpc, from: () => ({ delete: () => ({ eq: deleteEq }) }) };

vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => db }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/coach", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/coach")>()),
  saveCoachProfile: (...a: unknown[]) => saveCoachProfile(...a),
}));
vi.mock("@/lib/coach-view", () => ({ getPlanCards: (...a: unknown[]) => getPlanCards(...a) }));

import {
  deleteCoachThread,
  planCardsAction,
  saveCoachProfileAction,
  startCoachThreadAction,
} from "@/app/(public)/coach/actions";

beforeEach(() => {
  for (const fn of [requireUser, saveCoachProfile, getPlanCards, rpc, deleteEq, revalidatePath]) fn.mockReset();
  requireUser.mockResolvedValue(USER);
});

describe("coach actions", () => {
  it("every action checks the user first", async () => {
    requireUser.mockRejectedValue(new Error("redirect"));
    await expect(saveCoachProfileAction({})).rejects.toThrow("redirect");
    await expect(startCoachThreadAction(PID)).rejects.toThrow("redirect");
    await expect(planCardsAction([PID])).rejects.toThrow("redirect");
    const form = new FormData();
    form.set("threadId", THREAD);
    await expect(deleteCoachThread(form)).rejects.toThrow("redirect");
    expect(rpc).not.toHaveBeenCalled();
    expect(saveCoachProfile).not.toHaveBeenCalled();
  });

  it("saves the profile for the signed-in user and refreshes the page", async () => {
    saveCoachProfile.mockResolvedValue({ ok: true });
    expect(await saveCoachProfileAction({ level: "pro" })).toEqual({ ok: true });
    expect(saveCoachProfile).toHaveBeenCalledWith(db, USER.id, { level: "pro" });
    expect(revalidatePath).toHaveBeenCalledWith("/coach");
  });

  it("tells the form when the server refuses the profile", async () => {
    saveCoachProfile.mockResolvedValue({ ok: false, error: "bad_input" });
    const result = await saveCoachProfileAction({});
    expect(result).toEqual({ ok: false, message: "Profil belum tersimpan. Cek isiannya, lalu coba lagi." });
  });

  it("opens a thread about a project through coach_new_thread, and refuses a bad id without a call", async () => {
    rpc.mockResolvedValue({ data: THREAD, error: null });
    expect(await startCoachThreadAction(PID)).toEqual({ ok: true, threadId: THREAD });
    expect(rpc).toHaveBeenCalledWith("coach_new_thread", { p_project_id: PID });
    rpc.mockClear();
    expect(await startCoachThreadAction("nope")).toMatchObject({ ok: false, error: "bad_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the thread cap to the quota message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "threads" } });
    expect(await startCoachThreadAction(PID)).toEqual({
      ok: false,
      error: "quota",
      message: "Jatah 20 pesan hari ini habis, reset jam 00.00 WIB.",
    });
  });

  it("reads plan cards only for string ids", async () => {
    getPlanCards.mockResolvedValue([{ id: PID }]);
    expect(await planCardsAction([PID, 5, null])).toEqual([{ id: PID }]);
    expect(getPlanCards).toHaveBeenCalledWith(db, [PID]);
    expect(await planCardsAction("not a list")).toEqual([]);
  });

  it("deletes a thread by id through the member's own session, and rejects a bad id", async () => {
    deleteEq.mockResolvedValue({ error: null });
    const form = new FormData();
    form.set("threadId", THREAD);
    await deleteCoachThread(form);
    expect(deleteEq).toHaveBeenCalledWith("id", THREAD);
    expect(revalidatePath).toHaveBeenCalledWith("/coach");
    const bad = new FormData();
    bad.set("threadId", "x");
    await expect(deleteCoachThread(bad)).rejects.toThrow("Invalid threadId");
  });
});

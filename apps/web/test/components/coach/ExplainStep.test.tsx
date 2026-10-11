// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ startCoachThreadAction: vi.fn() }));
vi.mock("@/app/(public)/coach/actions", () => actions);

import { ExplainStep } from "@/components/coach/ExplainStep";

const PROJECT = "44444444-4444-4444-8444-444444444444";
const STEP = "55555555-5555-4555-8555-555555555555";
const THREAD = "33333333-3333-4333-8333-333333333333";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  actions.startCoachThreadAction.mockReset().mockResolvedValue({ ok: true, threadId: THREAD });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = () => fireEvent.click(screen.getByRole("button", { name: "Jelasin langkah ini" }));

describe("ExplainStep", () => {
  it("posts explain_step with the step id on a thread about the project, and shows the answer plain", async () => {
    fetchMock.mockResolvedValue(new Response("Bridge itu mindahin aset <i>antar</i> chain.", { status: 200 }));
    render(<ExplainStep projectId={PROJECT} stepId={STEP} />);
    click();
    const answer = await screen.findByTestId("explain-answer");
    await waitFor(() => expect(answer.textContent).toBe("Bridge itu mindahin aset <i>antar</i> chain."));
    expect(answer.querySelector("i")).toBeNull();
    expect(actions.startCoachThreadAction).toHaveBeenCalledWith(PROJECT);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/coach/chat");
    expect(JSON.parse(init.body)).toEqual({
      threadId: THREAD,
      message: "Jelasin langkah ini dong.",
      kind: "explain_step",
      stepId: STEP,
    });
  });

  it("explains again on a second click without opening another thread", async () => {
    fetchMock.mockImplementation(async () => new Response("Jawaban.", { status: 200 }));
    render(<ExplainStep projectId={PROJECT} stepId={STEP} />);
    click();
    await screen.findByTestId("explain-answer");
    await waitFor(() => expect((screen.getByRole("button", { name: "Jelasin langkah ini" }) as HTMLButtonElement).disabled).toBe(false));
    click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(actions.startCoachThreadAction).toHaveBeenCalledTimes(1);
  });

  it("shows the route's message when the Coach refuses, such as an empty quota", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "quota", message: "Jatah 20 pesan hari ini habis, reset jam 00.00 WIB." }, { status: 429 }));
    render(<ExplainStep projectId={PROJECT} stepId={STEP} />);
    click();
    expect((await screen.findByRole("alert")).textContent).toBe("Jatah 20 pesan hari ini habis, reset jam 00.00 WIB.");
  });

  it("sends a member without a profile to the Coach page", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "bad_input", message: "Isiannya belum lengkap." }, { status: 400 }));
    render(<ExplainStep projectId={PROJECT} stepId={STEP} />);
    click();
    expect((await screen.findByRole("alert")).textContent).toContain("profil kamu belum diisi");
    expect(screen.getByRole("link", { name: "Buka Coach" }).getAttribute("href")).toBe("/coach");
  });
});

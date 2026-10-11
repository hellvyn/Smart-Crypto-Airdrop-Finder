// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ startCoachThreadAction: vi.fn() }));
vi.mock("@/app/(app)/coach/actions", () => actions);

import { CoachChat } from "@/components/coach/CoachChat";

const THREAD = "22222222-2222-4222-8222-222222222222";
const NEW_THREAD = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  actions.startCoachThreadAction.mockReset().mockResolvedValue({ ok: true, threadId: NEW_THREAD });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A streamed text/plain answer in the given pieces, with the headers the chat route sends. */
function streamed(pieces: string[], headers: Record<string, string> = {}, fail = false): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < pieces.length) controller.enqueue(encoder.encode(pieces[i++]));
      else if (fail) controller.error(new Error("broken"));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

const linksHeader = encodeURIComponent(JSON.stringify([{ name: "Alpha", href: "/projects/alpha" }]));
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText("Pertanyaan kamu"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Kirim" }));
};

describe("CoachChat", () => {
  it("shows the quota line and the disclaimer", () => {
    render(<CoachChat threadId={THREAD} projectId={null} remaining={17} />);
    expect(screen.getByTestId("coach-remaining").textContent).toBe("Sisa 17/20 pesan hari ini");
    expect(screen.getByText("Bukan nasihat keuangan. Tetap DYOR.")).toBeTruthy();
  });

  it("leaves the quota line out when the server could not count", () => {
    render(<CoachChat threadId={THREAD} projectId={null} remaining={null} />);
    expect(screen.queryByTestId("coach-remaining")).toBeNull();
  });

  it("streams the answer as plain text, links candidate names, and updates the quota", async () => {
    fetchMock.mockResolvedValue(streamed(["Mulai dari Alp", "ha, <b>santai</b> aja."], { "X-Coach-Links": linksHeader, "X-Coach-Remaining": "16" }));
    render(<CoachChat threadId={THREAD} projectId={null} remaining={17} />);
    ask("Mulai dari mana?");
    await waitFor(() => expect(screen.getByTestId("coach-remaining").textContent).toBe("Sisa 16/20 pesan hari ini"));
    const answer = screen.getByTestId("coach-answer");
    expect(answer.textContent).toBe("Mulai dari Alpha, <b>santai</b> aja.");
    expect(answer.querySelector("b")).toBeNull();
    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/projects/alpha");
    expect(answer.querySelectorAll("a")).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/coach/chat");
    expect(JSON.parse(init.body)).toEqual({ threadId: THREAD, message: "Mulai dari mana?", kind: "chat" });
    expect((screen.getByLabelText("Pertanyaan kamu") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the routes' quota message and takes the counter to zero", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "quota", message: "Jatah 20 pesan hari ini habis, reset jam 00.00 WIB." }, { status: 429 }),
    );
    render(<CoachChat threadId={THREAD} projectId={null} remaining={1} />);
    ask("Satu lagi");
    expect((await screen.findByRole("alert")).textContent).toBe("Jatah 20 pesan hari ini habis, reset jam 00.00 WIB.");
    expect(screen.getByTestId("coach-remaining").textContent).toBe("Sisa 0/20 pesan hari ini");
    expect((screen.getByRole("button", { name: "Kirim" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the unavailable copy, not a half answer, when the stream breaks", async () => {
    fetchMock.mockResolvedValue(streamed(["Setengah jawaban."], {}, true));
    render(<CoachChat threadId={THREAD} projectId={null} remaining={5} />);
    ask("Halo");
    expect((await screen.findByRole("alert")).textContent).toBe("Coach lagi gak bisa jawab, coba lagi sebentar.");
    expect(screen.queryByText(/Setengah jawaban/)).toBeNull();
  });

  it("opens a thread about the project on the first message when it has none yet", async () => {
    fetchMock.mockResolvedValue(streamed(["Siap."], { "X-Coach-Remaining": "19" }));
    render(<CoachChat threadId={null} projectId={PROJECT} remaining={20} />);
    ask("Apa ini?");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(actions.startCoachThreadAction).toHaveBeenCalledWith(PROJECT);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).threadId).toBe(NEW_THREAD);
    await waitFor(() => expect((screen.getByRole("button", { name: "Kirim" }) as HTMLButtonElement).disabled).toBe(false));
    fetchMock.mockResolvedValue(streamed(["Oke."]));
    ask("Lagi");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(actions.startCoachThreadAction).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).threadId).toBe(NEW_THREAD);
  });

  it("does not send an empty or too long message", () => {
    render(<CoachChat threadId={THREAD} projectId={null} remaining={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Kirim" }));
    ask("x".repeat(1001));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows earlier turns of a thread that was opened again", () => {
    render(
      <CoachChat
        threadId={THREAD}
        projectId={null}
        remaining={5}
        initialMessages={[
          { role: "user", text: "Halo" },
          { role: "assistant", text: "Hai juga." },
        ]}
      />,
    );
    expect(screen.getByText("Halo")).toBeTruthy();
    expect(screen.getByText("Hai juga.")).toBeTruthy();
  });
});

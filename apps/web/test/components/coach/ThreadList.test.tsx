// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ deleteCoachThread: vi.fn() }));
vi.mock("@/app/(public)/coach/actions", () => actions);

import { ThreadList } from "@/components/coach/ThreadList";
import type { ThreadRow } from "@/lib/coach-view";

afterEach(cleanup);

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";

const rows: ThreadRow[] = [
  { id: T1, createdAt: "2026-10-11T03:00:00.000Z", kind: "plan", projectName: null },
  { id: T2, createdAt: "2026-10-10T03:00:00.000Z", kind: "project", projectName: "Alpha" },
  { id: T3, createdAt: "2026-10-09T03:00:00.000Z", kind: "chat", projectName: null },
];

describe("ThreadList", () => {
  it("lists the threads newest first, each with its kind and date, and a way to open it", () => {
    render(<ThreadList threads={rows} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Rencana garapan");
    expect(items[1]!.textContent).toContain("Tanya AI: Alpha");
    expect(items[2]!.textContent).toContain("Percakapan");
    expect(items[0]!.textContent).toContain("11 Okt 2026");
    expect(within(items[0]!).getByRole("link", { name: "Buka" }).getAttribute("href")).toBe(`/coach?thread=${T1}`);
  });

  it("has a delete form per thread that carries only the thread id", () => {
    const { container } = render(<ThreadList threads={rows} />);
    const forms = [...container.querySelectorAll("form")];
    expect(forms).toHaveLength(3);
    expect(forms.map((f) => (f.querySelector("input[name=threadId]") as HTMLInputElement).value)).toEqual([T1, T2, T3]);
    expect(screen.getByRole("button", { name: "Hapus Tanya AI: Alpha" })).toBeTruthy();
  });

  it("says so when there is nothing", () => {
    render(<ThreadList threads={[]} />);
    expect(screen.getByText("Belum ada percakapan.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

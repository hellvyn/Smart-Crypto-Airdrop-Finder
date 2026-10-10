// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ submitStartFarming: vi.fn(), submitStopFarming: vi.fn() }));
vi.mock("@/app/(app)/garapan/actions", () => actions);

import { FarmButton } from "@/components/farming/FarmButton";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue(undefined);
});

const PID = "22222222-2222-4222-8222-222222222222";

async function sent(button: HTMLElement, action: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  fireEvent.click(button);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  return Object.fromEntries((action.mock.calls[0]![0] as FormData).entries());
}

describe("FarmButton", () => {
  it("renders nothing for a visitor: farming is for signed-in members only", () => {
    const { container } = render(<FarmButton projectId={PID} farming={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("starts farming for a signed-in member who is not farming yet", async () => {
    render(<FarmButton projectId={PID} farming={false} />);
    expect(screen.queryByRole("button", { name: "Berhenti garap" })).toBeNull();
    expect(await sent(screen.getByRole("button", { name: "Mulai garap" }), actions.submitStartFarming)).toEqual({ projectId: PID });
  });

  it("offers Berhenti garap and a way to the tracker while farming", async () => {
    render(<FarmButton projectId={PID} farming={true} />);
    expect(screen.queryByRole("button", { name: "Mulai garap" })).toBeNull();
    expect(screen.getByRole("link", { name: "Buka Garapan saya" }).getAttribute("href")).toBe("/garapan");
    expect(await sent(screen.getByRole("button", { name: "Berhenti garap" }), actions.submitStopFarming)).toEqual({ projectId: PID });
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";

afterEach(cleanup);

describe("not-found page", () => {
  it("says the page was not found, in Indonesian, with a way back to the list", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Halaman gak ketemu");
    expect(screen.getByText("Halamannya gak ada, atau udah dipindah.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Balik ke list" }).getAttribute("href")).toBe("/airdrops");
  });
});

describe("error page", () => {
  it("shows the generic message and a retry button, never the raw error", () => {
    const reset = vi.fn();
    const { container } = render(<ErrorPage error={new Error("relation public.secret does not exist")} reset={reset} />);
    expect(screen.getByRole("alert").textContent).toBe("Terjadi kesalahan. Coba lagi.");
    expect(container.textContent).not.toContain("secret");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

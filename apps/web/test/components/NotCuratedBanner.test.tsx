// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotCuratedBanner } from "@/components/NotCuratedBanner";

afterEach(cleanup);

describe("NotCuratedBanner", () => {
  it("says 'Gak masuk list: {alasan}'", () => {
    render(<NotCuratedBanner reason="Risiko tinggi" />);
    expect(screen.getByTestId("not-curated").textContent).toBe("Gak masuk list: Risiko tinggi");
  });

  it("renders the reason as plain text, never as markup", () => {
    const { container } = render(<NotCuratedBanner reason={'<img src=x onerror="alert(1)"> https://evil.example/'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByTestId("not-curated").textContent).toContain('<img src=x onerror="alert(1)">');
  });
});

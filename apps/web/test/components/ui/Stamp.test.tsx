// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Stamp } from "@/components/ui";

afterEach(cleanup);

function stamp(rotate: number) {
  render(<Stamp top="LOLOS" bottom="4/4 CEK" tone="pass" size="md" rotate={rotate} />);
  return screen.getByLabelText("LOLOS 4/4 CEK");
}

describe("Stamp", () => {
  it("labels itself with top and bottom text", () => {
    const el = stamp(0);
    expect(el.textContent).toContain("LOLOS");
    expect(el.textContent).toContain("4/4 CEK");
  });

  it.each([
    [30, "rotate(10deg)"],
    [-30, "rotate(-10deg)"],
    [-8, "rotate(-8deg)"],
    [0, "rotate(0deg)"],
  ])("rotation %i is applied as %s (clamped to -10..10)", (input, expected) => {
    expect(stamp(input).style.transform).toBe(expected);
  });

  it("ignores a non-finite rotation instead of emitting invalid CSS", () => {
    expect(stamp(Number.NaN).style.transform).toBe("rotate(0deg)");
  });

  it("exposes size and tone so ring width and colour can be styled", () => {
    render(<Stamp top="ENDED" bottom="" tone="ended" size="lg" rotate={5} />);
    const el = screen.getByLabelText("ENDED");
    expect(el.getAttribute("data-size")).toBe("lg");
    expect(el.getAttribute("data-tone")).toBe("ended");
  });
});

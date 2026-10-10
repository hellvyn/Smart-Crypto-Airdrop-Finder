// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberOnly } from "@/components/ui";

afterEach(cleanup);

describe("MemberOnly", () => {
  it("shows the Member only label with no button or link (no signup path, #46)", () => {
    const { container } = render(<MemberOnly title="Advanced check" />);
    expect(screen.getByText("Member only")).toBeTruthy();
    expect(container.querySelector("button, a, [role='button'], [role='link']")).toBeNull();
  });

  it("names the locked section for assistive tech", () => {
    render(<MemberOnly title="Advanced check" />);
    expect(screen.getByLabelText("Advanced check")).toBeTruthy();
  });
});

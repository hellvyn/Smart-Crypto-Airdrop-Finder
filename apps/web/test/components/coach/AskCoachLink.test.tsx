// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AskCoachLink } from "@/components/coach/AskCoachLink";

afterEach(cleanup);

const PID = "44444444-4444-4444-8444-444444444444";

describe("AskCoachLink", () => {
  it("is a link to the Coach page of the project for a member", () => {
    render(<AskCoachLink projectId={PID} member />);
    expect(screen.getByRole("link", { name: "Tanya AI" }).getAttribute("href")).toBe(`/coach?project=${PID}`);
  });

  it("is nothing at all for a visitor", () => {
    const { container } = render(<AskCoachLink projectId={PID} member={false} />);
    expect(container.innerHTML).toBe("");
  });
});

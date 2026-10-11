// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCard } from "@/components/ui";

afterEach(cleanup);

describe("SectionCard", () => {
  it("builds the numbered heading and shows badge and body", () => {
    render(
      <SectionCard number="01" title="AI verdict" badge="Analisis AI">
        <p>isi</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "01 · AI verdict" })).toBeTruthy();
    expect(screen.getByText("Analisis AI")).toBeTruthy();
    expect(screen.getByText("isi")).toBeTruthy();
  });

  it("uses the bare title without a number", () => {
    render(
      <SectionCard title="Ringkasan">
        <p>isi</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { name: "Ringkasan" })).toBeTruthy();
  });
});

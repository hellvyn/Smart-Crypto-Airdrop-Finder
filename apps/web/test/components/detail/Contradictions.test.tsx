// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Contradictions } from "@/components/detail/Contradictions";
import { SOURCE_A, SOURCE_B } from "../../fixtures/project-detail";

afterEach(cleanup);

const SOURCES = [SOURCE_A, SOURCE_B];
const item = {
  topic: "Token",
  quote_a: "No token has been announced yet",
  url_a: SOURCE_A,
  quote_b: "TGE expected in Q1",
  url_b: SOURCE_B,
  explanation: "Satu source bilang belum ada token, source lain udah nyebut tanggal TGE.",
};

describe("Contradictions", () => {
  it("is titled 02 · Sumber yang beda cerita", () => {
    render(<Contradictions items={[]} statusQuotes={[]} sourceUrls={SOURCES} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("02 · Sumber yang beda cerita");
  });

  it("shows each contradiction with both quotes and their sources", () => {
    render(<Contradictions items={[item]} statusQuotes={[]} sourceUrls={SOURCES} />);
    expect(screen.getByText(item.explanation)).toBeTruthy();
    expect(screen.getByText(/"No token has been announced yet"/)).toBeTruthy();
    expect(screen.getByText(/"TGE expected in Q1"/)).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["source 1", SOURCE_A],
      ["source 2", SOURCE_B],
    ]);
  });

  it("does not link a quote whose URL is not one of the project's sources, and renders markup as text", () => {
    const { container } = render(
      <Contradictions
        items={[{ ...item, explanation: "<script>x</script>", url_b: "https://other.example/" }]}
        statusQuotes={[]}
        sourceUrls={SOURCES}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>x</script>")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows the status quotes of sources that disagree on the status", () => {
    render(
      <Contradictions
        items={[]}
        statusQuotes={[
          { field: "status", value: "live", quote: "Airdrop is live", sourceUrl: SOURCE_A, at: "2026-10-08T00:00:00Z" },
          { field: "status", value: "ended", quote: "Airdrop has ended", sourceUrl: SOURCE_B, at: "2026-10-09T00:00:00Z" },
        ]}
        sourceUrls={SOURCES}
      />,
    );
    expect(screen.getByText("Source-nya gak sepakat soal status airdrop ini. Anggap aja statusnya belum pasti.")).toBeTruthy();
    const quotes = screen.getByRole("list", { name: "Kutipan status yang beda" });
    expect(within(quotes).getAllByRole("listitem")).toHaveLength(2);
    expect(within(quotes).getByText(/Airdrop has ended/)).toBeTruthy();
  });

  it("says so when no source disagrees", () => {
    render(<Contradictions items={[]} statusQuotes={[]} sourceUrls={SOURCES} />);
    expect(screen.getByText("Belum ada source yang beda cerita.")).toBeTruthy();
  });
});

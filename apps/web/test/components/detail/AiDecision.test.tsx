// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AiDecision } from "@/components/detail/AiDecision";
import { SOURCE_A, SOURCE_B, analyst } from "../../fixtures/project-detail";

afterEach(cleanup);

const SOURCES = [SOURCE_A, SOURCE_B];

describe("AiDecision", () => {
  it("is titled 01 · AI verdict and labelled Analisis AI", () => {
    render(<AiDecision member analyst={analyst()} sourceUrls={SOURCES} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("01 · AI verdict");
    expect(screen.getByText("Analisis AI")).toBeTruthy();
  });

  it("shows a visitor the box with Member only and nothing of the analysis", () => {
    const { container } = render(<AiDecision member={false} analyst={analyst()} sourceUrls={SOURCES} />);
    expect(screen.getByText("Member only")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Garap|Pantau|Skip|Confidence|Alokasi/);
    expect(container.querySelector("a, button")).toBeNull();
  });

  it("says Analisis AI belum tersedia to a member when there is no analysis", () => {
    render(<AiDecision member analyst={null} sourceUrls={SOURCES} />);
    expect(screen.getByText("Analisis AI belum tersedia")).toBeTruthy();
  });

  it("shows the verdict, the confidence and each point with its quote and source link", () => {
    render(<AiDecision member analyst={analyst()} sourceUrls={SOURCES} />);
    expect(screen.getByText("Garap")).toBeTruthy();
    expect(screen.getByText("Confidence: sedang")).toBeTruthy();
    expect(screen.getByText("Alokasi buat community udah ditulis di docs resmi.")).toBeTruthy();
    expect(screen.getByText(/"10% of supply is reserved for the community"/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "source" });
    expect(link.getAttribute("href")).toBe(SOURCE_A);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("renders markup in AI text as text, and a URL in it as no link", () => {
    const { container } = render(
      <AiDecision
        member
        analyst={analyst({
          points: [{ text: "<b>x</b> cek https://evil.example/claim", quote: "<img src=x onerror=alert(1)>", source_url: SOURCE_B }],
        })}
        sourceUrls={SOURCES}
      />,
    );
    expect(container.querySelector("b, img")).toBeNull();
    expect(screen.getByText("<b>x</b> cek https://evil.example/claim")).toBeTruthy();
    expect(container.querySelector("a[href*='evil.example']")).toBeNull();
    expect(screen.getByRole("link", { name: "source" }).getAttribute("href")).toBe(SOURCE_B);
  });

  it("links a point's source only when it is one of the project's source documents", () => {
    const { container } = render(
      <AiDecision
        member
        analyst={analyst({
          points: [{ text: "Poin.", quote: "quote", source_url: "https://phish.example/airdrop" }],
        })}
        sourceUrls={SOURCES}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("phish.example");
  });

  it("keeps the verdict without points and says no quote matched a source", () => {
    render(<AiDecision member analyst={analyst({ verdict: "pantau", confidence: "rendah", points: [] })} sourceUrls={SOURCES} />);
    expect(screen.getByText("Pantau")).toBeTruthy();
    expect(screen.getByText("Confidence: rendah")).toBeTruthy();
    expect(screen.getByText("Belum ada poin yang kutipannya cocok sama source, jadi verdict-nya kami tahan di Pantau.")).toBeTruthy();
  });
});

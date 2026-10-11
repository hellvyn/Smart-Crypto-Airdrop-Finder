// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LinkStatus, type LinkStatusValue } from "@/components/ui";

afterEach(cleanup);

describe("LinkStatus", () => {
  it("renders no anchor at all for a phishing link, and does not print the URL", () => {
    const { container } = render(<LinkStatus status="phishing" url="https://claim-airdrop.evil.example/x" />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Link di-hide: kedeteksi phishing")).toBeTruthy();
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("links an official URL safely and says so", () => {
    render(<LinkStatus status="official" url="https://nebula.example/claim" />);
    const link = screen.getByRole("link", { name: /nebula\.example/ });
    expect(link.getAttribute("href")).toBe("https://nebula.example/claim");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.getByText("✓ Official domain")).toBeTruthy();
  });

  it("warns on a different domain but still links it safely", () => {
    render(<LinkStatus status="different_domain" url="https://nebula-bonus.example" />);
    expect(screen.getByRole("link").getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.getByText("⚠ Beda domain dari web official")).toBeTruthy();
  });

  it("marks an unchecked link", () => {
    render(<LinkStatus status="unchecked" url="https://nebula.example" />);
    expect(screen.getByText("Belum dicek")).toBeTruthy();
  });

  it("treats a status outside the four known values as Belum dicek instead of crashing", () => {
    const { container } = render(<LinkStatus status={"suspended" as LinkStatusValue} url="https://nebula.example/app" />);
    expect(container.querySelector(".ui-tag")?.textContent).toBe("Belum dicek");
    expect(screen.getByRole("link").getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("never makes an anchor out of a non-http URL", () => {
    const { container } = render(<LinkStatus status="official" url="javascript:alert(1)" />);
    expect(container.querySelector("a")).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, HazardBar, HazardBlock, Tag, Ticket, WorthBadge } from "@/components/ui";

afterEach(cleanup);

describe("WorthBadge", () => {
  it.each([
    ["high", "Sangat worth it"],
    ["medium", "Worth it"],
    ["low", "Kurang worth it"],
    ["insufficient_data", "Data belum cukup"],
  ] as const)("level %s reads %s", (level, text) => {
    render(<WorthBadge level={level} />);
    expect(screen.getByText(text).getAttribute("data-level")).toBe(level);
  });
});

describe("Tag", () => {
  it("renders children with the tone", () => {
    render(<Tag tone="claimOpen">Claim open · link dicek</Tag>);
    expect(screen.getByText("Claim open · link dicek").getAttribute("data-tone")).toBe("claimOpen");
  });
});

describe("Button", () => {
  it("is a real button by default and carries the variant", () => {
    render(<Button variant="primary">Lihat airdrop</Button>);
    expect(screen.getByRole("button", { name: "Lihat airdrop" }).getAttribute("data-variant")).toBe("primary");
  });

  it("renders a link when given an href", () => {
    render(
      <Button variant="dark" href="/login">
        Login
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Login" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Ticket", () => {
  it("is a single link to the airdrop wrapping its content", () => {
    render(
      <Ticket href="/projects/nebula">
        <span>Nebula</span>
      </Ticket>,
    );
    expect(screen.getByRole("link", { name: "Nebula" }).getAttribute("href")).toBe("/projects/nebula");
  });
});

describe("HazardBar and HazardBlock", () => {
  it("the bar is decorative", () => {
    const { container } = render(<HazardBar />);
    expect((container.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("the block wraps its children", () => {
    render(
      <HazardBlock>
        <b>isi blok</b>
      </HazardBlock>,
    );
    expect(screen.getByText("isi blok")).toBeTruthy();
  });
});

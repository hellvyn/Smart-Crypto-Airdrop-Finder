// The security check card tells readers which warnings the scanner skips. That example must be one the scanner
// (@saf/core detectDangerousAsks) really skips, or the page would promise something false.
import { detectDangerousAsks } from "@saf/core";
import { describe, expect, it } from "vitest";
import { detail } from "@/lib/copy";

describe("the dangerous asks card", () => {
  it("quotes a warning example the scanner does not count", () => {
    const sentence = detail.safety.details.dangerous_asks(4);
    const example = /kayak "([^"]+)"/.exec(sentence)?.[1];
    expect(example).toBeDefined();
    expect(detectDangerousAsks([example!])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createCircuitBreaker } from "../src/circuit-breaker.js";

describe("createCircuitBreaker", () => {
  it("opens a model after the threshold of consecutive failures", () => {
    const breaker = createCircuitBreaker(3);
    breaker.recordFailure("m/one");
    breaker.recordFailure("m/one");
    expect(breaker.isOpen("m/one")).toBe(false);
    breaker.recordFailure("m/one");
    expect(breaker.isOpen("m/one")).toBe(true);
    expect(breaker.opened()).toEqual(["m/one"]);
  });

  it("resets the count on a success, so only consecutive failures trip it", () => {
    const breaker = createCircuitBreaker(3);
    breaker.recordFailure("m/one");
    breaker.recordFailure("m/one");
    breaker.recordSuccess("m/one");
    breaker.recordFailure("m/one");
    breaker.recordFailure("m/one");
    expect(breaker.isOpen("m/one")).toBe(false);
  });

  it("stays open for the rest of the run, even after a late success", () => {
    const breaker = createCircuitBreaker(2);
    breaker.recordFailure("m/one");
    breaker.recordFailure("m/one");
    breaker.recordSuccess("m/one");
    expect(breaker.isOpen("m/one")).toBe(true);
    breaker.recordFailure("m/one");
    expect(breaker.opened()).toEqual(["m/one"]);
  });

  it("tracks each model separately", () => {
    const breaker = createCircuitBreaker(2);
    breaker.recordFailure("m/one");
    breaker.recordFailure("m/two");
    breaker.recordFailure("m/two");
    expect(breaker.isOpen("m/one")).toBe(false);
    expect(breaker.isOpen("m/two")).toBe(true);
    expect(breaker.opened()).toEqual(["m/two"]);
  });
});

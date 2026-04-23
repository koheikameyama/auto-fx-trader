import { describe, it, expect } from "vitest";
import { isHighCorrelation } from "../correlation.js";

describe("isHighCorrelation", () => {
  it("EURUSD long + GBPUSD long → true", () => {
    expect(isHighCorrelation("EURUSD", "long", "GBPUSD", "long")).toBe(true);
  });

  it("GBPUSD short + EURUSD short → true (symmetric, both directions)", () => {
    expect(isHighCorrelation("GBPUSD", "short", "EURUSD", "short")).toBe(true);
  });

  it("EURUSD long + GBPUSD short → false (opposite sides)", () => {
    expect(isHighCorrelation("EURUSD", "long", "GBPUSD", "short")).toBe(false);
  });

  it("USDJPY + EURUSD → false (independent pair)", () => {
    expect(isHighCorrelation("USDJPY", "long", "EURUSD", "long")).toBe(false);
    expect(isHighCorrelation("USDJPY", "short", "EURUSD", "short")).toBe(false);
  });

  it("same pair same side → false (not what this function detects)", () => {
    // Same pair duplicate positions should be handled by portfolio-manager per-pair limit, not this function
    expect(isHighCorrelation("EURUSD", "long", "EURUSD", "long")).toBe(false);
  });
});

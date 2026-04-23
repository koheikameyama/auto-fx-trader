import { describe, it, expect } from "vitest";
import { pipsToJpy, jpyToUnits } from "../pip-value.js";

describe("pipsToJpy", () => {
  it("USDJPY: 1 pip × 10000 units = 100 JPY (independent of usdJpyRate)", () => {
    expect(pipsToJpy("USDJPY", 1, 10000, 150)).toBe(100);
    expect(pipsToJpy("USDJPY", 1, 10000, 110)).toBe(100);
  });

  it("EURUSD: 1 pip × 10000 units × USDJPY=150 = 150 JPY", () => {
    expect(pipsToJpy("EURUSD", 1, 10000, 150)).toBeCloseTo(150, 5);
  });

  it("GBPUSD: 1 pip × 10000 units × USDJPY=140 = 140 JPY", () => {
    expect(pipsToJpy("GBPUSD", 1, 10000, 140)).toBeCloseTo(140, 5);
  });

  it("scales linearly with units and pips", () => {
    expect(pipsToJpy("USDJPY", 2, 10000, 150)).toBe(200);
    expect(pipsToJpy("USDJPY", 1, 20000, 150)).toBe(200);
  });
});

describe("jpyToUnits", () => {
  it("USDJPY: 10000 JPY risk / 50 pips SL → 20000 units", () => {
    // 1 unit * 50 pips = 0.5 JPY risk
    // 10000 / 0.5 = 20000
    expect(jpyToUnits("USDJPY", 10000, 50, 150)).toBeCloseTo(20000, 0);
  });

  it("returns 0 when SL pips is 0 or negative", () => {
    expect(jpyToUnits("USDJPY", 10000, 0, 150)).toBe(0);
    expect(jpyToUnits("USDJPY", 10000, -5, 150)).toBe(0);
  });

  it("EURUSD: 15000 JPY / 100 pips @ USDJPY=150 → 10000 units", () => {
    // 1 unit * 100 pips = 1.5 JPY risk
    // 15000 / 1.5 = 10000
    expect(jpyToUnits("EURUSD", 15000, 100, 150)).toBeCloseTo(10000, 0);
  });
});

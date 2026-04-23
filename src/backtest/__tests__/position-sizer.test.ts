import { describe, it, expect } from "vitest";
import { calcPositionUnits } from "../position-sizer.js";

describe("calcPositionUnits", () => {
  it("USDJPY: 1M JPY * 1% risk / (50 pips SL) = 20000 units", () => {
    // riskJpy = 10000; perUnit loss = 50 pips × 0.01 × 1 = 0.5 JPY per unit
    // → 10000 / 0.5 = 20000 units
    expect(
      calcPositionUnits({
        equity: 1_000_000,
        riskRatio: 0.01,
        pair: "USDJPY",
        slPips: 50,
        usdJpyRate: 150,
      }),
    ).toBe(20000);
  });

  it("EURUSD: 1M JPY * 1% risk / (50 pips @ USDJPY=150) → expected units", () => {
    // perUnit loss = 50 pips × 0.0001 × 150 = 0.75 JPY per unit
    // riskJpy = 10000 → 10000 / 0.75 ≈ 13333 (floored)
    expect(
      calcPositionUnits({
        equity: 1_000_000,
        riskRatio: 0.01,
        pair: "EURUSD",
        slPips: 50,
        usdJpyRate: 150,
      }),
    ).toBe(13333);
  });

  it("returns 0 when slPips is 0", () => {
    expect(
      calcPositionUnits({
        equity: 1_000_000,
        riskRatio: 0.01,
        pair: "USDJPY",
        slPips: 0,
        usdJpyRate: 150,
      }),
    ).toBe(0);
  });

  it("returns 0 when slPips is negative", () => {
    expect(
      calcPositionUnits({
        equity: 1_000_000,
        riskRatio: 0.01,
        pair: "USDJPY",
        slPips: -10,
        usdJpyRate: 150,
      }),
    ).toBe(0);
  });

  it("returns floor (never fractional units)", () => {
    // riskJpy = 10000, 50 pips × 0.0001 × 160 = 0.8 JPY/unit → 12500 exactly
    // Use awkward rate to force fractional
    // 10000 / (50 × 0.0001 × 153) = 10000 / 0.765 ≈ 13071.89 → 13071
    const units = calcPositionUnits({
      equity: 1_000_000,
      riskRatio: 0.01,
      pair: "EURUSD",
      slPips: 50,
      usdJpyRate: 153,
    });
    expect(Number.isInteger(units)).toBe(true);
    expect(units).toBe(13071);
  });

  it("scales with equity and riskRatio", () => {
    const base = calcPositionUnits({
      equity: 1_000_000,
      riskRatio: 0.01,
      pair: "USDJPY",
      slPips: 50,
      usdJpyRate: 150,
    });
    const doubleEquity = calcPositionUnits({
      equity: 2_000_000,
      riskRatio: 0.01,
      pair: "USDJPY",
      slPips: 50,
      usdJpyRate: 150,
    });
    const doubleRisk = calcPositionUnits({
      equity: 1_000_000,
      riskRatio: 0.02,
      pair: "USDJPY",
      slPips: 50,
      usdJpyRate: 150,
    });
    expect(doubleEquity).toBe(base * 2);
    expect(doubleRisk).toBe(base * 2);
  });
});

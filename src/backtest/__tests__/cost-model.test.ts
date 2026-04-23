import { describe, it, expect } from "vitest";
import { applySpread, calcSwapJpy } from "../cost-model.js";

describe("applySpread", () => {
  it("USDJPY long adds spread_pips × 0.01 to rawPrice", () => {
    // USDJPY spread = 0.3 pips = 0.003 price
    expect(applySpread("USDJPY", "long", 150.0)).toBeCloseTo(150.003, 6);
  });

  it("USDJPY short subtracts spread_pips × 0.01 from rawPrice", () => {
    expect(applySpread("USDJPY", "short", 150.0)).toBeCloseTo(149.997, 6);
  });

  it("EURUSD long adds spread_pips × 0.0001", () => {
    // EURUSD spread = 0.3 pips = 0.00003 price
    expect(applySpread("EURUSD", "long", 1.085)).toBeCloseTo(1.08503, 8);
  });

  it("GBPUSD long with 0.8 pips spread", () => {
    // GBPUSD spread = 0.8 pips = 0.00008
    expect(applySpread("GBPUSD", "long", 1.26)).toBeCloseTo(1.26008, 8);
  });

  it("GBPUSD short subtracts 0.8 pips", () => {
    expect(applySpread("GBPUSD", "short", 1.26)).toBeCloseTo(1.25992, 8);
  });
});

describe("calcSwapJpy", () => {
  it("USDJPY long: +100 yen per 10000 units per day × 3 days = +30 (1 unit × 3)", () => {
    // Formula: (swapPerDay × units × days) / 10000
    // (100 × 10000 × 3) / 10000 = 300 JPY
    expect(calcSwapJpy("USDJPY", "long", 10000, 3)).toBe(300);
  });

  it("USDJPY short: -130 yen per 10000/day × 5 days = -650 JPY", () => {
    expect(calcSwapJpy("USDJPY", "short", 10000, 5)).toBe(-650);
  });

  it("EURUSD long: -50/10000/day × 2 days × 10000 units = -100", () => {
    // (-50 × 10000 × 2) / 10000 = -100
    expect(calcSwapJpy("EURUSD", "long", 10000, 2)).toBe(-100);
  });

  it("scales linearly with units and days", () => {
    const base = calcSwapJpy("USDJPY", "long", 10000, 1);
    expect(calcSwapJpy("USDJPY", "long", 20000, 1)).toBe(base * 2);
    expect(calcSwapJpy("USDJPY", "long", 10000, 5)).toBe(base * 5);
  });

  it("returns 0 when units is 0 or days is 0", () => {
    expect(calcSwapJpy("USDJPY", "long", 0, 5)).toBe(0);
    expect(calcSwapJpy("USDJPY", "long", 10000, 0)).toBe(0);
  });
});

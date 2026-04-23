import { describe, it, expect } from "vitest";
import { evaluateExit, type PositionState } from "../exit-manager.js";
import type { DailyBar } from "../../types/bar.js";
import type { ExitConfig } from "../../types/strategy.js";

const usdjpyCfg: ExitConfig = {
  useTrailing: true,
  timeStopDays: 10,
  timeStopMaxDays: 20,
  slAtrMultiplier: 1.0,
  beAtrMultiplier: 0.5,
  trailAtrMultiplier: 1.0,
};

function baseLong(): PositionState {
  // USDJPY long at 150.00, ATR 0.5, initial SL at 149.50
  return {
    pair: "USDJPY",
    side: "long",
    entryDate: new Date("2024-01-01"),
    entryPrice: 150.0,
    entryAtr: 0.5,
    units: 10000,
    currentSl: 149.5,
    highSinceEntry: 150.0,
    lowSinceEntry: 150.0,
    hasBreakEven: false,
  };
}

function baseShort(): PositionState {
  return {
    pair: "USDJPY",
    side: "short",
    entryDate: new Date("2024-01-01"),
    entryPrice: 150.0,
    entryAtr: 0.5,
    units: 10000,
    currentSl: 150.5,
    highSinceEntry: 150.0,
    lowSinceEntry: 150.0,
    hasBreakEven: false,
  };
}

function bar(open: number, high: number, low: number, close: number): DailyBar {
  return { date: new Date("2024-01-02"), open, high, low, close, volume: null };
}

describe("evaluateExit — long side", () => {
  it("no exit when bar stays within bounds", () => {
    const result = evaluateExit(baseLong(), bar(150.1, 150.3, 149.9, 150.2), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.highSinceEntry).toBeCloseTo(150.3, 5);
    expect(result.newState.lowSinceEntry).toBeCloseTo(149.9, 5);
  });

  it("SL hit when bar.low <= currentSl → exit at currentSl price", () => {
    const result = evaluateExit(baseLong(), bar(149.8, 150.0, 149.4, 149.7), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(149.5);
  });

  it("SL hit (exact touch) exits at SL price", () => {
    const result = evaluateExit(baseLong(), bar(149.8, 150.0, 149.5, 149.7), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(149.5);
  });

  it("BE promotion: highSinceEntry ≥ entry + ATR×0.5 → SL raised to entry", () => {
    // 150 + 0.5×0.5 = 150.25 threshold
    const result = evaluateExit(baseLong(), bar(150.1, 150.4, 150.0, 150.35), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(true);
    expect(result.newState.currentSl).toBe(150.0);
  });

  it("BE does NOT trigger if high just below threshold", () => {
    // high = 150.24 < 150.25 threshold
    const result = evaluateExit(baseLong(), bar(150.1, 150.24, 150.0, 150.2), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(false);
    expect(result.newState.currentSl).toBe(149.5);
  });

  it("trailing stop advances SL as high increases (after BE)", () => {
    // Start from BE state: SL=150, hasBE=true
    const afterBE: PositionState = { ...baseLong(), currentSl: 150.0, hasBreakEven: true, highSinceEntry: 150.4 };
    // New high 151.2, trail = 1.0 × ATR(0.5) = 0.5 → new SL = 151.2 - 0.5 = 150.7
    const result = evaluateExit(afterBE, bar(150.4, 151.2, 150.4, 151.0), 2, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.currentSl).toBeCloseTo(150.7, 5);
    expect(result.newState.highSinceEntry).toBeCloseTo(151.2, 5);
  });

  it("trailing stop does NOT lower SL when price retraces", () => {
    const withTrail: PositionState = { ...baseLong(), currentSl: 150.7, hasBreakEven: true, highSinceEntry: 151.2 };
    // New bar high 150.9 is lower than 151.2, new proposed trail = 150.9 - 0.5 = 150.4 < 150.7 → don't lower
    const result = evaluateExit(withTrail, bar(150.9, 150.9, 150.5, 150.8), 3, usdjpyCfg);
    expect(result.newState.currentSl).toBeCloseTo(150.7, 5);
    expect(result.newState.highSinceEntry).toBeCloseTo(151.2, 5);
  });

  it("time stop: daysHeld ≥ timeStopDays exits at close", () => {
    const result = evaluateExit(baseLong(), bar(150.1, 150.2, 149.95, 150.15), 10, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
    expect(result.exit.exitPrice).toBe(150.15);
  });

  it("time stop does NOT trigger if daysHeld < timeStopDays", () => {
    const result = evaluateExit(baseLong(), bar(150.1, 150.2, 149.95, 150.15), 9, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
  });

  it("SL takes precedence over time stop when both would trigger on same bar", () => {
    const result = evaluateExit(baseLong(), bar(149.8, 150.0, 149.3, 149.7), 10, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(149.5);
  });

  it("trailing SL touch on subsequent bar triggers trailing exit reason", () => {
    // SL has been trailed up to 150.7 after prior day's high=151.2
    const withTrail: PositionState = { ...baseLong(), currentSl: 150.7, hasBreakEven: true, highSinceEntry: 151.2 };
    // Today low 150.5 < 150.7 → exit at 150.7, reason "trailing"
    const result = evaluateExit(withTrail, bar(150.9, 151.0, 150.5, 150.8), 3, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("trailing");
    expect(result.exit.exitPrice).toBe(150.7);
  });
});

describe("evaluateExit — short side", () => {
  it("SL hit when bar.high >= currentSl", () => {
    const result = evaluateExit(baseShort(), bar(150.2, 150.6, 150.0, 150.3), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(150.5);
  });

  it("BE promotion: lowSinceEntry ≤ entry - ATR×0.5 → SL lowered to entry", () => {
    // 150 - 0.25 = 149.75 threshold
    const result = evaluateExit(baseShort(), bar(149.9, 150.0, 149.65, 149.8), 1, usdjpyCfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(true);
    expect(result.newState.currentSl).toBe(150.0);
  });

  it("trailing stop lowers SL as low decreases", () => {
    const afterBE: PositionState = { ...baseShort(), currentSl: 150.0, hasBreakEven: true, lowSinceEntry: 149.6 };
    // New low 148.8, trail = 0.5 → new SL = 148.8 + 0.5 = 149.3
    const result = evaluateExit(afterBE, bar(149.5, 149.6, 148.8, 149.0), 2, usdjpyCfg);
    expect(result.newState.currentSl).toBeCloseTo(149.3, 5);
    expect(result.newState.lowSinceEntry).toBeCloseTo(148.8, 5);
  });

  it("time stop triggers at close for short", () => {
    const result = evaluateExit(baseShort(), bar(149.9, 150.1, 149.8, 149.95), 10, usdjpyCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
    expect(result.exit.exitPrice).toBe(149.95);
  });
});

describe("evaluateExit — useTrailing=false", () => {
  const noTrailCfg: ExitConfig = { ...usdjpyCfg, useTrailing: false };

  it("does not update SL with trailing when disabled", () => {
    const afterBE: PositionState = { ...baseLong(), currentSl: 150.0, hasBreakEven: true, highSinceEntry: 150.4 };
    const result = evaluateExit(afterBE, bar(150.4, 151.2, 150.4, 151.0), 2, noTrailCfg);
    expect(result.newState.currentSl).toBe(150.0); // unchanged
    expect(result.newState.highSinceEntry).toBeCloseTo(151.2, 5);
  });

  it("time stop still works when trailing disabled", () => {
    const result = evaluateExit(baseLong(), bar(150.1, 150.2, 149.95, 150.15), 10, noTrailCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
  });
});

import { describe, it, expect } from "vitest";
import { evaluateExit, type PositionState } from "../exit-manager.js";
import type { DailyBar } from "../../types/bar.js";
import type { ExitConfig } from "../../types/strategy.js";

const baseCfg: ExitConfig = {
  useTrailing: false,
  timeStopDays: 999,
  timeStopMaxDays: 999,
  slAtrMultiplier: 999,
  beAtrMultiplier: 999,
  trailAtrMultiplier: 0,
  sessionEndUtcHour: 15,
};

function baseState(): PositionState {
  return {
    pair: "USDJPY",
    side: "long",
    entryDate: new Date("2026-01-15T07:00:00Z"),
    entryPrice: 150.0,
    entryAtr: 0.2,
    units: 10000,
    currentSl: 149.0,
    highSinceEntry: 150.0,
    lowSinceEntry: 150.0,
    hasBreakEven: false,
  };
}

function bar(date: string, open: number, high: number, low: number, close: number): DailyBar {
  return { date: new Date(date), open, high, low, close, volume: null };
}

describe("evaluateExit with sessionEndUtcHour", () => {
  it("force-closes when bar UTC hour reaches sessionEndUtcHour", () => {
    const result = evaluateExit(
      baseState(),
      bar("2026-01-15T15:00:00Z", 150.5, 150.6, 150.4, 150.55),
      0,
      baseCfg,
    );
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("session-end");
    expect(result.exit.exitPrice).toBe(150.55);
  });

  it("does not force-close before sessionEndUtcHour", () => {
    const result = evaluateExit(
      baseState(),
      bar("2026-01-15T14:00:00Z", 150.5, 150.6, 150.4, 150.55),
      0,
      baseCfg,
    );
    expect(result.exit.exited).toBe(false);
  });

  it("ignores sessionEndUtcHour when null", () => {
    const cfg: ExitConfig = { ...baseCfg, sessionEndUtcHour: null };
    const result = evaluateExit(
      baseState(),
      bar("2026-01-15T15:00:00Z", 150.5, 150.6, 150.4, 150.55),
      0,
      cfg,
    );
    expect(result.exit.exited).toBe(false);
  });
});

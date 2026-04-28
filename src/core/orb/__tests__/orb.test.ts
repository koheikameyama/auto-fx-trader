import { describe, it, expect } from "vitest";
import { orbStrategy } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function bar(iso: string, o: number, h: number, l: number, c: number): DailyBar {
  return { date: new Date(iso), open: o, high: h, low: l, close: c, volume: null };
}

describe("orbStrategy.generateSignals", () => {
  const params = {
    rangeHours: 3,
    atrMultStop: 1.5,
    atrPeriod: 14,
    sessionStartUtcHour: 7,
    sessionEndUtcHour: 15,
  };

  it("emits no signal when no breakout occurs in session", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    for (let h = 7; h < 15; h++) {
      bars.push(bar(`2026-01-15T${String(h).padStart(2, "0")}:00:00Z`, 150.0, 150.05, 149.95, 150.0));
    }
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(0);
  });

  it("emits long signal when bar after range window breaks above range high", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.10));
    bars.push(bar("2026-01-15T09:00:00Z", 150.10, 150.20, 150.00, 150.15));
    bars.push(bar("2026-01-15T10:00:00Z", 150.15, 150.40, 150.10, 150.35));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].side).toBe("long");
    expect(sigs[0].entryPrice).toBe(150.35);
    expect(sigs[0].date.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("emits short signal when bar after range window breaks below range low", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.00));
    bars.push(bar("2026-01-15T09:00:00Z", 150.00, 150.10, 149.90, 149.95));
    bars.push(bar("2026-01-15T10:00:00Z", 149.95, 150.00, 149.70, 149.75));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].side).toBe("short");
  });

  it("emits at most one signal per session day (first breakout wins)", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.10));
    bars.push(bar("2026-01-15T09:00:00Z", 150.10, 150.20, 150.00, 150.15));
    bars.push(bar("2026-01-15T10:00:00Z", 150.15, 150.40, 150.10, 150.35));
    bars.push(bar("2026-01-15T11:00:00Z", 150.35, 150.50, 150.30, 150.45));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].date.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("does not emit signals from bars outside the London session", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T03:00:00Z", 150.0, 151.0, 149.0, 151.0));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(0);
  });
});

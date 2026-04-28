import { describe, it, expect } from "vitest";
import { orbStrategy } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function bar(iso: string, o: number, h: number, l: number, c: number): DailyBar {
  return { date: new Date(iso), open: o, high: h, low: l, close: c, volume: null };
}

describe("orbStrategy.generateSignals", () => {
  const params = {
    rangeHours: 3,
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

  it("resets per-day state between sessions (day B range not polluted by day A)", () => {
    const bars: DailyBar[] = [];
    // Priming bars on 2026-01-13 for ATR(14) warmup
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-13T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }

    // Day A: 2026-01-14 — high range (around 200-201)
    bars.push(bar("2026-01-14T07:00:00Z", 200.0, 200.5, 199.9, 200.3));
    bars.push(bar("2026-01-14T08:00:00Z", 200.3, 200.8, 200.1, 200.6));
    bars.push(bar("2026-01-14T09:00:00Z", 200.6, 201.0, 200.4, 200.9));
    // Breakout bar above day A range high (201.0)
    bars.push(bar("2026-01-14T10:00:00Z", 200.9, 202.2, 200.8, 202.0));

    // Day B: 2026-01-15 — back to normal range (around 150-151)
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.5, 149.9, 150.3));
    bars.push(bar("2026-01-15T08:00:00Z", 150.3, 150.8, 150.1, 150.6));
    bars.push(bar("2026-01-15T09:00:00Z", 150.6, 151.0, 150.4, 150.9));
    // Breakout above day B range high (151.0) but BELOW day A range high (201.0).
    // If state didn't reset, this would not exceed rangeHigh=201 and no signal would fire.
    bars.push(bar("2026-01-15T10:00:00Z", 150.9, 152.2, 150.8, 152.0));

    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(2);
    expect(sigs[0].date.toISOString()).toBe("2026-01-14T10:00:00.000Z");
    expect(sigs[0].side).toBe("long");
    expect(sigs[1].date.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(sigs[1].side).toBe("long");
  });
});

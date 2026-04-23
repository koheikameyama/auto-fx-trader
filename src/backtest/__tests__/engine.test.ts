import { describe, it, expect } from "vitest";
import { runBacktest } from "../engine.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy, ExitConfig } from "../../types/strategy.js";

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function bar(
  date: Date,
  open: number,
  high: number,
  low: number,
  close: number,
): DailyBar {
  return { date, open, high, low, close, volume: null };
}

function mockStrategy(
  signals: EntrySignal[],
  exitCfg?: Partial<ExitConfig>,
): Strategy<Record<string, unknown>> {
  return {
    name: "mock",
    defaultParams: {},
    exitConfig: {
      useTrailing: true,
      timeStopDays: 100,
      timeStopMaxDays: 200,
      slAtrMultiplier: 1.0,
      beAtrMultiplier: 0.5,
      trailAtrMultiplier: 1.0,
      ...exitCfg,
    },
    generateSignals: () => signals,
  };
}

function makeRisingBars(
  startDate: string,
  startPrice: number,
  endPrice: number,
  days: number,
): DailyBar[] {
  const bars: DailyBar[] = [];
  const step = (endPrice - startPrice) / (days - 1);
  const base = mkDate(startDate).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * dayMs);
    const p = startPrice + step * i;
    bars.push(bar(d, p, p + 0.05, p - 0.05, p));
  }
  return bars;
}

describe("runBacktest", () => {
  it("handles empty bars input with zero KPIs", () => {
    const strat = mockStrategy([]);
    const result = runBacktest({
      bars: [],
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(0);
    expect(result.totalReturn).toBe(0);
    expect(result.sharpe).toBe(0);
    expect(result.mar).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.expectancy).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it("produces flat equity curve when no signals are generated", () => {
    const strat = mockStrategy([]);
    const bars: DailyBar[] = [];
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      const d = new Date(base + i * dayMs);
      bars.push(bar(d, 150, 150.5, 149.5, 150));
    }

    const result = runBacktest({
      bars,
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(10);
    for (const pt of result.equityCurve) {
      expect(pt.equity).toBe(1_000_000);
    }
    expect(result.totalReturn).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it("records a winning long trade when price rises and time stop exits", () => {
    // 30 bars rising from 150 -> 160, timeStopDays=20 so position exits on day 20
    const bars = makeRisingBars("2024-01-01", 150, 160, 30);
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        pair: "USDJPY",
        side: "long",
        entryPrice: 150,
        atr: 0.5,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 20 });

    const result = runBacktest({
      bars,
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.side).toBe("long");
    expect(t.pair).toBe("USDJPY");
    expect(t.pnlJpy).toBeGreaterThan(0);
    expect(t.pnlPips).toBeGreaterThan(0);
    expect(t.holdingDays).toBeGreaterThan(0);
    const finalEquity = result.equityCurve[result.equityCurve.length - 1].equity;
    expect(finalEquity).toBeGreaterThan(1_000_000);
    expect(result.totalReturn).toBeGreaterThan(0);
  });

  it("exits at stop loss when price drops sharply", () => {
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const bars: DailyBar[] = [];
    // Day 0: entry bar at 150
    bars.push(bar(new Date(base), 150, 150.3, 149.7, 150));
    // Day 1: sharp drop that touches SL (149.5 for long with ATR 0.5, slMul 1.0 => SL = entry - 0.5)
    // Entry with long spread will be slightly above 150, but SL = entry - 0.5 will be ~149.5
    bars.push(bar(new Date(base + dayMs), 149.8, 149.9, 148.0, 148.5));
    // Padding bars
    for (let i = 2; i < 5; i++) {
      bars.push(bar(new Date(base + i * dayMs), 148.5, 148.8, 148.2, 148.5));
    }

    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        pair: "USDJPY",
        side: "long",
        entryPrice: 150,
        atr: 0.5,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 100 });

    const result = runBacktest({
      bars,
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.side).toBe("long");
    expect(t.exitReason).toBe("sl");
    expect(t.pnlJpy).toBeLessThan(0);
  });

  it("produces trade with exitReason='time' when time stop triggers", () => {
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const bars: DailyBar[] = [];
    // flat price, no SL hit — force time stop
    for (let i = 0; i < 10; i++) {
      bars.push(bar(new Date(base + i * dayMs), 150, 150.05, 149.95, 150));
    }

    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        pair: "USDJPY",
        side: "long",
        entryPrice: 150,
        atr: 0.5,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 5 });

    const result = runBacktest({
      bars,
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("time");
  });

  it("force-closes an open position at end of data", () => {
    // Open a position and let data run out without triggering SL or time stop
    const bars = makeRisingBars("2024-01-01", 150, 150.5, 5);
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        pair: "USDJPY",
        side: "long",
        entryPrice: 150,
        atr: 0.5,
      },
    ];
    const strat = mockStrategy(signals, {
      timeStopDays: 100,
      timeStopMaxDays: 200,
    });

    const result = runBacktest({
      bars,
      pair: "USDJPY",
      strategy: strat,
      params: {},
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("end_of_data");
    expect(result.trades[0].exitDate.getTime()).toBe(
      bars[bars.length - 1].date.getTime(),
    );
  });
});

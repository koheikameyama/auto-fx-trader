import { describe, it, expect } from "vitest";
import { runWalkForward } from "../engine.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy } from "../../types/strategy.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function makeBars(
  startDate: string,
  startPrice: number,
  endPrice: number,
  days: number,
): DailyBar[] {
  const bars: DailyBar[] = [];
  const step = (endPrice - startPrice) / (days - 1);
  const base = mkDate(startDate).getTime();
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * DAY_MS);
    const p = startPrice + step * i;
    bars.push({
      date: d,
      open: p,
      high: p + 0.05,
      low: p - 0.05,
      close: p,
      volume: null,
    });
  }
  return bars;
}

interface TestParams extends Record<string, number> {
  startIndex: number;
  signalGap: number;
}

/**
 * Fast mock strategy: emits a long signal every `signalGap` bars. ATR fixed.
 */
const testStrategy: Strategy<TestParams> = {
  name: "wf-test",
  defaultParams: { startIndex: 1, signalGap: 5 },
  exitConfig: {
    useTrailing: false,
    timeStopDays: 3,
    timeStopMaxDays: 3,
    slAtrMultiplier: 2.0,
    beAtrMultiplier: 10,
    trailAtrMultiplier: 10,
  },
  generateSignals(bars, pair, params): EntrySignal[] {
    const signals: EntrySignal[] = [];
    for (
      let i = Math.max(1, params.startIndex);
      i < bars.length;
      i += params.signalGap
    ) {
      signals.push({
        date: bars[i].date,
        pair,
        side: "long",
        entryPrice: bars[i].close,
        atr: 0.5,
      });
    }
    return signals;
  },
};

describe("runWalkForward", () => {
  it("returns empty windows when data is shorter than isDays + oosDays", () => {
    const bars = makeBars("2024-01-01", 150, 151, 20);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays: 30,
      oosDays: 15,
      stepDays: 15,
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(0);
    expect(agg.oosAvgSharpe).toBe(0);
    expect(agg.oosAvgMar).toBe(0);
    expect(agg.oosAvgPf).toBe(0);
    expect(agg.oosMaxDd).toBe(0);
    expect(agg.oosAvgTotalReturn).toBe(0);
    expect(agg.isOosSharpeDrop).toBe(0);
  });

  it("produces exactly 1 window when bars length == isDays + oosDays", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 150, 160, isDays + oosDays);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 10,
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(1);
    const w = agg.windows[0];
    expect(w.windowIndex).toBe(0);
    expect(w.isStart.getTime()).toBe(bars[0].date.getTime());
    expect(w.isEnd.getTime()).toBe(bars[isDays - 1].date.getTime());
    expect(w.oosStart.getTime()).toBe(bars[isDays].date.getTime());
    expect(w.oosEnd.getTime()).toBe(bars[isDays + oosDays - 1].date.getTime());
    expect(w.bestParams.startIndex).toBe(1);
    expect(w.bestParams.signalGap).toBe(5);
  });

  it("produces multiple windows with step advancement", () => {
    const isDays = 30;
    const oosDays = 15;
    const stepDays = 15;
    // total 90 days: windows start at 0, 15, 30, 45 (next would need 45+45=90 ok),
    // 60 (60+45=105 > 90, stop). So starts: 0, 15, 30, 45 => 4 windows
    const bars = makeBars("2024-01-01", 150, 170, 90);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays,
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(4);
    // Windows should have sequential indices
    for (let i = 0; i < agg.windows.length; i++) {
      expect(agg.windows[i].windowIndex).toBe(i);
    }
    // The IS start of window 1 should equal bars[stepDays].date
    expect(agg.windows[1].isStart.getTime()).toBe(bars[stepDays].date.getTime());
  });

  it("aggregates oosAvgSharpe / oosMaxDd correctly across windows", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 150, 170, 60);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 15,
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    expect(agg.windows.length).toBeGreaterThan(0);
    // oosAvgSharpe should equal mean of window.oosSharpe values
    const mean =
      agg.windows.reduce((s, w) => s + w.oosSharpe, 0) / agg.windows.length;
    expect(agg.oosAvgSharpe).toBeCloseTo(mean, 10);
    // oosMaxDd should be the worst (largest) DD across windows
    const worstDd = Math.max(...agg.windows.map((w) => w.oosMaxDd));
    expect(agg.oosMaxDd).toBe(worstDd);
  });

  it("computes isOosSharpeDrop = (isAvg - oosAvg) / isAvg when isAvg > 0", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 150, 170, 60);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 15,
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    const isAvg =
      agg.windows.reduce((s, w) => s + w.isSharpe, 0) / agg.windows.length;
    const oosAvg =
      agg.windows.reduce((s, w) => s + w.oosSharpe, 0) / agg.windows.length;
    if (isAvg > 0) {
      expect(agg.isOosSharpeDrop).toBeCloseTo((isAvg - oosAvg) / isAvg, 10);
    } else {
      expect(agg.isOosSharpeDrop).toBe(0);
    }
  });
});

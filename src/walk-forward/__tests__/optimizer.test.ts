import { describe, it, expect } from "vitest";
import { optimizeStrategy } from "../optimizer.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy } from "../../types/strategy.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
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

/**
 * Test strategy: emits a long signal every `signalGap` bars starting at bar
 * index `startIndex`. ATR is fixed. This gives us parameter-dependent signal
 * patterns so the optimizer has different Sharpe outputs per combo.
 */
interface TestParams extends Record<string, number> {
  startIndex: number;
  signalGap: number;
}

const testStrategy: Strategy<TestParams> = {
  name: "test-opt",
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

describe("optimizeStrategy", () => {
  it("handles single-value grid (1 combo) and returns it", () => {
    const bars = makeRisingBars("2024-01-01", 150, 155, 40);
    const result = optimizeStrategy({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5] },
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });

    expect(result.allResults).toHaveLength(1);
    expect(result.bestParams.startIndex).toBe(1);
    expect(result.bestParams.signalGap).toBe(5);
  });

  it("iterates Cartesian product of multi-key grid", () => {
    const bars = makeRisingBars("2024-01-01", 150, 155, 40);
    const result = optimizeStrategy({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1, 5], signalGap: [5, 10] },
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    // 2 * 2 = 4 combos
    expect(result.allResults).toHaveLength(4);
    const combos = result.allResults.map(
      (r) => `${r.params.startIndex}-${r.params.signalGap}`,
    );
    expect(combos.sort()).toEqual(["1-10", "1-5", "5-10", "5-5"]);
  });

  it("picks combo with highest Sharpe (filters out tradeCount < 5)", () => {
    // Use rising bars so any long signals produce wins; each combo gives
    // different sharpe due to number of trades / timing. The combo with the
    // most trades (and >=5 trades) should typically win.
    const bars = makeRisingBars("2024-01-01", 150, 160, 60);
    const result = optimizeStrategy({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5, 30] },
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    // signalGap=30 produces only ~2 trades (filtered), signalGap=5 produces many.
    expect(result.bestParams.signalGap).toBe(5);
    const best = result.allResults.find(
      (r) => r.params.signalGap === result.bestParams.signalGap,
    );
    expect(best).toBeDefined();
    expect(best!.tradeCount).toBeGreaterThanOrEqual(5);
  });

  it("falls back to best-available combo when all have tradeCount < 5", () => {
    // Very few bars so all combos produce < 5 trades
    const bars = makeRisingBars("2024-01-01", 150, 151, 8);
    const result = optimizeStrategy({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1, 2], signalGap: [10] },
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    expect(result.allResults).toHaveLength(2);
    // Should still return a bestParams (not throw) even if all < 5
    expect(result.bestParams).toBeDefined();
    expect(typeof result.bestParams.startIndex).toBe("number");
  });

  it("reports Sharpe for each combo in allResults", () => {
    const bars = makeRisingBars("2024-01-01", 150, 160, 60);
    const result = optimizeStrategy({
      strategy: testStrategy,
      bars,
      pair: "USDJPY",
      paramGrid: { startIndex: [1], signalGap: [5, 7] },
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
    for (const r of result.allResults) {
      expect(typeof r.sharpe).toBe("number");
      expect(typeof r.tradeCount).toBe("number");
      expect(r.params).toBeDefined();
    }
  });
});

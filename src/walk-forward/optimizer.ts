import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { Strategy } from "../types/strategy.js";
import { runBacktest } from "../backtest/engine.js";

export interface OptimizerArgs<P extends Record<string, number>> {
  strategy: Strategy<P>;
  bars: DailyBar[];
  pair: PairSymbol;
  paramGrid: { [K in keyof P]: number[] };
  initialCapital: number;
  riskRatio: number;
  usdJpyRate?: number;
}

export interface OptimizerResult<P> {
  bestParams: P;
  bestSharpe: number;
  allResults: Array<{ params: P; sharpe: number; tradeCount: number }>;
}

/**
 * Minimum number of trades required for a combo's Sharpe to be considered
 * reliable. Combos below this threshold are deprioritized.
 */
const MIN_TRADE_COUNT = 5;

function cartesian<P extends Record<string, number>>(
  grid: { [K in keyof P]: number[] },
): P[] {
  const keys = Object.keys(grid) as (keyof P)[];
  let combos: Partial<P>[] = [{}];
  for (const k of keys) {
    const next: Partial<P>[] = [];
    for (const c of combos) {
      for (const v of grid[k]) {
        next.push({ ...c, [k]: v });
      }
    }
    combos = next;
  }
  return combos as P[];
}

/**
 * Normalize a Sharpe value to a finite comparable number.
 * Infinity/NaN would make max comparisons unreliable.
 */
function normalizeSharpe(s: number): number {
  if (Number.isNaN(s)) return Number.NEGATIVE_INFINITY;
  if (s === Infinity) return Number.MAX_SAFE_INTEGER;
  if (s === -Infinity) return Number.NEGATIVE_INFINITY;
  return s;
}

/**
 * Grid-search optimizer: evaluates every combination in `paramGrid` by running
 * a backtest, then returns the combo with the highest Sharpe ratio.
 *
 * Combos with fewer than MIN_TRADE_COUNT trades are filtered out (Sharpe
 * with very few trades is unreliable). If no combo meets the threshold, the
 * best of the low-trade-count combos is returned as a fallback.
 */
export function optimizeStrategy<P extends Record<string, number>>(
  args: OptimizerArgs<P>,
): OptimizerResult<P> {
  const {
    strategy,
    bars,
    pair,
    paramGrid,
    initialCapital,
    riskRatio,
    usdJpyRate,
  } = args;

  const combos = cartesian(paramGrid);
  const allResults: Array<{ params: P; sharpe: number; tradeCount: number }> =
    [];

  for (const params of combos) {
    const r = runBacktest({
      bars,
      pair,
      strategy,
      params,
      initialCapital,
      riskRatio,
      usdJpyRate,
    });
    allResults.push({
      params,
      sharpe: r.sharpe,
      tradeCount: r.tradeCount,
    });
  }

  // Primary: combos with tradeCount >= MIN_TRADE_COUNT, pick highest Sharpe.
  // Fallback: if none qualify, pick highest Sharpe among all combos.
  const qualified = allResults.filter((r) => r.tradeCount >= MIN_TRADE_COUNT);
  const pool = qualified.length > 0 ? qualified : allResults;

  let best = pool[0];
  for (const r of pool) {
    if (normalizeSharpe(r.sharpe) > normalizeSharpe(best.sharpe)) {
      best = r;
    }
  }

  return {
    bestParams: best.params,
    bestSharpe: best.sharpe,
    allResults,
  };
}

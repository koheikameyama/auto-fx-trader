import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { Strategy } from "../types/strategy.js";
import { runBacktest } from "../backtest/engine.js";
import { optimizeStrategy } from "./optimizer.js";

export interface WfEngineArgs<P extends Record<string, number>> {
  strategy: Strategy<P>;
  bars: DailyBar[];
  pair: PairSymbol;
  paramGrid: { [K in keyof P]: number[] };
  isDays: number;
  oosDays: number;
  stepDays: number;
  initialCapital: number;
  riskRatio: number;
  usdJpyRate?: number;
}

export interface WfWindowResult<P> {
  windowIndex: number;
  isStart: Date;
  isEnd: Date;
  oosStart: Date;
  oosEnd: Date;
  bestParams: P;
  isSharpe: number;
  oosSharpe: number;
  oosMar: number;
  oosPf: number;
  oosMaxDd: number;
  oosTrades: number;
  oosTotalReturn: number;
}

export interface WfAggregate<P> {
  windows: WfWindowResult<P>[];
  oosAvgSharpe: number;
  oosAvgMar: number;
  oosAvgPf: number;
  oosMaxDd: number;
  oosAvgTotalReturn: number;
  isOosSharpeDrop: number;
}

/**
 * Clamp non-finite KPI values to a finite sentinel so aggregation math stays
 * well-defined. Mirrors the pattern used in backtest runner-helpers.
 */
function safeKpi(n: number, max = 10): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/**
 * Walk-Forward analysis driver.
 *
 * Slides an (IS + OOS) window across the full bar series, runs grid-search on
 * the IS slice, then evaluates the best params on the adjacent OOS slice.
 * Aggregates per-window OOS KPIs for downstream robustness checks.
 */
export function runWalkForward<P extends Record<string, number>>(
  args: WfEngineArgs<P>,
): WfAggregate<P> {
  const {
    strategy,
    bars,
    pair,
    paramGrid,
    isDays,
    oosDays,
    stepDays,
    initialCapital,
    riskRatio,
    usdJpyRate,
  } = args;

  const windows: WfWindowResult<P>[] = [];
  const totalBars = bars.length;

  for (
    let windowStart = 0, idx = 0;
    windowStart + isDays + oosDays <= totalBars;
    windowStart += stepDays, idx++
  ) {
    const isBars = bars.slice(windowStart, windowStart + isDays);
    const oosBars = bars.slice(
      windowStart + isDays,
      windowStart + isDays + oosDays,
    );

    const opt = optimizeStrategy({
      strategy,
      bars: isBars,
      pair,
      paramGrid,
      initialCapital,
      riskRatio,
      usdJpyRate,
    });

    const oos = runBacktest({
      bars: oosBars,
      pair,
      strategy,
      params: opt.bestParams,
      initialCapital,
      riskRatio,
      usdJpyRate,
    });

    windows.push({
      windowIndex: idx,
      isStart: isBars[0].date,
      isEnd: isBars[isBars.length - 1].date,
      oosStart: oosBars[0].date,
      oosEnd: oosBars[oosBars.length - 1].date,
      bestParams: opt.bestParams,
      isSharpe: safeKpi(opt.bestSharpe),
      oosSharpe: safeKpi(oos.sharpe),
      oosMar: safeKpi(oos.mar),
      oosPf: safeKpi(oos.profitFactor),
      oosMaxDd: oos.maxDrawdown,
      oosTrades: oos.tradeCount,
      oosTotalReturn: oos.totalReturn,
    });
  }

  if (windows.length === 0) {
    return {
      windows: [],
      oosAvgSharpe: 0,
      oosAvgMar: 0,
      oosAvgPf: 0,
      oosMaxDd: 0,
      oosAvgTotalReturn: 0,
      isOosSharpeDrop: 0,
    };
  }

  const oosAvgSharpe = average(windows.map((w) => w.oosSharpe));
  const oosAvgMar = average(windows.map((w) => w.oosMar));
  const oosAvgPf = average(windows.map((w) => w.oosPf));
  const oosMaxDd = Math.max(...windows.map((w) => w.oosMaxDd));
  const oosAvgTotalReturn = average(windows.map((w) => w.oosTotalReturn));

  const isAvgSharpe = average(windows.map((w) => w.isSharpe));
  const isOosSharpeDrop =
    isAvgSharpe > 0 ? (isAvgSharpe - oosAvgSharpe) / isAvgSharpe : 0;

  return {
    windows,
    oosAvgSharpe,
    oosAvgMar,
    oosAvgPf,
    oosMaxDd,
    oosAvgTotalReturn,
    isOosSharpeDrop,
  };
}

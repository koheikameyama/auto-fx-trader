import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { EntrySignal } from "../types/signal.js";
import type { Strategy } from "../types/strategy.js";
import type { BacktestTrade, ExitReason } from "../types/trade.js";
import { calcPositionUnits } from "./position-sizer.js";
import { applySpread, calcSwapJpy } from "./cost-model.js";
import { evaluateExit, type PositionState } from "./exit-manager.js";
import { pipsToJpy } from "../lib/pip-value.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";

export interface BacktestInput<P> {
  bars: DailyBar[];
  pair: PairSymbol;
  strategy: Strategy<P>;
  params: P;
  initialCapital: number;
  riskRatio: number;
  usdJpyRate?: number;
}

export interface EquityPoint {
  date: Date;
  equity: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  totalReturn: number;
  sharpe: number;
  mar: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  tradeCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_USDJPY_RATE = 150;

function pipSize(pair: PairSymbol): number {
  return pair === "USDJPY" ? 0.01 : 0.0001;
}

function resolveUsdJpyRate(
  pair: PairSymbol,
  bar: DailyBar,
  override: number | undefined,
): number {
  if (pair === "USDJPY") return bar.close;
  if (override !== undefined) return override;
  return FALLBACK_USDJPY_RATE;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function computePnlPips(
  side: "long" | "short",
  entryPrice: number,
  exitPrice: number,
  pair: PairSymbol,
): number {
  const raw =
    side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return raw / pipSize(pair);
}

function indexSignalsByDate(signals: EntrySignal[]): Map<number, EntrySignal> {
  const map = new Map<number, EntrySignal>();
  for (const sig of signals) {
    const key = sig.date.getTime();
    // If multiple signals on same day, first one wins
    if (!map.has(key)) {
      map.set(key, sig);
    }
  }
  return map;
}

export function runBacktest<P>(input: BacktestInput<P>): BacktestResult {
  const {
    bars,
    pair,
    strategy,
    params,
    initialCapital,
    riskRatio,
    usdJpyRate,
  } = input;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  if (bars.length === 0) {
    return {
      trades: [],
      equityCurve: [],
      totalReturn: 0,
      sharpe: 0,
      mar: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      winRate: 0,
      expectancy: 0,
      tradeCount: 0,
    };
  }

  const signals = strategy.generateSignals(bars, pair, params);
  const signalMap = indexSignalsByDate(signals);

  let cash = initialCapital;
  let position: PositionState | null = null;

  for (let i = 0; i < bars.length; i++) {
    const curBar = bars[i];

    // 1. If position open, evaluate exit
    if (position !== null) {
      const daysHeld = daysBetween(position.entryDate, curBar.date);
      const { newState, exit } = evaluateExit(
        position,
        curBar,
        daysHeld,
        strategy.exitConfig,
      );
      position = newState;

      if (exit.exited && exit.exitPrice !== undefined && exit.exitReason) {
        const exitPrice = exit.exitPrice;
        const holdingDays = daysHeld;
        const pnlPips = computePnlPips(
          position.side,
          position.entryPrice,
          exitPrice,
          pair,
        );
        const rate = resolveUsdJpyRate(pair, curBar, usdJpyRate);
        const priceJpy = pipsToJpy(pair, pnlPips, position.units, rate);
        const swap = calcSwapJpy(
          pair,
          position.side,
          position.units,
          holdingDays,
        );
        const pnlJpy = priceJpy + swap;

        trades.push({
          pair,
          strategy: strategy.name,
          side: position.side,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: curBar.date,
          exitPrice,
          exitReason: exit.exitReason as ExitReason,
          sizeUnits: position.units,
          pnlPips,
          pnlJpy,
          holdingDays,
        });

        cash += pnlJpy;
        position = null;
      }
    }

    // 2. If no position, check for new signal on this bar
    if (position === null) {
      const sig = signalMap.get(curBar.date.getTime());
      if (sig && Number.isFinite(curBar.close) && sig.atr > 0) {
        const rate = resolveUsdJpyRate(pair, curBar, usdJpyRate);
        const slDistance = strategy.exitConfig.slAtrMultiplier * sig.atr;
        const slPips = slDistance / pipSize(pair);
        const sizeUnits = calcPositionUnits({
          equity: cash,
          riskRatio,
          pair,
          slPips,
          usdJpyRate: rate,
        });
        if (sizeUnits > 0) {
          const entryPrice = applySpread(pair, sig.side, curBar.close);
          const initialSl =
            sig.side === "long"
              ? entryPrice - slDistance
              : entryPrice + slDistance;
          position = {
            pair,
            side: sig.side,
            entryDate: curBar.date,
            entryPrice,
            entryAtr: sig.atr,
            units: sizeUnits,
            currentSl: initialSl,
            highSinceEntry: curBar.high,
            lowSinceEntry: curBar.low,
            hasBreakEven: false,
          };
        }
      }
    }

    // 3. Record equity point (cash + unrealized MtM of any open position)
    let unrealized = 0;
    if (position !== null) {
      const holdDays = daysBetween(position.entryDate, curBar.date);
      const pnlPips = computePnlPips(
        position.side,
        position.entryPrice,
        curBar.close,
        pair,
      );
      const rate = resolveUsdJpyRate(pair, curBar, usdJpyRate);
      unrealized =
        pipsToJpy(pair, pnlPips, position.units, rate) +
        calcSwapJpy(pair, position.side, position.units, holdDays);
    }
    equityCurve.push({ date: curBar.date, equity: cash + unrealized });
  }

  // Force-close position at end of data, if open
  if (position !== null) {
    const lastBar = bars[bars.length - 1];
    const exitPrice = lastBar.close;
    const holdingDays = daysBetween(position.entryDate, lastBar.date);
    const pnlPips = computePnlPips(
      position.side,
      position.entryPrice,
      exitPrice,
      pair,
    );
    const rate = resolveUsdJpyRate(pair, lastBar, usdJpyRate);
    const priceJpy = pipsToJpy(pair, pnlPips, position.units, rate);
    const swap = calcSwapJpy(pair, position.side, position.units, holdingDays);
    const pnlJpy = priceJpy + swap;

    trades.push({
      pair,
      strategy: strategy.name,
      side: position.side,
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: lastBar.date,
      exitPrice,
      exitReason: "end_of_data",
      sizeUnits: position.units,
      pnlPips,
      pnlJpy,
      holdingDays,
    });

    cash += pnlJpy;
    position = null;

    // Update final equity point to reflect realized PnL (not unrealized)
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: lastBar.date,
        equity: cash,
      };
    }
  }

  // KPIs
  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) {
      returns.push((equityCurve[i].equity - prev) / prev);
    }
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));

  const firstDate = equityCurve[0]?.date ?? bars[0].date;
  const lastDate =
    equityCurve[equityCurve.length - 1]?.date ?? bars[bars.length - 1].date;
  const years = (lastDate.getTime() - firstDate.getTime()) / (365.25 * DAY_MS);
  const annualized = annualReturn(totalReturn, years);
  const mar = marRatio(annualized, mdd);

  const pnls = trades.map((t) => t.pnlJpy);
  const pf = profitFactor(pnls);
  const wr = winRate(pnls);
  const exp = expectancy(pnls);

  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: pf,
    maxDrawdown: mdd,
    winRate: wr,
    expectancy: exp,
    tradeCount: trades.length,
  };
}

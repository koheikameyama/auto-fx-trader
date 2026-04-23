import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { EntrySignal } from "../types/signal.js";
import type { Strategy, ExitConfig } from "../types/strategy.js";
import type { BacktestTrade, ExitReason } from "../types/trade.js";
import { donchianStrategy } from "../core/donchian/index.js";
import { maCrossoverStrategy } from "../core/ma-crossover/index.js";
import { rsiReversionStrategy } from "../core/rsi-reversion/index.js";
import { nr7BreakoutStrategy } from "../core/nr7-breakout/index.js";
import { PAIRS } from "../data/pair-config.js";
import { loadBars } from "./runner-helpers.js";
import { calcPositionUnits } from "./position-sizer.js";
import { applySpread, calcSwapJpy } from "./cost-model.js";
import { evaluateExit, type PositionState } from "./exit-manager.js";
import { pipsToJpy } from "../lib/pip-value.js";
import { PortfolioManager, type OpenPosition } from "./portfolio-manager.js";
import type { BacktestResult, EquityPoint } from "./engine.js";
import { writeBacktestReport } from "../reports/markdown-writer.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_USDJPY_RATE = 150;

function parseArgs(): { years: number } {
  let years = 10;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--years=")) years = Number(a.slice("--years=".length));
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!Number.isFinite(years) || years <= 0) throw new Error(`Invalid years: ${years}`);
  return { years };
}

const pipSize = (p: PairSymbol) => (p === "USDJPY" ? 0.01 : 0.0001);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

function computePnlPips(
  side: "long" | "short",
  entry: number,
  exit: number,
  pair: PairSymbol,
): number {
  const raw = side === "long" ? exit - entry : entry - exit;
  return raw / pipSize(pair);
}

function safeKpi(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface StrategyDef { strategy: Strategy<any>; params: any }

interface PortfolioPosition extends PositionState {
  strategy: string;
  exitConfig: ExitConfig;
}

interface PnlBreakdown {
  priceJpy: number;
  swap: number;
  total: number;
  pnlPips: number;
}

function rateAt(
  pair: PairSymbol,
  bar: DailyBar,
  usdJpyByTime: Map<number, DailyBar>,
  t: number,
): number {
  if (pair === "USDJPY") return bar.close;
  const u = usdJpyByTime.get(t);
  return u ? u.close : FALLBACK_USDJPY_RATE;
}

function closePnl(
  pos: PortfolioPosition,
  exitPrice: number,
  exitDate: Date,
  rate: number,
): PnlBreakdown {
  const holdingDays = daysBetween(pos.entryDate, exitDate);
  const pnlPips = computePnlPips(pos.side, pos.entryPrice, exitPrice, pos.pair);
  const priceJpy = pipsToJpy(pos.pair, pnlPips, pos.units, rate);
  const swap = calcSwapJpy(pos.pair, pos.side, pos.units, holdingDays);
  return { priceJpy, swap, total: priceJpy + swap, pnlPips };
}

interface CombinedRunInput {
  barsByPair: Map<PairSymbol, DailyBar[]>;
  strategies: StrategyDef[];
  initialCapital: number;
  riskRatio: number;
}

function runCombinedBacktest(input: CombinedRunInput): BacktestResult {
  const { barsByPair, strategies, initialCapital, riskRatio } = input;

  // Pre-compute all signals, indexed by "strategy|pair|time"
  const signalIndex = new Map<string, EntrySignal>();
  for (const def of strategies) {
    for (const pair of PAIRS) {
      const bars = barsByPair.get(pair);
      if (!bars || bars.length === 0) continue;
      for (const s of def.strategy.generateSignals(bars, pair, def.params)) {
        const key = `${def.strategy.name}|${pair}|${s.date.getTime()}`;
        if (!signalIndex.has(key)) signalIndex.set(key, s);
      }
    }
  }

  // Union of all dates, sorted
  const dateSet = new Set<number>();
  for (const pair of PAIRS) {
    for (const b of barsByPair.get(pair) ?? []) dateSet.add(b.date.getTime());
  }
  const dates = Array.from(dateSet).sort((a, b) => a - b);
  if (dates.length === 0) {
    return {
      trades: [], equityCurve: [], totalReturn: 0, sharpe: 0, mar: 0,
      profitFactor: 0, maxDrawdown: 0, winRate: 0, expectancy: 0, tradeCount: 0,
    };
  }

  // Per-pair bar-by-time lookup
  const barByPairTime = new Map<PairSymbol, Map<number, DailyBar>>();
  for (const pair of PAIRS) {
    const m = new Map<number, DailyBar>();
    for (const b of barsByPair.get(pair) ?? []) m.set(b.date.getTime(), b);
    barByPairTime.set(pair, m);
  }
  const usdJpyByTime = barByPairTime.get("USDJPY") ?? new Map<number, DailyBar>();

  const pm = new PortfolioManager();
  let cash = initialCapital;
  let openPositions: PortfolioPosition[] = [];
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (const t of dates) {
    // 1. Evaluate exits
    const stillOpen: PortfolioPosition[] = [];
    for (const pos of openPositions) {
      const bar = barByPairTime.get(pos.pair)?.get(t);
      if (!bar) {
        stillOpen.push(pos);
        continue;
      }
      const daysHeld = daysBetween(pos.entryDate, bar.date);
      const { newState, exit } = evaluateExit(pos, bar, daysHeld, pos.exitConfig);
      if (exit.exited && exit.exitPrice !== undefined && exit.exitReason) {
        const rate = rateAt(pos.pair, bar, usdJpyByTime, t);
        const pnl = closePnl(pos, exit.exitPrice, bar.date, rate);
        trades.push({
          pair: pos.pair,
          strategy: pos.strategy,
          side: pos.side,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: bar.date,
          exitPrice: exit.exitPrice,
          exitReason: exit.exitReason as ExitReason,
          sizeUnits: pos.units,
          pnlPips: pnl.pnlPips,
          pnlJpy: pnl.total,
          holdingDays: daysHeld,
        });
        cash += pnl.total;
      } else {
        stillOpen.push({ ...pos, ...newState });
      }
    }
    openPositions = stillOpen;

    // 2. Collect firing signal candidates across (strategy, pair) in canonical order
    for (const def of strategies) {
      for (const pair of PAIRS) {
        const sig = signalIndex.get(`${def.strategy.name}|${pair}|${t}`);
        if (!sig) continue;
        // Skip if already holding same (strategy, pair) slot
        if (openPositions.some((p) => p.strategy === def.strategy.name && p.pair === pair))
          continue;

        const snapshot: OpenPosition[] = openPositions.map((p) => ({
          pair: p.pair, strategy: p.strategy, side: p.side,
        }));
        const decision = pm.canOpen(
          { pair, strategy: def.strategy.name, side: sig.side },
          snapshot,
        );
        if (!decision.allowed) continue;

        const bar = barByPairTime.get(pair)?.get(t);
        if (!bar || !Number.isFinite(bar.close) || sig.atr <= 0) continue;
        const rate = rateAt(pair, bar, usdJpyByTime, t);
        const slDistance = def.strategy.exitConfig.slAtrMultiplier * sig.atr;
        const slPips = slDistance / pipSize(pair);
        const units = calcPositionUnits({
          equity: cash, riskRatio, pair, slPips, usdJpyRate: rate,
        });
        if (units <= 0) continue;

        const entryPrice = applySpread(pair, sig.side, bar.close);
        const initialSl = sig.side === "long"
          ? entryPrice - slDistance
          : entryPrice + slDistance;
        openPositions.push({
          pair,
          side: sig.side,
          entryDate: bar.date,
          entryPrice,
          entryAtr: sig.atr,
          units,
          currentSl: initialSl,
          highSinceEntry: bar.high,
          lowSinceEntry: bar.low,
          hasBreakEven: false,
          strategy: def.strategy.name,
          exitConfig: def.strategy.exitConfig,
        });
      }
    }

    // 3. Record equity: cash + unrealized MtM for all open positions
    let unrealized = 0;
    for (const pos of openPositions) {
      const bar = barByPairTime.get(pos.pair)?.get(t);
      if (!bar) continue;
      const rate = rateAt(pos.pair, bar, usdJpyByTime, t);
      const pnl = closePnl(pos, bar.close, bar.date, rate);
      unrealized += pnl.total;
    }
    equityCurve.push({ date: new Date(t), equity: cash + unrealized });
  }

  // Force-close remaining positions at each pair's last bar
  if (openPositions.length > 0) {
    const lastT = dates[dates.length - 1];
    for (const pos of openPositions) {
      const pairBars = barsByPair.get(pos.pair);
      if (!pairBars || pairBars.length === 0) continue;
      let lastBar: DailyBar | null = null;
      for (let i = pairBars.length - 1; i >= 0; i--) {
        if (pairBars[i].date.getTime() <= lastT) { lastBar = pairBars[i]; break; }
      }
      if (!lastBar) continue;
      const rate = rateAt(pos.pair, lastBar, usdJpyByTime, lastBar.date.getTime());
      const pnl = closePnl(pos, lastBar.close, lastBar.date, rate);
      trades.push({
        pair: pos.pair,
        strategy: pos.strategy,
        side: pos.side,
        entryDate: pos.entryDate,
        entryPrice: pos.entryPrice,
        exitDate: lastBar.date,
        exitPrice: lastBar.close,
        exitReason: "end_of_data",
        sizeUnits: pos.units,
        pnlPips: pnl.pnlPips,
        pnlJpy: pnl.total,
        holdingDays: daysBetween(pos.entryDate, lastBar.date),
      });
      cash += pnl.total;
    }
    openPositions = [];
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: equityCurve[equityCurve.length - 1].date,
        equity: cash,
      };
    }
  }

  // KPIs
  const finalEquity = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));
  const firstDate = equityCurve[0]?.date ?? new Date(dates[0]);
  const lastDate = equityCurve[equityCurve.length - 1]?.date ?? new Date(dates[dates.length - 1]);
  const years = (lastDate.getTime() - firstDate.getTime()) / (365.25 * DAY_MS);
  const mar = marRatio(annualReturn(totalReturn, years), mdd);
  const pnls = trades.map((t) => t.pnlJpy);

  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: profitFactor(pnls),
    maxDrawdown: mdd,
    winRate: winRate(pnls),
    expectancy: expectancy(pnls),
    tradeCount: trades.length,
  };
}

function formatKpiLine(r: BacktestResult): string {
  const f = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "∞");
  return `Sharpe: ${f(r.sharpe)} | MAR: ${f(r.mar)} | PF: ${f(r.profitFactor)} | DD: ${(r.maxDrawdown * 100).toFixed(2)}% | Trades: ${r.tradeCount} | WinRate: ${(r.winRate * 100).toFixed(1)}%`;
}

async function main() {
  const { years } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const end = dayjs();
    const start = end.subtract(years, "year");
    console.log(`\n========================================`);
    console.log(`Combined Portfolio Backtest`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} → ${end.format("YYYY-MM-DD")} (${years}y)`);
    console.log(`========================================`);

    const startDate = start.toDate();
    const endDate = end.toDate();

    const barsByPair = new Map<PairSymbol, DailyBar[]>();
    for (const pair of PAIRS) {
      const bars = await loadBars(prisma, pair, startDate, endDate);
      if (bars.length === 0) {
        throw new Error(`No bars found for ${pair} in range`);
      }
      barsByPair.set(pair, bars);
    }

    const strategies: StrategyDef[] = [
      { strategy: donchianStrategy, params: donchianStrategy.defaultParams },
      { strategy: maCrossoverStrategy, params: maCrossoverStrategy.defaultParams },
      { strategy: rsiReversionStrategy, params: rsiReversionStrategy.defaultParams },
      { strategy: nr7BreakoutStrategy, params: nr7BreakoutStrategy.defaultParams },
    ];

    const initialCapital = 1_000_000;
    const riskRatio = 0.01;
    const result = runCombinedBacktest({ barsByPair, strategies, initialCapital, riskRatio });

    const combinedParams: Record<string, unknown> = {
      strategies: strategies.map((s) => ({ name: s.strategy.name, params: s.params })),
      limits: { totalMax: 6, perStrategyMax: 2, perPairMax: 2 },
    };

    const run = await prisma.backtestRun.create({
      data: {
        strategy: "combined",
        pairSymbol: null,
        startDate,
        endDate,
        initialCapital,
        params: combinedParams as object,
        totalReturn: safeKpi(result.totalReturn),
        sharpe: safeKpi(result.sharpe),
        mar: safeKpi(result.mar),
        profitFactor: safeKpi(result.profitFactor),
        maxDrawdown: safeKpi(result.maxDrawdown),
        winRate: safeKpi(result.winRate),
        tradeCount: result.tradeCount,
        expectancy: safeKpi(result.expectancy),
      },
    });

    const pairRows = await prisma.pair.findMany({ where: { symbol: { in: PAIRS } } });
    const pairIdBySymbol = new Map<string, string>();
    for (const pr of pairRows) pairIdBySymbol.set(pr.symbol, pr.id);

    if (result.trades.length > 0) {
      await prisma.trade.createMany({
        data: result.trades.map((t) => {
          const pid = pairIdBySymbol.get(t.pair);
          if (!pid) throw new Error(`Pair row missing for ${t.pair}`);
          return {
            backtestRunId: run.id,
            pairId: pid,
            strategy: t.strategy,
            side: t.side,
            entryDate: t.entryDate,
            entryPrice: t.entryPrice,
            exitDate: t.exitDate,
            exitPrice: t.exitPrice,
            exitReason: t.exitReason,
            sizeUnits: t.sizeUnits,
            pnlPips: t.pnlPips,
            pnlJpy: t.pnlJpy,
            holdingDays: t.holdingDays,
          };
        }),
      });
    }

    const reportPath = await writeBacktestReport({
      strategy: "combined",
      pair: "combined",
      result,
      startDate,
      endDate,
      params: combinedParams,
      initialCapital,
    });

    await prisma.backtestRun.update({
      where: { id: run.id },
      data: { reportPath },
    });

    console.log(`\n=== combined portfolio ===`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`);
    console.log(formatKpiLine(result));
    console.log(`Report: ${reportPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { Strategy } from "../types/strategy.js";
import { writeBacktestReport } from "../reports/markdown-writer.js";
import { runBacktest, type BacktestResult } from "./engine.js";

export interface RunAndPersistArgs<P> {
  prisma: PrismaClient;
  strategy: Strategy<P>;
  pair: PairSymbol;
  params: P;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  riskRatio: number;
  usdJpyRate?: number;
  reportDir?: string;
}

export interface RunAndPersistResult {
  backtestRunId: string;
  reportPath: string;
  result: BacktestResult;
}

/**
 * Clamp KPIs to DB-safe finite values.
 *
 * PostgreSQL Float8 supports Infinity, but Prisma's JSON wire serialization
 * cannot represent it. Use sentinel ±max for ±Infinity and 0 for NaN so
 * downstream aggregation/filtering stays well-defined.
 */
function safeKpi(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

/**
 * Load daily bars for a pair within the given date range, ordered by date ASC.
 * Throws if the Pair row does not exist.
 */
export async function loadBars(
  prisma: PrismaClient,
  pair: PairSymbol,
  startDate: Date,
  endDate: Date,
): Promise<DailyBar[]> {
  const pairRow = await prisma.pair.findUnique({ where: { symbol: pair } });
  if (!pairRow) {
    throw new Error(`Pair not found in DB: ${pair}`);
  }

  const rows = await prisma.dailyBar.findMany({
    where: {
      pairId: pairRow.id,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume ?? null,
  }));
}

function formatKpiLine(result: BacktestResult): string {
  const sharpe = Number.isFinite(result.sharpe) ? result.sharpe.toFixed(3) : "∞";
  const mar = Number.isFinite(result.mar) ? result.mar.toFixed(3) : "∞";
  const pf = Number.isFinite(result.profitFactor)
    ? result.profitFactor.toFixed(3)
    : "∞";
  const dd = (result.maxDrawdown * 100).toFixed(2);
  const wr = (result.winRate * 100).toFixed(1);
  return `Sharpe: ${sharpe} | MAR: ${mar} | PF: ${pf} | DD: ${dd}% | Trades: ${result.tradeCount} | WinRate: ${wr}%`;
}

/**
 * Run a backtest for one strategy/pair combination and persist results.
 *
 * Side effects (in order):
 *  1. Loads bars from DB.
 *  2. Executes `runBacktest` (pure).
 *  3. Creates a `BacktestRun` row with KPI summary.
 *  4. Bulk-inserts all `Trade` rows linked to that run.
 *  5. Writes a Markdown report to disk.
 *  6. Updates the `BacktestRun` with the report path.
 *  7. Prints a short KPI summary to stdout.
 */
export async function runAndPersist<P>(
  args: RunAndPersistArgs<P>,
): Promise<RunAndPersistResult> {
  const {
    prisma,
    strategy,
    pair,
    params,
    startDate,
    endDate,
    initialCapital,
    riskRatio,
    usdJpyRate,
    reportDir,
  } = args;

  const bars = await loadBars(prisma, pair, startDate, endDate);
  if (bars.length === 0) {
    throw new Error(
      `No bars found for ${pair} between ${dayjs(startDate).format("YYYY-MM-DD")} and ${dayjs(endDate).format("YYYY-MM-DD")}`,
    );
  }

  const result = runBacktest({
    bars,
    pair,
    strategy,
    params,
    initialCapital,
    riskRatio,
    usdJpyRate,
  });

  const run = await prisma.backtestRun.create({
    data: {
      strategy: strategy.name,
      pairSymbol: pair,
      startDate,
      endDate,
      initialCapital,
      params: params as object,
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

  const pairRow = await prisma.pair.findUnique({ where: { symbol: pair } });
  if (!pairRow) {
    throw new Error(`Pair row disappeared for ${pair}`);
  }

  if (result.trades.length > 0) {
    await prisma.trade.createMany({
      data: result.trades.map((t) => ({
        backtestRunId: run.id,
        pairId: pairRow.id,
        strategy: strategy.name,
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
      })),
    });
  }

  const reportPath = await writeBacktestReport({
    strategy: strategy.name,
    pair,
    result,
    startDate,
    endDate,
    params: params as Record<string, unknown>,
    initialCapital,
    outputDir: reportDir,
  });

  await prisma.backtestRun.update({
    where: { id: run.id },
    data: { reportPath },
  });

  const startStr = dayjs(startDate).format("YYYY-MM-DD");
  const endStr = dayjs(endDate).format("YYYY-MM-DD");
  console.log(`\n=== ${strategy.name} / ${pair} ===`);
  console.log(`Period: ${startStr} – ${endStr}`);
  console.log(formatKpiLine(result));
  console.log(`Report: ${reportPath}`);

  return {
    backtestRunId: run.id,
    reportPath,
    result,
  };
}

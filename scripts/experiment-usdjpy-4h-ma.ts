import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { maCrossoverStrategy } from "../src/core/ma-crossover/index.js";
import { runWalkForward } from "../src/walk-forward/engine.js";
import { checkRobustness, type RobustnessCriteria } from "../src/walk-forward/robustness.js";
import type { DailyBar } from "../src/types/bar.js";
import type { Strategy } from "../src/types/strategy.js";

const prisma = new PrismaClient();

const EXPERIMENT_ID = "ma-crossover-4h-usdjpy";
const PAIR_SYMBOL = "USDJPY";

const criteria: RobustnessCriteria = {
  minSharpe: 0.5,
  minMar: 0.3,
  minPf: 1.2,
  maxDd: 0.15,
  maxSharpeDrop: 0.50,
};

async function loadIntraday4hBars(): Promise<DailyBar[]> {
  const pair = await prisma.pair.findUnique({ where: { symbol: PAIR_SYMBOL } });
  if (!pair) throw new Error(`Pair ${PAIR_SYMBOL} not found. Run backfill first.`);
  const rows = await prisma.intradayBar.findMany({
    where: { pairId: pair.id, timeframe: "4h" },
    orderBy: { datetime: "asc" },
  });
  return rows.map((r) => ({
    date: r.datetime,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

function clampForDb(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

async function main() {
  const bars = await loadIntraday4hBars();
  console.log(`Loaded ${bars.length} 4h bars`);
  if (bars.length < 750) {
    console.error(`Insufficient bars: ${bars.length} < 750 needed`);
    process.exitCode = 1;
    return;
  }

  const strategy = {
    ...maCrossoverStrategy,
    name: EXPERIMENT_ID,
    exitConfig: {
      useTrailing: true,
      slAtrMultiplier: 1.0,
      beAtrMultiplier: 0.5,
      trailAtrMultiplier: 1.0,
      timeStopDays: 60,
      timeStopMaxDays: 120,
    },
  } as unknown as Strategy<Record<string, number>>;

  const paramGrid = {
    shortEma: [5, 10, 15, 20, 25],
    longEma: [50],
    atrPeriod: [14],
  };

  console.log(`\n========================================`);
  console.log(`Experiment: ${EXPERIMENT_ID}`);
  console.log(`Bars: ${bars.length} | Period: ${bars[0].date.toISOString().slice(0, 10)} -> ${bars[bars.length - 1].date.toISOString().slice(0, 10)}`);
  console.log(`IS/OOS: 500/250, Step: 125`);
  console.log(`========================================`);

  const result = runWalkForward({
    strategy,
    bars,
    pair: PAIR_SYMBOL,
    paramGrid,
    isDays: 500,
    oosDays: 250,
    stepDays: 125,
    initialCapital: 1_000_000,
    riskRatio: 0.01,
  });

  console.log(`\nWindows: ${result.windows.length}`);
  console.log(`OOS avg Sharpe: ${result.oosAvgSharpe.toFixed(3)}`);
  console.log(`OOS avg MAR: ${result.oosAvgMar.toFixed(3)}`);
  console.log(`OOS avg PF: ${result.oosAvgPf.toFixed(3)}`);
  console.log(`OOS max DD: ${(result.oosMaxDd * 100).toFixed(2)}%`);
  console.log(`IS->OOS Sharpe drop: ${(result.isOosSharpeDrop * 100).toFixed(2)}%`);

  const check = checkRobustness(result, criteria);
  const verdict = check.passed ? "PASS" : "FAIL";
  console.log(`\n========================================`);
  console.log(`Verdict: ${verdict}`);
  if (!check.passed) {
    console.log(`Failure reasons:`);
    for (const r of check.reasons) console.log(`  - ${r}`);
  }
  console.log(`========================================`);

  await prisma.walkForwardRun.create({
    data: {
      strategy: EXPERIMENT_ID,
      pairSymbol: PAIR_SYMBOL,
      startDate: bars[0].date,
      endDate: bars[bars.length - 1].date,
      isMonths: 4,
      oosMonths: 2,
      stepMonths: 1,
      oosAvgSharpe: clampForDb(result.oosAvgSharpe),
      oosAvgMar: clampForDb(result.oosAvgMar),
      oosAvgPf: clampForDb(result.oosAvgPf),
      oosMaxDd: clampForDb(result.oosMaxDd),
      isOosSharpeDrop: clampForDb(result.isOosSharpeDrop),
      passed: check.passed,
      windows: result.windows.map((w) => ({
        windowIndex: w.windowIndex,
        isStart: w.isStart.toISOString(),
        isEnd: w.isEnd.toISOString(),
        oosStart: w.oosStart.toISOString(),
        oosEnd: w.oosEnd.toISOString(),
        bestParams: w.bestParams,
        isSharpe: clampForDb(w.isSharpe),
        oosSharpe: clampForDb(w.oosSharpe),
        oosMar: clampForDb(w.oosMar),
        oosPf: clampForDb(w.oosPf),
        oosMaxDd: clampForDb(w.oosMaxDd),
        oosTrades: w.oosTrades,
        oosTotalReturn: clampForDb(w.oosTotalReturn),
      })),
    },
  });

  const reportDir = "reports/experiments";
  await fs.mkdir(reportDir, { recursive: true });
  const ts = dayjs().format("YYYYMMDD-HHmmss");
  const reportPath = path.join(reportDir, `${EXPERIMENT_ID}-${ts}.md`);
  const lines: string[] = [
    `# Minimum Experiment: ${EXPERIMENT_ID}`,
    ``,
    `**Date:** ${dayjs().format("YYYY-MM-DD HH:mm")}`,
    `**Pair:** ${PAIR_SYMBOL}`,
    `**Timeframe:** 4h`,
    `**Strategy:** MA Crossover (shortEma only optimized)`,
    `**Bars:** ${bars.length}`,
    `**Period:** ${dayjs(bars[0].date).format("YYYY-MM-DD")} - ${dayjs(bars[bars.length - 1].date).format("YYYY-MM-DD")}`,
    `**Windows:** ${result.windows.length}`,
    ``,
    `## Verdict: ${verdict}`,
    ``,
  ];
  if (!check.passed) {
    lines.push(`**Failure reasons:**`);
    for (const r of check.reasons) lines.push(`- ${r}`);
    lines.push(``);
  }
  lines.push(`## Aggregate OOS KPIs`, ``);
  lines.push(`| Metric | Value | Target |`);
  lines.push(`|---|---|---|`);
  lines.push(`| OOS Avg Sharpe | ${result.oosAvgSharpe.toFixed(3)} | >= 0.5 |`);
  lines.push(`| OOS Avg MAR | ${result.oosAvgMar.toFixed(3)} | >= 0.3 |`);
  lines.push(`| OOS Avg PF | ${result.oosAvgPf.toFixed(3)} | >= 1.2 |`);
  lines.push(`| OOS Max DD | ${(result.oosMaxDd * 100).toFixed(2)}% | <= 15% |`);
  lines.push(`| IS->OOS Sharpe Drop | ${(result.isOosSharpeDrop * 100).toFixed(2)}% | <= 50% |`);
  lines.push(``, `## Best shortEma Per Window`, ``);
  lines.push(`| Window | IS Period | OOS Period | shortEma | IS Sharpe | OOS Sharpe | OOS Trades |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const w of result.windows) {
    lines.push(
      `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${(w.bestParams as { shortEma: number }).shortEma} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosTrades} |`,
    );
  }
  await fs.writeFile(reportPath, lines.join("\n"), "utf-8");
  console.log(`\nReport: ${reportPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

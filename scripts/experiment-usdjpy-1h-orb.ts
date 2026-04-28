import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { orbStrategy } from "../src/core/orb/index.js";
import { runWalkForward } from "../src/walk-forward/engine.js";
import { checkRobustness, type RobustnessCriteria } from "../src/walk-forward/robustness.js";
import type { DailyBar } from "../src/types/bar.js";
import type { Strategy } from "../src/types/strategy.js";

const prisma = new PrismaClient();

const EXPERIMENT_ID = "orb-1h-usdjpy";
const PAIR_SYMBOL = "USDJPY";

const criteria: RobustnessCriteria = {
  minSharpe: 0.5,
  minMar: 0.3,
  minPf: 1.2,
  maxDd: 0.15,
  maxSharpeDrop: 0.5,
};

async function loadIntraday1hBars(): Promise<DailyBar[]> {
  const pair = await prisma.pair.findUnique({ where: { symbol: PAIR_SYMBOL } });
  if (!pair) throw new Error(`Pair ${PAIR_SYMBOL} not found. Run backfill first.`);
  const rows = await prisma.intradayBar.findMany({
    where: { pairId: pair.id, timeframe: "1h" },
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
  const bars = await loadIntraday1hBars();
  console.log(`Loaded ${bars.length} 1h bars`);
  if (bars.length < 4000) {
    console.error(`Insufficient bars: ${bars.length} < 4000 needed (IS 3000 + OOS 1000)`);
    process.exitCode = 1;
    return;
  }

  const strategy = {
    ...orbStrategy,
    name: EXPERIMENT_ID,
  } as unknown as Strategy<Record<string, number>>;

  // Only optimize rangeHours; everything else fixed
  const paramGrid = {
    rangeHours: [2, 3, 4],
    atrPeriod: [14],
    sessionStartUtcHour: [7],
    sessionEndUtcHour: [15],
  };

  console.log(`\n========================================`);
  console.log(`Experiment: ${EXPERIMENT_ID}`);
  console.log(
    `Bars: ${bars.length} | Period: ${bars[0].date.toISOString().slice(0, 10)} -> ${bars[bars.length - 1].date.toISOString().slice(0, 10)}`,
  );
  console.log(`IS/OOS: 3000/1000 bars, Step: 500`);
  console.log(`========================================`);

  const result = runWalkForward({
    strategy,
    bars,
    pair: PAIR_SYMBOL,
    paramGrid,
    isDays: 3000,
    oosDays: 1000,
    stepDays: 500,
    initialCapital: 1_000_000,
    riskRatio: 0.01,
  });

  // Aggregate extra metrics for design's PASS criteria
  const oosSharpes = result.windows.map((w) => w.oosSharpe);
  const winningWindows = oosSharpes.filter((s) => s > 0).length;
  const winRate = oosSharpes.length > 0 ? winningWindows / oosSharpes.length : 0;
  const mean = oosSharpes.reduce((s, v) => s + v, 0) / Math.max(oosSharpes.length, 1);
  const variance =
    oosSharpes.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(oosSharpes.length, 1);
  const stdev = Math.sqrt(variance);

  console.log(`\nWindows: ${result.windows.length}`);
  console.log(`OOS avg Sharpe: ${result.oosAvgSharpe.toFixed(3)}`);
  console.log(`OOS Sharpe stdev: ${stdev.toFixed(3)}`);
  console.log(
    `OOS winning windows: ${winningWindows}/${oosSharpes.length} (${(winRate * 100).toFixed(1)}%)`,
  );
  console.log(`OOS avg MAR: ${result.oosAvgMar.toFixed(3)}`);
  console.log(`OOS avg PF: ${result.oosAvgPf.toFixed(3)}`);
  console.log(`OOS max DD: ${(result.oosMaxDd * 100).toFixed(2)}%`);
  console.log(`IS->OOS Sharpe drop: ${(result.isOosSharpeDrop * 100).toFixed(2)}%`);

  const check = checkRobustness(result, criteria);

  // Apply 4-bucket verdict from design
  const sharpePass = result.oosAvgSharpe >= 0.5;
  const dropPass = result.isOosSharpeDrop <= 0.5;
  let verdict: "PASS" | "PARTIAL_DROP" | "PARTIAL_SHARPE" | "FAIL";
  if (sharpePass && dropPass) verdict = "PASS";
  else if (sharpePass && !dropPass) verdict = "PARTIAL_DROP";
  else if (!sharpePass && dropPass) verdict = "PARTIAL_SHARPE";
  else verdict = "FAIL";

  console.log(`\n========================================`);
  console.log(`Verdict: ${verdict}`);
  if (!check.passed) {
    console.log(`Robustness check failures:`);
    for (const r of check.reasons) console.log(`  - ${r}`);
  }
  console.log(`========================================`);

  await prisma.walkForwardRun.create({
    data: {
      strategy: EXPERIMENT_ID,
      pairSymbol: PAIR_SYMBOL,
      startDate: bars[0].date,
      endDate: bars[bars.length - 1].date,
      isMonths: 6,
      oosMonths: 2,
      stepMonths: 1,
      oosAvgSharpe: clampForDb(result.oosAvgSharpe),
      oosAvgMar: clampForDb(result.oosAvgMar),
      oosAvgPf: clampForDb(result.oosAvgPf),
      oosMaxDd: clampForDb(result.oosMaxDd),
      isOosSharpeDrop: clampForDb(result.isOosSharpeDrop),
      passed: verdict === "PASS",
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
    `**Timeframe:** 1h`,
    `**Strategy:** London ORB (rangeHours optimized)`,
    `**Bars:** ${bars.length}`,
    `**Period:** ${dayjs(bars[0].date).format("YYYY-MM-DD")} - ${dayjs(bars[bars.length - 1].date).format("YYYY-MM-DD")}`,
    `**Windows:** ${result.windows.length}`,
    ``,
    `## Verdict: ${verdict}`,
    ``,
    `## Aggregate OOS KPIs`,
    ``,
    `| Metric | Value | Target | Pass |`,
    `|---|---:|---:|:---:|`,
    `| OOS Avg Sharpe | ${result.oosAvgSharpe.toFixed(3)} | >= 0.5 | ${sharpePass ? "PASS" : "FAIL"} |`,
    `| IS->OOS Sharpe Drop | ${(result.isOosSharpeDrop * 100).toFixed(2)}% | <= 50% | ${dropPass ? "PASS" : "FAIL"} |`,
    `| OOS Sharpe Stdev | ${stdev.toFixed(3)} | <= 1.0 | ${stdev <= 1.0 ? "PASS" : "FAIL"} |`,
    `| OOS Winning Windows | ${winningWindows}/${oosSharpes.length} (${(winRate * 100).toFixed(1)}%) | >= 60% | ${winRate >= 0.6 ? "PASS" : "FAIL"} |`,
    `| OOS Avg MAR | ${result.oosAvgMar.toFixed(3)} | >= 0.3 | ${result.oosAvgMar >= 0.3 ? "PASS" : "FAIL"} |`,
    `| OOS Avg PF | ${result.oosAvgPf.toFixed(3)} | >= 1.2 | ${result.oosAvgPf >= 1.2 ? "PASS" : "FAIL"} |`,
    `| OOS Max DD | ${(result.oosMaxDd * 100).toFixed(2)}% | <= 15% | ${result.oosMaxDd <= 0.15 ? "PASS" : "FAIL"} |`,
    ``,
    `## Best rangeHours Per Window`,
    ``,
    `| Window | IS Period | OOS Period | rangeHours | IS Sharpe | OOS Sharpe | OOS Trades |`,
    `|---|---|---|---|---|---|---|`,
  ];
  for (const w of result.windows) {
    lines.push(
      `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${(w.bestParams as { rangeHours: number }).rangeHours} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosTrades} |`,
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

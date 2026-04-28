import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { orbStrategy } from "../src/core/orb/index.js";
import { runWalkForward } from "../src/walk-forward/engine.js";
import {
  checkRobustness,
  checkSortinoRobustness,
  sortinoDefaultRobustness,
  type RobustnessCriteria,
  type SortinoRobustnessCriteria,
} from "../src/walk-forward/robustness.js";
import type { DailyBar } from "../src/types/bar.js";
import type { Strategy } from "../src/types/strategy.js";

const prisma = new PrismaClient();

const EXPERIMENT_ID = "orb-1h-eurjpy";
const PAIR_SYMBOL = "EURJPY";

// Old (Sharpe-based) criteria — kept for reference / transparency in the report
const oldCriteria: RobustnessCriteria = {
  minSharpe: 0.5,
  minMar: 0.3,
  minPf: 1.2,
  maxDd: 0.15,
  maxSharpeDrop: 0.5,
};

// New (Sortino-based) criteria — primary verdict source
const newCriteria: SortinoRobustnessCriteria = sortinoDefaultRobustness;

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

  // Per-window winning-window statistics for both Sharpe and Sortino
  const oosSharpes = result.windows.map((w) => w.oosSharpe);
  const oosSortinos = result.windows.map((w) => w.oosSortino);
  const winningSharpeWindows = oosSharpes.filter((s) => s > 0).length;
  const winningSortinoWindows = oosSortinos.filter((s) => s > 0).length;
  const sharpeWinRate =
    oosSharpes.length > 0 ? winningSharpeWindows / oosSharpes.length : 0;
  const sortinoWinRate =
    oosSortinos.length > 0 ? winningSortinoWindows / oosSortinos.length : 0;

  // Sharpe stdev (kept for backward-compat reporting)
  const sharpeMean =
    oosSharpes.reduce((s, v) => s + v, 0) / Math.max(oosSharpes.length, 1);
  const sharpeVariance =
    oosSharpes.reduce((s, v) => s + (v - sharpeMean) ** 2, 0) /
    Math.max(oosSharpes.length, 1);
  const sharpeStdev = Math.sqrt(sharpeVariance);

  console.log(`\nWindows: ${result.windows.length}`);
  console.log(`--- Sharpe (reference) ---`);
  console.log(`OOS avg Sharpe: ${result.oosAvgSharpe.toFixed(3)}`);
  console.log(`OOS Sharpe stdev: ${sharpeStdev.toFixed(3)}`);
  console.log(
    `OOS Sharpe winning windows: ${winningSharpeWindows}/${oosSharpes.length} (${(sharpeWinRate * 100).toFixed(1)}%)`,
  );
  console.log(`IS->OOS Sharpe drop: ${(result.isOosSharpeDrop * 100).toFixed(2)}%`);
  console.log(`--- Sortino (PRIMARY KPI) ---`);
  console.log(`OOS avg Sortino: ${result.oosAvgSortino.toFixed(3)}`);
  console.log(`OOS Sortino stdev: ${result.oosSortinoStdev.toFixed(3)}`);
  console.log(
    `OOS Sortino winning windows: ${winningSortinoWindows}/${oosSortinos.length} (${(sortinoWinRate * 100).toFixed(1)}%)`,
  );
  console.log(`IS->OOS Sortino drop: ${(result.isOosSortinoDrop * 100).toFixed(2)}%`);
  console.log(`--- Other ---`);
  console.log(`OOS avg MAR: ${result.oosAvgMar.toFixed(3)}`);
  console.log(`OOS avg PF: ${result.oosAvgPf.toFixed(3)}`);
  console.log(`OOS max DD: ${(result.oosMaxDd * 100).toFixed(2)}%`);

  console.log(`\n--- Per-window OOS Sortino ---`);
  for (const w of result.windows) {
    console.log(
      `  W${w.windowIndex}: rangeHours=${(w.bestParams as { rangeHours: number }).rangeHours} | IS Sortino=${w.isSortino.toFixed(2)} | OOS Sortino=${w.oosSortino.toFixed(2)} | OOS Sharpe=${w.oosSharpe.toFixed(2)} | Trades=${w.oosTrades}`,
    );
  }

  // Verdict — new (Sortino-based) primary, old (Sharpe-based) for reference
  const sortinoCheck = checkSortinoRobustness(result, newCriteria);
  const oldSharpeCheck = checkRobustness(result, oldCriteria);
  // Old 4-bucket verdict (kept for transparency)
  const oldSharpePass = result.oosAvgSharpe >= oldCriteria.minSharpe;
  const oldDropPass = result.isOosSharpeDrop <= oldCriteria.maxSharpeDrop;
  let oldVerdict: "PASS" | "PARTIAL_DROP" | "PARTIAL_SHARPE" | "FAIL";
  if (oldSharpePass && oldDropPass) oldVerdict = "PASS";
  else if (oldSharpePass && !oldDropPass) oldVerdict = "PARTIAL_DROP";
  else if (!oldSharpePass && oldDropPass) oldVerdict = "PARTIAL_SHARPE";
  else oldVerdict = "FAIL";

  const verdict: "PASS" | "FAIL" = sortinoCheck.passed ? "PASS" : "FAIL";

  console.log(`\n========================================`);
  console.log(`Verdict (NEW Sortino-based): ${verdict}`);
  if (!sortinoCheck.passed) {
    console.log(`Sortino-based robustness failures:`);
    for (const r of sortinoCheck.reasons) console.log(`  - ${r}`);
  }
  console.log(`Verdict (OLD Sharpe-based, reference): ${oldVerdict}`);
  if (!oldSharpeCheck.passed) {
    console.log(`Old-criteria failures (reference):`);
    for (const r of oldSharpeCheck.reasons) console.log(`  - ${r}`);
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
        isSortino: clampForDb(w.isSortino),
        oosSortino: clampForDb(w.oosSortino),
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
    `## Verdict (NEW Sortino-based, primary): ${verdict}`,
    ``,
    `## Verdict (OLD Sharpe-based, reference): ${oldVerdict}`,
    ``,
    `## Aggregate OOS KPIs — Sortino-based criteria (NEW PRIMARY)`,
    ``,
    `| Metric | Value | Target | Pass |`,
    `|---|---:|---:|:---:|`,
    `| OOS Avg Sortino | ${result.oosAvgSortino.toFixed(3)} | >= ${newCriteria.minSortino} | ${result.oosAvgSortino >= newCriteria.minSortino ? "PASS" : "FAIL"} |`,
    `| IS->OOS Sortino Drop | ${(result.isOosSortinoDrop * 100).toFixed(2)}% | <= ${(newCriteria.maxSortinoDrop * 100).toFixed(0)}% | ${result.isOosSortinoDrop <= newCriteria.maxSortinoDrop ? "PASS" : "FAIL"} |`,
    `| OOS Sortino Stdev | ${result.oosSortinoStdev.toFixed(3)} | <= ${newCriteria.maxSortinoStdev} | ${result.oosSortinoStdev <= newCriteria.maxSortinoStdev ? "PASS" : "FAIL"} |`,
    `| OOS Sortino Winning Windows | ${winningSortinoWindows}/${oosSortinos.length} (${(sortinoWinRate * 100).toFixed(1)}%) | >= ${(newCriteria.minWinningWindowRate * 100).toFixed(0)}% | ${sortinoWinRate >= newCriteria.minWinningWindowRate ? "PASS" : "FAIL"} |`,
    `| OOS Avg MAR | ${result.oosAvgMar.toFixed(3)} | >= ${newCriteria.minMar} | ${result.oosAvgMar >= newCriteria.minMar ? "PASS" : "FAIL"} |`,
    `| OOS Avg PF | ${result.oosAvgPf.toFixed(3)} | >= ${newCriteria.minPf} | ${result.oosAvgPf >= newCriteria.minPf ? "PASS" : "FAIL"} |`,
    `| OOS Max DD | ${(result.oosMaxDd * 100).toFixed(2)}% | <= ${(newCriteria.maxDd * 100).toFixed(0)}% | ${result.oosMaxDd <= newCriteria.maxDd ? "PASS" : "FAIL"} |`,
    ``,
    `## Aggregate OOS KPIs — Sharpe-based criteria (OLD, reference only)`,
    ``,
    `| Metric | Value | Target | Pass |`,
    `|---|---:|---:|:---:|`,
    `| OOS Avg Sharpe | ${result.oosAvgSharpe.toFixed(3)} | >= ${oldCriteria.minSharpe} | ${oldSharpePass ? "PASS" : "FAIL"} |`,
    `| IS->OOS Sharpe Drop | ${(result.isOosSharpeDrop * 100).toFixed(2)}% | <= ${(oldCriteria.maxSharpeDrop * 100).toFixed(0)}% | ${oldDropPass ? "PASS" : "FAIL"} |`,
    `| OOS Sharpe Stdev | ${sharpeStdev.toFixed(3)} | <= 1.0 | ${sharpeStdev <= 1.0 ? "PASS" : "FAIL"} |`,
    `| OOS Sharpe Winning Windows | ${winningSharpeWindows}/${oosSharpes.length} (${(sharpeWinRate * 100).toFixed(1)}%) | >= 60% | ${sharpeWinRate >= 0.6 ? "PASS" : "FAIL"} |`,
    ``,
    `## Per-Window Results`,
    ``,
    `| Window | IS Period | OOS Period | rangeHours | IS Sharpe | OOS Sharpe | IS Sortino | OOS Sortino | OOS Trades |`,
    `|---|---|---|---|---:|---:|---:|---:|---:|`,
  ];
  for (const w of result.windows) {
    lines.push(
      `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${(w.bestParams as { rangeHours: number }).rangeHours} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.isSortino.toFixed(2)} | ${w.oosSortino.toFixed(2)} | ${w.oosTrades} |`,
    );
  }

  if (!sortinoCheck.passed) {
    lines.push(``, `## Sortino-based robustness failures`, ``);
    for (const r of sortinoCheck.reasons) lines.push(`- ${r}`);
  }
  if (!oldSharpeCheck.passed) {
    lines.push(``, `## Sharpe-based robustness failures (reference)`, ``);
    for (const r of oldSharpeCheck.reasons) lines.push(`- ${r}`);
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

import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { PAIRS } from "../src/data/pair-config.js";
import { runWalkForward, type WfAggregate } from "../src/walk-forward/engine.js";
import {
  checkRobustness,
  checkCrossPairRobustness,
  defaultRobustness,
} from "../src/walk-forward/robustness.js";
import { loadBars } from "../src/backtest/runner-helpers.js";
import type { Strategy } from "../src/types/strategy.js";
import type { PairSymbol } from "../src/types/pair.js";

export interface RunWfArgs {
  strategy: Strategy<Record<string, number>>;
  paramGrid: Record<string, number[]>;
  years?: number;
  isDays?: number;
  oosDays?: number;
  stepDays?: number;
  initialCapital?: number;
  riskRatio?: number;
  reportDir?: string;
}

export async function runWfForAllPairs(args: RunWfArgs): Promise<void> {
  type P = Record<string, number>;
  const prisma = new PrismaClient();
  try {
    const years = args.years ?? 10;
    const isDays = args.isDays ?? 252;
    const oosDays = args.oosDays ?? 126;
    const stepDays = args.stepDays ?? 126;
    const initialCapital = args.initialCapital ?? 1_000_000;
    const riskRatio = args.riskRatio ?? 0.01;
    const reportDir = args.reportDir ?? "reports/walk-forward";

    const end = dayjs();
    const start = end.subtract(years, "year");
    const startDate = start.toDate();
    const endDate = end.toDate();

    console.log(`\n========================================`);
    console.log(`Walk-Forward: ${args.strategy.name}`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(`IS/OOS: ${isDays}/${oosDays} days, step: ${stepDays}`);
    console.log(`========================================`);

    const perPair = {} as Record<PairSymbol, WfAggregate<P>>;
    const paramGridForDb: Record<string, number[]> = {};
    for (const k of Object.keys(args.paramGrid)) {
      paramGridForDb[k] = (args.paramGrid as Record<string, number[]>)[k];
    }

    for (const pair of PAIRS) {
      console.log(`\n--- ${pair} ---`);
      const bars = await loadBars(prisma, pair, startDate, endDate);
      console.log(`  loaded ${bars.length} bars`);
      if (bars.length < isDays + oosDays) {
        console.log(`  SKIP: not enough bars for WF (need ${isDays + oosDays})`);
        continue;
      }
      const agg = runWalkForward({
        strategy: args.strategy,
        bars,
        pair,
        paramGrid: args.paramGrid,
        isDays,
        oosDays,
        stepDays,
        initialCapital,
        riskRatio,
      });
      perPair[pair] = agg;
      console.log(
        `  Windows: ${agg.windows.length} | OOS Sharpe avg: ${agg.oosAvgSharpe.toFixed(3)} | MAR avg: ${agg.oosAvgMar.toFixed(3)} | PF avg: ${agg.oosAvgPf.toFixed(3)} | Max DD: ${(agg.oosMaxDd * 100).toFixed(2)}%`,
      );

      // Persist WalkForwardRun
      const check = checkRobustness(agg);
      await prisma.walkForwardRun.create({
        data: {
          strategy: args.strategy.name,
          pairSymbol: pair,
          startDate,
          endDate,
          isMonths: Math.round(isDays / 21), // ~21 trading days per month
          oosMonths: Math.round(oosDays / 21),
          stepMonths: stepDays / 21,
          oosAvgSharpe: clampForDb(agg.oosAvgSharpe),
          oosAvgMar: clampForDb(agg.oosAvgMar),
          oosAvgPf: clampForDb(agg.oosAvgPf),
          oosMaxDd: clampForDb(agg.oosMaxDd),
          isOosSharpeDrop: clampForDb(agg.isOosSharpeDrop),
          passed: check.passed,
          windows: agg.windows.map((w) => ({
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

      // Write per-pair markdown report
      await writeWfReport({
        reportDir,
        strategy: args.strategy.name,
        pair,
        agg,
        paramGrid: paramGridForDb,
        startDate,
        endDate,
        robustness: check,
      });
    }

    // Cross-pair verdict
    if (Object.keys(perPair).length > 0) {
      const cross = checkCrossPairRobustness(perPair, defaultRobustness);
      console.log(`\n========================================`);
      console.log(
        `Cross-pair robustness: ${cross.passed ? "PASS" : "FAIL"}`,
      );
      console.log(
        `Passing pairs (${cross.passingPairs.length}/3): ${cross.passingPairs.join(", ") || "(none)"}`,
      );
      console.log(`========================================\n`);
      for (const [pair, check] of Object.entries(cross.details)) {
        if (!check.passed) {
          console.log(`  ${pair} failed: ${check.reasons.join("; ")}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

function clampForDb(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

async function writeWfReport(args: {
  reportDir: string;
  strategy: string;
  pair: PairSymbol;
  agg: WfAggregate<Record<string, number>>;
  paramGrid: Record<string, number[]>;
  startDate: Date;
  endDate: Date;
  robustness: { passed: boolean; reasons: string[] };
}): Promise<void> {
  await fs.mkdir(args.reportDir, { recursive: true });
  const ts = dayjs().format("YYYYMMDD-HHmmss");
  const filename = `${args.strategy}-${args.pair}-${ts}.md`;
  const filepath = path.join(args.reportDir, filename);
  const { agg } = args;
  const lines: string[] = [
    `# Walk-Forward Report: ${args.strategy} / ${args.pair}`,
    ``,
    `**Period:** ${dayjs(args.startDate).format("YYYY-MM-DD")} - ${dayjs(args.endDate).format("YYYY-MM-DD")}`,
    `**Windows:** ${agg.windows.length}`,
    `**Robustness:** ${args.robustness.passed ? "PASS" : "FAIL"}`,
  ];
  if (!args.robustness.passed) {
    lines.push(`**Failure reasons:**`);
    for (const r of args.robustness.reasons) lines.push(`- ${r}`);
  }
  lines.push(``, `## Aggregate OOS KPIs`, ``);
  lines.push(
    `| Metric | Value |`,
    `|---|---|`,
    `| OOS Avg Sharpe | ${agg.oosAvgSharpe.toFixed(3)} |`,
    `| OOS Avg MAR | ${agg.oosAvgMar.toFixed(3)} |`,
    `| OOS Avg PF | ${agg.oosAvgPf.toFixed(3)} |`,
    `| OOS Max DD | ${(agg.oosMaxDd * 100).toFixed(2)}% |`,
    `| OOS Avg Total Return | ${(agg.oosAvgTotalReturn * 100).toFixed(2)}% |`,
    `| IS->OOS Sharpe Drop | ${(agg.isOosSharpeDrop * 100).toFixed(2)}% |`,
  );
  lines.push(
    ``,
    `## Parameter Grid`,
    ``,
    "```json",
    JSON.stringify(args.paramGrid, null, 2),
    "```",
  );
  lines.push(``, `## Windows`, ``);
  lines.push(
    `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const w of agg.windows) {
    const paramsStr = Object.entries(w.bestParams)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${paramsStr} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosMar.toFixed(2)} | ${w.oosPf.toFixed(2)} | ${(w.oosMaxDd * 100).toFixed(1)}% | ${w.oosTrades} |`,
    );
  }
  await fs.writeFile(filepath, lines.join("\n"), "utf-8");
  console.log(`  Report: ${filepath}`);
}

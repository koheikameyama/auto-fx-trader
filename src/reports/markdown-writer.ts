import fs from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import type { BacktestResult, EquityPoint } from "../backtest/engine.js";
import type { PairSymbol } from "../types/pair.js";
import type { BacktestTrade } from "../types/trade.js";

export interface WriteReportArgs {
  strategy: string;
  pair: PairSymbol | "combined";
  result: BacktestResult;
  startDate: Date;
  endDate: Date;
  params: Record<string, unknown>;
  initialCapital: number;
  outputDir?: string;
}

export async function writeBacktestReport(
  args: WriteReportArgs,
): Promise<string> {
  const outDir = args.outputDir ?? "reports/backtests";
  await fs.mkdir(outDir, { recursive: true });
  const ts = dayjs().format("YYYYMMDD-HHmmss");
  const filename = `${args.strategy}-${args.pair}-${ts}.md`;
  const fullPath = path.join(outDir, filename);
  const md = buildMarkdown(args);
  await fs.writeFile(fullPath, md, "utf-8");
  return fullPath;
}

function formatJpy(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}¥${Math.round(abs).toLocaleString("en-US")}`;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return `${(n * 100).toFixed(2)}%`;
}

function formatNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(digits);
}

function buildMarkdown(args: WriteReportArgs): string {
  const { result } = args;
  const startStr = dayjs(args.startDate).format("YYYY-MM-DD");
  const endStr = dayjs(args.endDate).format("YYYY-MM-DD");

  const tradesSection = buildTradesSection(result.trades);
  const exitReasonSection = buildExitReasonSection(result.trades);
  const equitySection = buildEquitySection(result.equityCurve);

  return [
    `# Backtest Report: ${args.strategy} / ${args.pair}`,
    ``,
    `**Period:** ${startStr} – ${endStr}`,
    `**Initial Capital:** ${formatJpy(args.initialCapital)}`,
    ``,
    `## KPIs`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Sharpe | ${formatNum(result.sharpe)} |`,
    `| MAR | ${formatNum(result.mar)} |`,
    `| Profit Factor | ${formatNum(result.profitFactor)} |`,
    `| Max Drawdown | ${formatPct(result.maxDrawdown)} |`,
    `| Total Return | ${formatPct(result.totalReturn)} |`,
    `| Win Rate | ${formatPct(result.winRate)} |`,
    `| Trades | ${result.tradeCount} |`,
    `| Expectancy | ${formatJpy(result.expectancy)} |`,
    ``,
    `## Parameters`,
    ``,
    "```json",
    JSON.stringify(args.params, null, 2),
    "```",
    ``,
    tradesSection,
    ``,
    exitReasonSection,
    ``,
    equitySection,
    ``,
  ].join("\n");
}

function buildTradesSection(trades: BacktestTrade[]): string {
  const lines: string[] = [`## Trades Summary`, ``];
  if (trades.length === 0) {
    lines.push(`No trades.`);
    return lines.join("\n");
  }
  const winners = trades.filter((t) => t.pnlJpy > 0);
  const losers = trades.filter((t) => t.pnlJpy <= 0);
  const largestWin = trades.reduce((m, t) => Math.max(m, t.pnlJpy), 0);
  const largestLoss = trades.reduce((m, t) => Math.min(m, t.pnlJpy), 0);
  const avgHold =
    trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length;
  lines.push(
    `- **Total Trades:** ${trades.length}`,
    `- **Winners:** ${winners.length}`,
    `- **Losers:** ${losers.length}`,
    `- **Largest Win:** ${formatJpy(largestWin)}`,
    `- **Largest Loss:** ${formatJpy(largestLoss)}`,
    `- **Avg Holding Days:** ${avgHold.toFixed(2)}`,
  );
  return lines.join("\n");
}

function buildExitReasonSection(trades: BacktestTrade[]): string {
  const lines: string[] = [`## Exit Reason Breakdown`, ``];
  if (trades.length === 0) {
    lines.push(`No trades.`);
    return lines.join("\n");
  }
  const counts: Record<string, number> = {};
  for (const t of trades) {
    counts[t.exitReason] = (counts[t.exitReason] ?? 0) + 1;
  }
  const allReasons = ["sl", "trailing", "time", "signal", "end_of_data"];
  lines.push(`| Reason | Count |`, `|---|---|`);
  for (const r of allReasons) {
    lines.push(`| ${r} | ${counts[r] ?? 0} |`);
  }
  return lines.join("\n");
}

function buildEquitySection(curve: EquityPoint[]): string {
  const lines: string[] = [`## Equity Curve (sampled)`, ``];
  if (curve.length === 0) {
    lines.push(`No data.`);
    return lines.join("\n");
  }
  const first = curve[0];
  const last = curve[curve.length - 1];
  let maxPoint = first;
  let minPoint = first;
  for (const p of curve) {
    if (p.equity > maxPoint.equity) maxPoint = p;
    if (p.equity < minPoint.equity) minPoint = p;
  }
  lines.push(
    `- Start: ${dayjs(first.date).format("YYYY-MM-DD")} ${formatJpy(first.equity)}`,
    `- Max: ${dayjs(maxPoint.date).format("YYYY-MM-DD")} ${formatJpy(maxPoint.equity)}`,
    `- Min: ${dayjs(minPoint.date).format("YYYY-MM-DD")} ${formatJpy(minPoint.equity)}`,
    `- End: ${dayjs(last.date).format("YYYY-MM-DD")} ${formatJpy(last.equity)}`,
  );
  return lines.join("\n");
}

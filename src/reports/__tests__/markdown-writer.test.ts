import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeBacktestReport } from "../markdown-writer.js";
import type { BacktestResult } from "../../backtest/engine.js";
import type { BacktestTrade } from "../../types/trade.js";

const tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `auto-fx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

function emptyResult(): BacktestResult {
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

function sampleTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    pair: "USDJPY",
    strategy: "donchian",
    side: "long",
    entryDate: new Date("2024-02-01"),
    entryPrice: 150.0,
    exitDate: new Date("2024-02-05"),
    exitPrice: 151.0,
    exitReason: "trailing",
    sizeUnits: 10000,
    pnlPips: 100,
    pnlJpy: 10000,
    holdingDays: 4,
    ...overrides,
  };
}

function sampleResult(): BacktestResult {
  const trades: BacktestTrade[] = [
    sampleTrade({
      entryDate: new Date("2024-02-01"),
      exitDate: new Date("2024-02-05"),
      exitReason: "trailing",
      pnlJpy: 15000,
      holdingDays: 4,
    }),
    sampleTrade({
      entryDate: new Date("2024-03-01"),
      exitDate: new Date("2024-03-02"),
      exitReason: "sl",
      pnlJpy: -5000,
      holdingDays: 1,
    }),
    sampleTrade({
      entryDate: new Date("2024-04-01"),
      exitDate: new Date("2024-04-10"),
      exitReason: "time",
      pnlJpy: 8000,
      holdingDays: 9,
    }),
    sampleTrade({
      entryDate: new Date("2024-05-01"),
      exitDate: new Date("2024-05-03"),
      exitReason: "signal",
      pnlJpy: -2000,
      holdingDays: 2,
    }),
  ];
  return {
    trades,
    equityCurve: [
      { date: new Date("2024-01-01"), equity: 1_000_000 },
      { date: new Date("2024-02-01"), equity: 1_010_000 },
      { date: new Date("2024-03-01"), equity: 1_025_000 },
      { date: new Date("2024-04-01"), equity: 950_000 },
      { date: new Date("2024-05-01"), equity: 1_100_000 },
      { date: new Date("2024-06-01"), equity: 1_050_000 },
    ],
    totalReturn: 0.05,
    sharpe: 1.234,
    mar: 0.567,
    profitFactor: 1.45,
    maxDrawdown: 0.1234,
    winRate: 0.5,
    expectancy: 4000,
    tradeCount: trades.length,
  };
}

describe("writeBacktestReport", () => {
  it("writes a minimal report for empty result with correct markers", async () => {
    const dir = await mkTmp();
    const file = await writeBacktestReport({
      strategy: "donchian",
      pair: "USDJPY",
      result: emptyResult(),
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
      params: {},
      initialCapital: 1_000_000,
      outputDir: dir,
    });
    const content = await fs.readFile(file, "utf-8");
    expect(content).toContain("# Backtest Report: donchian / USDJPY");
    expect(content).toContain("**Period:** 2024-01-01 – 2024-12-31");
    expect(content).toContain("¥1,000,000");
    expect(content).toContain("No trades.");
    expect(content).toContain("No data.");
  });

  it("writes a full report with KPIs, trades, exit reasons, and equity curve", async () => {
    const dir = await mkTmp();
    const result = sampleResult();
    const file = await writeBacktestReport({
      strategy: "ma-crossover",
      pair: "EURUSD",
      result,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-30"),
      params: { fastPeriod: 10, slowPeriod: 30 },
      initialCapital: 1_000_000,
      outputDir: dir,
    });
    const content = await fs.readFile(file, "utf-8");

    // Header
    expect(content).toContain("# Backtest Report: ma-crossover / EURUSD");

    // KPIs
    expect(content).toContain("| Sharpe | 1.234 |");
    expect(content).toContain("| MAR | 0.567 |");
    expect(content).toContain("| Profit Factor | 1.450 |");
    expect(content).toContain("| Max Drawdown | 12.34% |");
    expect(content).toContain("| Total Return | 5.00% |");
    expect(content).toContain("| Win Rate | 50.00% |");
    expect(content).toContain("| Trades | 4 |");
    expect(content).toContain("| Expectancy | ¥4,000 |");

    // Params
    expect(content).toContain("## Parameters");
    expect(content).toContain('"fastPeriod": 10');
    expect(content).toContain('"slowPeriod": 30');

    // Trades
    expect(content).toContain("## Trades Summary");
    expect(content).toContain("- **Total Trades:** 4");
    expect(content).toContain("- **Winners:** 2");
    expect(content).toContain("- **Losers:** 2");
    expect(content).toContain("- **Largest Win:** ¥15,000");
    expect(content).toContain("- **Largest Loss:** -¥5,000");
    expect(content).toContain("- **Avg Holding Days:** 4.00");

    // Exit reasons
    expect(content).toContain("## Exit Reason Breakdown");
    expect(content).toContain("| sl | 1 |");
    expect(content).toContain("| trailing | 1 |");
    expect(content).toContain("| time | 1 |");
    expect(content).toContain("| signal | 1 |");
    expect(content).toContain("| end_of_data | 0 |");

    // Equity
    expect(content).toContain("## Equity Curve (sampled)");
    expect(content).toContain("- Start: 2024-01-01 ¥1,000,000");
    expect(content).toContain("- End: 2024-06-01 ¥1,050,000");
    expect(content).toContain("- Max: 2024-05-01 ¥1,100,000");
    expect(content).toContain("- Min: 2024-04-01 ¥950,000");
  });

  it("renders profit factor Infinity as infinity symbol", async () => {
    const dir = await mkTmp();
    const result = sampleResult();
    result.profitFactor = Infinity;
    const file = await writeBacktestReport({
      strategy: "donchian",
      pair: "USDJPY",
      result,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
      params: {},
      initialCapital: 1_000_000,
      outputDir: dir,
    });
    const content = await fs.readFile(file, "utf-8");
    expect(content).toContain("| Profit Factor | ∞ |");
  });

  it("returns a path to a real file that exists on disk", async () => {
    const dir = await mkTmp();
    const file = await writeBacktestReport({
      strategy: "rsi-reversion",
      pair: "GBPUSD",
      result: emptyResult(),
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
      params: {},
      initialCapital: 500_000,
      outputDir: dir,
    });
    const stat = await fs.stat(file);
    expect(stat.isFile()).toBe(true);
    expect(file.endsWith(".md")).toBe(true);
    expect(path.basename(file)).toMatch(
      /^rsi-reversion-GBPUSD-\d{8}-\d{6}\.md$/,
    );
  });

  it("produces different filenames when called back-to-back", async () => {
    const dir = await mkTmp();
    const args = {
      strategy: "nr7-breakout",
      pair: "USDJPY" as const,
      result: emptyResult(),
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
      params: {},
      initialCapital: 1_000_000,
      outputDir: dir,
    };
    const file1 = await writeBacktestReport(args);
    // Ensure at least 1 second passes so the timestamp differs
    await new Promise((r) => setTimeout(r, 1100));
    const file2 = await writeBacktestReport(args);
    expect(file1).not.toBe(file2);
    const stat1 = await fs.stat(file1);
    const stat2 = await fs.stat(file2);
    expect(stat1.isFile()).toBe(true);
    expect(stat2.isFile()).toBe(true);
  });

  it("respects a custom outputDir", async () => {
    const dir = await mkTmp();
    const customDir = path.join(dir, "nested", "custom");
    const file = await writeBacktestReport({
      strategy: "combined",
      pair: "combined",
      result: emptyResult(),
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
      params: { strategyCount: 4 },
      initialCapital: 1_000_000,
      outputDir: customDir,
    });
    expect(file.startsWith(customDir)).toBe(true);
    const stat = await fs.stat(file);
    expect(stat.isFile()).toBe(true);
    expect(path.basename(file)).toMatch(
      /^combined-combined-\d{8}-\d{6}\.md$/,
    );
  });

  it("shows 'No trades.' when trades are empty but equity has data", async () => {
    const dir = await mkTmp();
    const result = emptyResult();
    result.equityCurve = [
      { date: new Date("2024-01-01"), equity: 1_000_000 },
      { date: new Date("2024-06-01"), equity: 1_000_000 },
    ];
    const file = await writeBacktestReport({
      strategy: "donchian",
      pair: "USDJPY",
      result,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-30"),
      params: {},
      initialCapital: 1_000_000,
      outputDir: dir,
    });
    const content = await fs.readFile(file, "utf-8");
    expect(content).toContain("No trades.");
    expect(content).not.toContain("No data.");
    expect(content).toContain("- Start: 2024-01-01 ¥1,000,000");
  });
});

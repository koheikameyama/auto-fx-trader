import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { PAIRS, getPairConfig } from "../src/data/pair-config.js";
import { fetchFxDaily } from "../src/data/price-loader.js";
import type { PairSymbol } from "../src/types/pair.js";

const prisma = new PrismaClient();

interface CliArgs {
  years: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let years = 10;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--years=")) {
      years = Number(a.slice("--years=".length));
      if (!Number.isFinite(years) || years <= 0) {
        throw new Error(`Invalid --years value: ${a}`);
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { years, dryRun };
}

async function upsertPairRow(symbol: PairSymbol) {
  const cfg = getPairConfig(symbol);
  // pipValueJpy is a rough reference; real usage goes through pip-value.ts
  const pipValueJpy = symbol === "USDJPY" ? 100 : 150;
  return prisma.pair.upsert({
    where: { symbol },
    create: {
      symbol,
      yfinanceTicker: cfg.yfinanceTicker,
      pipValueJpy,
      spreadPips: cfg.spreadPips,
      buySwapJpy: cfg.buySwapJpy,
      sellSwapJpy: cfg.sellSwapJpy,
    },
    update: {
      spreadPips: cfg.spreadPips,
      buySwapJpy: cfg.buySwapJpy,
      sellSwapJpy: cfg.sellSwapJpy,
      pipValueJpy,
    },
  });
}

async function main() {
  const { years, dryRun } = parseArgs();
  const end = dayjs();
  const start = end.subtract(years, "year");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(
    `Backfill range: ${startIso} → ${endIso} (${years} year${years === 1 ? "" : "s"})`,
  );
  if (dryRun) console.log("(dry-run: no DB writes)");

  for (const symbol of PAIRS) {
    console.log(`\nFetching ${symbol}...`);
    const bars = await fetchFxDaily(symbol, startIso, endIso);
    console.log(`  ${bars.length} bars`);

    if (dryRun || bars.length === 0) continue;

    const pairRow = await upsertPairRow(symbol);
    const result = await prisma.dailyBar.createMany({
      data: bars.map((b) => ({
        pairId: pairRow.id,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      skipDuplicates: true,
    });
    console.log(`  inserted ${result.count} new rows (duplicates skipped)`);
  }

  console.log("\n=== Final row counts ===");
  for (const symbol of PAIRS) {
    const pair = await prisma.pair.findUnique({ where: { symbol } });
    if (!pair) {
      console.log(`  ${symbol}: (no pair row)`);
      continue;
    }
    const count = await prisma.dailyBar.count({ where: { pairId: pair.id } });
    console.log(`  ${symbol}: ${count} bars`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

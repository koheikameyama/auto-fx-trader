import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { getPairConfig } from "../src/data/pair-config.js";
import { fetchFxIntraday } from "../src/data/price-loader.js";

const prisma = new PrismaClient();

async function upsertPair() {
  const cfg = getPairConfig("USDJPY");
  return prisma.pair.upsert({
    where: { symbol: "USDJPY" },
    create: {
      symbol: "USDJPY",
      yfinanceTicker: cfg.yfinanceTicker,
      pipValueJpy: 100,
      spreadPips: cfg.spreadPips,
      buySwapJpy: cfg.buySwapJpy,
      sellSwapJpy: cfg.sellSwapJpy,
    },
    update: {},
  });
}

async function main() {
  const end = dayjs();
  // yfinance 1h data is only available for the last ~730 days; use 23 months to stay safely within
  const start = end.subtract(23, "month");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(`Backfill USDJPY 1h: ${startIso} -> ${endIso}`);

  const pair = await upsertPair();

  console.log("Fetching 1h bars from yfinance-service...");
  const bars1h = await fetchFxIntraday("USDJPY", "1h", startIso, endIso);
  console.log(`  ${bars1h.length} 1h bars`);

  if (bars1h.length === 0) {
    console.error("No 1h bars returned. Is the service running and proxy set?");
    process.exitCode = 1;
    return;
  }

  // Wipe existing 1h rows for clean reimport
  await prisma.intradayBar.deleteMany({
    where: { pairId: pair.id, timeframe: "1h" },
  });

  const result = await prisma.intradayBar.createMany({
    data: bars1h.map((b) => ({
      pairId: pair.id,
      datetime: b.datetime,
      timeframe: "1h",
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    })),
    skipDuplicates: true,
  });

  console.log(`Inserted ${result.count} 1h bars`);

  const count1h = await prisma.intradayBar.count({
    where: { pairId: pair.id, timeframe: "1h" },
  });
  console.log(`\n=== Final count ===`);
  console.log(`  USDJPY 1h: ${count1h}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

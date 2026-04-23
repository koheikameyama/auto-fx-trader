# Minimum Experiment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** USDJPY 4時間足でMA Crossover単独戦略のWalk-Forward実験を実施し、OOS Sharpe ≥ 0.5 が達成できるか検証して FX 撤退判断を確定させる。

**Architecture:** 既存 `runBacktest` / `runWalkForward` エンジンを流用。4時間足データを保存する `IntradayBar` テーブルを新設、yfinance から1h足を取得して4h集約、`DailyBar` 互換形式に変換して既存エンジンへ渡す。7タスクで完結。

**Tech Stack:** TypeScript / Prisma / PostgreSQL / yfinance-service (FastAPI + curl_cffi) / technicalindicators / Vitest

**設計ドキュメント:** `docs/plans/2026-04-23-minimum-experiment-design.md`

---

## Task 1: Prisma IntradayBar モデル追加

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Prisma schema へ IntradayBar 追加**

`prisma/schema.prisma` の末尾（`Trade` モデルの後）に追加:

```prisma
model IntradayBar {
  id        String   @id @default(cuid())
  pairId    String
  pair      Pair     @relation(fields: [pairId], references: [id])
  datetime  DateTime
  timeframe String   // "1h" | "4h"
  open      Float
  high      Float
  low       Float
  close     Float
  volume    Float?

  @@unique([pairId, datetime, timeframe])
  @@index([pairId, timeframe, datetime])
}
```

`Pair` モデルの `relations` 節に追加:

```prisma
model Pair {
  // ... 既存フィールド ...
  dailyBars       DailyBar[]
  intradayBars    IntradayBar[]   // ← 新規追加
  trades          Trade[]
}
```

**Step 2: マイグレーション生成**

Run:
```
cd /Users/kouheikameyama/development/auto-fx-trader
npx prisma migrate dev --name add_intraday_bar
```

Expected: 新しい `prisma/migrations/<timestamp>_add_intraday_bar/migration.sql` が生成され、DBに `IntradayBar` テーブルが作成される。

**Step 3: 確認**

Run: `psql auto_fx_trader -c '\dt'`
Expected: `IntradayBar` がテーブル一覧に表示される。

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add IntradayBar model for 4h experiment"
```

---

## Task 2: IntradayBar 型と集約ロジック (TDD)

**Files:**
- Create: `src/types/intraday-bar.ts`
- Create: `src/data/intraday-loader.ts`
- Create: `src/data/__tests__/intraday-loader.test.ts`

**Step 1: 型定義を作成**

`src/types/intraday-bar.ts`:
```typescript
export type Timeframe = "1h" | "4h";

export interface IntradayBar {
  datetime: Date;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}
```

**Step 2: テストを先に書く**

`src/data/__tests__/intraday-loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { aggregate1hTo4h } from "../intraday-loader.js";
import type { IntradayBar } from "../../types/intraday-bar.js";

function mkBar(iso: string, o: number, h: number, l: number, c: number, v: number | null = null): IntradayBar {
  return {
    datetime: new Date(iso),
    timeframe: "1h",
    open: o, high: h, low: l, close: c, volume: v,
  };
}

describe("aggregate1hTo4h", () => {
  it("aggregates 4 consecutive 1h bars into one 4h bar at UTC 00:00 boundary", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155.0, 155.2, 154.9, 155.1),
      mkBar("2024-06-03T01:00:00Z", 155.1, 155.3, 155.0, 155.25),
      mkBar("2024-06-03T02:00:00Z", 155.25, 155.5, 155.2, 155.4),
      mkBar("2024-06-03T03:00:00Z", 155.4, 155.6, 155.3, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(1);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(result[0].timeframe).toBe("4h");
    expect(result[0].open).toBe(155.0);
    expect(result[0].high).toBe(155.6);
    expect(result[0].low).toBe(154.9);
    expect(result[0].close).toBe(155.5);
  });

  it("splits bars into 6 groups of 4 based on UTC 00/04/08/12/16/20 boundaries", () => {
    const bars: IntradayBar[] = [];
    // 2 full 4h windows: 00-03 and 04-07
    for (let h = 0; h < 8; h++) {
      bars.push(mkBar(`2024-06-03T${String(h).padStart(2, "0")}:00:00Z`, 155, 156, 154, 155.5));
    }
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(2);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(result[1].datetime.toISOString()).toBe("2024-06-03T04:00:00.000Z");
  });

  it("discards incomplete final group (fewer than 4 bars)", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155.5),
      // Only 2 bars in the 00-03 window
    ];
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(0);
  });

  it("sums volumes, returning null if all are null", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155, 100),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155, 200),
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155, 150),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result[0].volume).toBe(450); // 100 + 200 + 150 (null ignored)
  });

  it("returns null volume when all source volumes are null", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155, null),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result[0].volume).toBeNull();
  });

  it("handles non-boundary-aligned start (skips bars until first 00/04/08/12/16/20)", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T04:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T05:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T06:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T07:00:00Z", 155, 156, 154, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    // First 2 bars discarded (not aligned with 00/04 boundary), 04-07 forms one 4h bar
    expect(result.length).toBe(1);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T04:00:00.000Z");
  });
});
```

**Step 3: テストを走らせて失敗確認**

Run: `npm test -- src/data/__tests__/intraday-loader.test.ts`
Expected: "Failed to load url ../intraday-loader.js" or similar — module not found.

**Step 4: 実装を書く**

`src/data/intraday-loader.ts`:
```typescript
import type { IntradayBar } from "../types/intraday-bar.js";

const FOUR_HOUR_BOUNDARIES = new Set([0, 4, 8, 12, 16, 20]);

export function aggregate1hTo4h(bars1h: IntradayBar[]): IntradayBar[] {
  if (bars1h.length === 0) return [];
  const sorted = [...bars1h].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

  // Find first bar at a 4h boundary
  let startIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (FOUR_HOUR_BOUNDARIES.has(sorted[i].datetime.getUTCHours())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return [];

  const result: IntradayBar[] = [];
  for (let i = startIdx; i + 3 < sorted.length; i += 4) {
    const group = sorted.slice(i, i + 4);
    if (!FOUR_HOUR_BOUNDARIES.has(group[0].datetime.getUTCHours())) {
      break;
    }
    // Verify hours are consecutive
    const startHour = group[0].datetime.getUTCHours();
    const startDay = group[0].datetime.toISOString().slice(0, 10);
    let consecutive = true;
    for (let j = 1; j < 4; j++) {
      const expectedHour = (startHour + j) % 24;
      if (group[j].datetime.getUTCHours() !== expectedHour) {
        consecutive = false;
        break;
      }
      // If day rolled over between bars, still OK (24 -> 0)
    }
    if (!consecutive) continue;

    const volumes = group.map((b) => b.volume).filter((v): v is number => v != null);
    const volume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null;

    result.push({
      datetime: group[0].datetime,
      timeframe: "4h",
      open: group[0].open,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      close: group[3].close,
      volume,
    });
  }
  return result;
}
```

**Step 5: テスト再実行**

Run: `npm test -- src/data/__tests__/intraday-loader.test.ts`
Expected: All 6 tests PASS.

**Step 6: 全テスト + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 151+ passed, no tsc errors.

**Step 7: Commit**

```bash
git add src/types/intraday-bar.ts src/data/intraday-loader.ts src/data/__tests__/intraday-loader.test.ts
git commit -m "feat: add intraday bar type and 1h->4h aggregation"
```

---

## Task 3: yfinance-service に /fx/intraday エンドポイント追加

**Files:**
- Modify: `yfinance-service/main.py`

**Step 1: main.py に新エンドポイント追加**

既存 `/fx/daily` の下に追加:

```python
@app.get("/fx/intraday")
async def fx_intraday(ticker: str, interval: str, start: str, end: str):
    """
    Fetch intraday FX bars from yfinance.

    ticker: yfinance FX ticker, e.g. 'USDJPY=X'
    interval: '1h' only (yfinance supported interval)
    start, end: 'YYYY-MM-DD'
    """
    if interval != "1h":
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")

    try:
        def _fetch(session: CurlSession):
            t = yf.Ticker(ticker, session=session)
            df = t.history(start=start, end=end, interval="1h", auto_adjust=False)
            return df

        df = await throttled_with_retry(_fetch)

        if df is None or df.empty:
            return {"ticker": ticker, "interval": interval, "bars": []}

        _flatten_columns(df)
        bars = []
        for ts, row in df.iterrows():
            o = safe_float_or_none(row.get("Open"))
            h = safe_float_or_none(row.get("High"))
            l = safe_float_or_none(row.get("Low"))
            c = safe_float_or_none(row.get("Close"))
            if o is None or h is None or l is None or c is None:
                continue
            # ts is pandas Timestamp; convert to ISO UTC
            if hasattr(ts, "tz_convert"):
                ts_utc = ts.tz_convert("UTC") if ts.tzinfo else ts.tz_localize("UTC")
            else:
                ts_utc = ts
            dt_iso = ts_utc.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(ts_utc, "strftime") else str(ts_utc)
            bars.append({
                "datetime": dt_iso,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": safe_float_or_none(row.get("Volume")),
            })
        return {"ticker": ticker, "interval": interval, "bars": bars}
    except Exception as e:
        logger.error(f"Failed to fetch intraday for {ticker}: {e}")
        raise HTTPException(status_code=_error_status(e), detail=_error_detail(e))
```

**Step 2: Start service with proxy, smoke test**

```bash
export YFINANCE_PROXY=$(grep '^YFINANCE_PROXY=' /Users/kouheikameyama/development/auto-fx-trader/.env | sed 's/^YFINANCE_PROXY=//;s/^"//;s/"$//')
cd /Users/kouheikameyama/development/auto-fx-trader/yfinance-service
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8765 > /tmp/yfinance-test.log 2>&1 &
sleep 3
```

**Step 3: Test /fx/intraday for 1 week window**

Use a recent week (within last 2 years). Today is 2026-04-23, pick 2026-04-14 to 2026-04-21:

```bash
curl -s 'http://localhost:8765/fx/intraday?ticker=USDJPY=X&interval=1h&start=2026-04-14&end=2026-04-21' | head -c 800
```

Expected: JSON with bars array, each bar having `datetime` (ISO UTC with `Z` suffix), OHLC numbers. Should return ~100+ bars for a week.

**Step 4: Verify interval rejection**

```bash
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8765/fx/intraday?ticker=USDJPY=X&interval=5m&start=2026-04-14&end=2026-04-21'
```
Expected: HTTP 400 with detail "Unsupported interval: 5m".

**Step 5: Kill the service**

```bash
pkill -f 'uvicorn main:app'
```

**Step 6: Commit**

```bash
git add yfinance-service/main.py
git commit -m "feat: add /fx/intraday endpoint to yfinance-service"
```

---

## Task 4: TS側 fetchFxIntraday 関数追加 (TDD)

**Files:**
- Modify: `src/data/price-loader.ts`
- Modify: `src/data/__tests__/price-loader.test.ts`

**Step 1: テストを先に書く（既存 price-loader.test.ts に追加）**

ファイルの既存 `describe("fetchFxDaily", ...)` の下に `describe("fetchFxIntraday", ...)` ブロックを追加:

```typescript
import { fetchFxDaily, fetchFxIntraday } from "../price-loader.js";

// ... existing fetchFxDaily tests ...

describe("fetchFxIntraday", () => {
  it("parses intraday response into IntradayBar[] with timeframe='1h'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticker: "USDJPY=X",
        interval: "1h",
        bars: [
          { datetime: "2024-06-03T00:00:00Z", open: 155.0, high: 155.2, low: 154.9, close: 155.1, volume: 0 },
          { datetime: "2024-06-03T01:00:00Z", open: 155.1, high: 155.3, low: 155.0, close: 155.25, volume: null },
        ],
      }),
    }) as unknown as typeof fetch;

    const bars = await fetchFxIntraday("USDJPY", "1h", "2024-06-01", "2024-06-10");

    expect(bars.length).toBe(2);
    expect(bars[0].datetime).toBeInstanceOf(Date);
    expect(bars[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(bars[0].timeframe).toBe("1h");
    expect(bars[0].close).toBe(155.1);
    expect(bars[1].volume).toBeNull();
  });

  it("URL contains interval and date params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "USDJPY=X", interval: "1h", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxIntraday("USDJPY", "1h", "2024-06-01", "2024-06-10");

    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? "") as string;
    expect(calledUrl).toContain("ticker=USDJPY%3DX");
    expect(calledUrl).toContain("interval=1h");
    expect(calledUrl).toContain("start=2024-06-01");
    expect(calledUrl).toContain("end=2024-06-10");
  });

  it("throws when service returns non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Unsupported interval",
    }) as unknown as typeof fetch;

    await expect(fetchFxIntraday("USDJPY", "5m", "2024-06-01", "2024-06-10")).rejects.toThrow(/400/);
  });
});
```

**Step 2: テスト失敗を確認**

Run: `npm test -- src/data/__tests__/price-loader.test.ts`
Expected: 3 new tests fail with "fetchFxIntraday is not exported".

**Step 3: 実装を追加**

`src/data/price-loader.ts` の末尾に追加:

```typescript
import type { IntradayBar, Timeframe } from "../types/intraday-bar.js";

interface ServiceIntradayBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface ServiceIntradayResponse {
  ticker: string;
  interval: string;
  bars: ServiceIntradayBar[];
}

export async function fetchFxIntraday(
  pair: PairSymbol,
  interval: Timeframe,
  startIso: string,
  endIso: string,
): Promise<IntradayBar[]> {
  const { yfinanceTicker } = getPairConfig(pair);
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    ticker: yfinanceTicker,
    interval,
    start: startIso,
    end: endIso,
  });
  const url = `${base}/fx/intraday?${params.toString()}`;

  const headers: Record<string, string> = {};
  const secret = process.env.SIDECAR_SECRET;
  if (secret) {
    headers["x-api-key"] = secret;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`yfinance-service error: ${res.status} ${body}`);
  }

  const body = (await res.json()) as ServiceIntradayResponse;
  return body.bars.map((b) => ({
    datetime: new Date(b.datetime),
    timeframe: interval,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}
```

**Step 4: テスト通過確認 + 全テスト + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 154+ passed (151 + 3 new), tsc clean.

**Step 5: Commit**

```bash
git add src/data/price-loader.ts src/data/__tests__/price-loader.test.ts
git commit -m "feat: add fetchFxIntraday for 1h bars from yfinance-service"
```

---

## Task 5: バックフィルスクリプト

**Files:**
- Create: `scripts/backfill-usdjpy-4h.ts`

**Step 1: スクリプト作成**

```typescript
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { getPairConfig } from "../src/data/pair-config.js";
import { fetchFxIntraday } from "../src/data/price-loader.js";
import { aggregate1hTo4h } from "../src/data/intraday-loader.js";

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
  // yfinance 1h足は直近730日までなので2年に制限
  const start = end.subtract(2, "year");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(`Backfill USDJPY 4h: ${startIso} -> ${endIso}`);

  const pair = await upsertPair();

  console.log("Fetching 1h bars from yfinance-service...");
  const bars1h = await fetchFxIntraday("USDJPY", "1h", startIso, endIso);
  console.log(`  ${bars1h.length} 1h bars`);

  if (bars1h.length === 0) {
    console.error("No 1h bars returned. Is the service running and proxy set?");
    process.exitCode = 1;
    return;
  }

  // Save 1h bars
  const result1h = await prisma.intradayBar.createMany({
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
  console.log(`  1h saved: ${result1h.count} new rows (duplicates skipped)`);

  // Aggregate to 4h
  console.log("Aggregating to 4h...");
  const bars4h = aggregate1hTo4h(bars1h);
  console.log(`  ${bars4h.length} 4h bars`);

  const result4h = await prisma.intradayBar.createMany({
    data: bars4h.map((b) => ({
      pairId: pair.id,
      datetime: b.datetime,
      timeframe: "4h",
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    })),
    skipDuplicates: true,
  });
  console.log(`  4h saved: ${result4h.count} new rows`);

  console.log("\n=== Final counts ===");
  const count1h = await prisma.intradayBar.count({
    where: { pairId: pair.id, timeframe: "1h" },
  });
  const count4h = await prisma.intradayBar.count({
    where: { pairId: pair.id, timeframe: "4h" },
  });
  console.log(`  USDJPY 1h: ${count1h}`);
  console.log(`  USDJPY 4h: ${count4h}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

**Step 2: yfinance-service を起動（プロキシ付き）**

```bash
export YFINANCE_PROXY=$(grep '^YFINANCE_PROXY=' /Users/kouheikameyama/development/auto-fx-trader/.env | sed 's/^YFINANCE_PROXY=//;s/^"//;s/"$//')
cd /Users/kouheikameyama/development/auto-fx-trader/yfinance-service
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8765 > /tmp/yfinance-bf.log 2>&1 &
sleep 3
curl -s http://localhost:8765/health
```

Expected: `{"status":"ok"}`

**Step 3: tsc確認**

Run: `npx tsc --noEmit`
Expected: clean.

**Step 4: スクリプト実行**

```bash
cd /Users/kouheikameyama/development/auto-fx-trader
npx tsx scripts/backfill-usdjpy-4h.ts
```

Expected:
- "Fetching 1h bars from yfinance-service..." 続いて件数
- 1h足 約12000本、4h足 約3000本
- "USDJPY 1h: ~12000", "USDJPY 4h: ~3000"

**Step 5: yfinance-service 停止**

```bash
pkill -f 'uvicorn main:app'
```

**Step 6: DB確認**

```bash
psql auto_fx_trader -c 'SELECT timeframe, COUNT(*), MIN(datetime), MAX(datetime) FROM "IntradayBar" GROUP BY timeframe ORDER BY timeframe;'
```
Expected: 1h ~12000 rows, 4h ~3000 rows, 2年分の期間。

**Step 7: Commit**

```bash
git add scripts/backfill-usdjpy-4h.ts
git commit -m "feat: add USDJPY 4h backfill script"
```

---

## Task 6: 実験ランナー実装 + 実行

**Files:**
- Create: `scripts/experiment-usdjpy-4h-ma.ts`

**Step 1: ランナー作成**

```typescript
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
  minSharpe: 0.5,     // Relaxed target for minimum experiment
  minMar: 0.3,
  minPf: 1.2,
  maxDd: 0.15,
  maxSharpeDrop: 0.50, // Relaxed
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

  // 4h strategy with adjusted timeStop (interpreting "days" as "bars")
  const strategy = {
    ...maCrossoverStrategy,
    name: EXPERIMENT_ID,
    exitConfig: {
      useTrailing: true,
      slAtrMultiplier: 1.0,
      beAtrMultiplier: 0.5,
      trailAtrMultiplier: 1.0,
      timeStopDays: 60,    // 10 days × 6 bars/day
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

  // Persist WalkForwardRun
  await prisma.walkForwardRun.create({
    data: {
      strategy: EXPERIMENT_ID,
      pairSymbol: PAIR_SYMBOL,
      startDate: bars[0].date,
      endDate: bars[bars.length - 1].date,
      isMonths: 4,      // ~500 bars / 6 per day / 21 days per month
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

  // Write markdown report
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
```

**Step 2: tsc確認**

Run: `npx tsc --noEmit`
Expected: clean.

**Step 3: 実験実行**

```bash
cd /Users/kouheikameyama/development/auto-fx-trader
npx tsx scripts/experiment-usdjpy-4h-ma.ts
```

Expected:
- "Loaded ~3000 4h bars"
- "Windows: ~10"
- OOS Sharpe 値（目標 >= 0.5）
- Verdict: PASS or FAIL
- Report written to `reports/experiments/`

**Step 4: DB確認**

```bash
psql auto_fx_trader -c "SELECT strategy, \"oosAvgSharpe\", passed FROM \"WalkForwardRun\" WHERE strategy = 'ma-crossover-4h-usdjpy' ORDER BY \"createdAt\" DESC LIMIT 1;"
```
Expected: 1 row with the experiment result.

**Step 5: Commit**

```bash
git add scripts/experiment-usdjpy-4h-ma.ts reports/experiments/
git commit -m "feat: add USDJPY 4h MA Crossover minimum experiment runner and result"
```

---

## Task 7: 判定に基づく結果レポート作成

**Files:**
- Create: `docs/specs/minimum-experiment-result.md`

**Step 1: Task 6 の実行結果を受けて判定レポートを書く**

テンプレート（実数値は Task 6 の結果で埋める）:

```markdown
# Minimum Experiment Result: USDJPY 4h MA Crossover

**Date:** 2026-04-23
**Status:** PASS / FAIL（Task 6 の結果で確定）

## 実験条件（エグゼクティブサマリから継承）

- Pair: USDJPY 単独
- Timeframe: 4時間足
- Strategy: MA Crossover (shortEma のみ最適化)
- Param grid: shortEma ∈ [5, 10, 15, 20, 25], longEma=50, atrPeriod=14
- Data: 過去2年, 約3000 4h bars
- WF: IS 500 / OOS 250 / Step 125 / ~10 windows
- Target: OOS Sharpe >= 0.5

## 結果

| KPI | 実測値 | 目標 | 判定 |
|---|---:|---:|:---:|
| OOS Avg Sharpe | X.XXX | >= 0.5 | ✅/❌ |
| OOS Avg MAR | X.XXX | >= 0.3 | ✅/❌ |
| OOS Avg PF | X.XXX | >= 1.2 | ✅/❌ |
| OOS Max DD | XX.XX% | <= 15% | ✅/❌ |
| IS->OOS Drop | XX.XX% | <= 50% | ✅/❌ |

## 窓ごとの shortEma 選択

（Task 6 レポートから転記、安定性を評価）

## 判定

### PASS の場合
FX再挑戦を具体検討する。次のステップ候補:
- 他ペア（EURUSD/GBPUSD）で同条件を試す
- 戦略追加（Donchian等）
- 実運用への道筋検討

### FAIL の場合
**FX撤退を確定**。次のアクション:
- このリポジトリは「FXでは勝てない」を実証した記録として保管
- auto-stock-trader の運用・改善に集中
- FX関連の話題には「10年データで4戦略WF + 最小実験でも無理だった」と根拠をもって回答

## 今後FXに戻る場合の条件

もし将来FXに戻りたくなったら、**今回と同等以上の強いエビデンス**が必要:
- 新しい戦略アイデア（例: マクロ連動、キャリー、オプション）
- 新しいデータソース（例: ティック、オーダーブック）
- 新しい時間軸（例: 週足、分足スキャルピング）

単なる「もう一度試したい」では戻らない。
```

**Step 2: コミット**

```bash
git add docs/specs/minimum-experiment-result.md
git commit -m "docs: minimum experiment result and decision"
```

---

## Task 8: エグゼクティブサマリ更新

**Files:**
- Modify: `docs/specs/executive-summary.md`

**Step 1: 実験結果セクションを追記**

ファイル末尾の「次のアクション」節の前に追加:

```markdown
## 最小実験（2026-04-23 実施）

USDJPY 4h MA Crossover単独実験の結果: **PASS / FAIL**

- 実測 OOS Sharpe: X.XXX（目標 0.5）
- 詳細: [minimum-experiment-result.md](minimum-experiment-result.md)
- 判定: 撤退確定 / 再挑戦検討

これにより上記「撤退推奨」が**実験的に確定 / 再評価**された。
```

**Step 2: Commit**

```bash
git add docs/specs/executive-summary.md
git commit -m "docs: update executive summary with experiment outcome"
```

---

## 実装順序の推奨

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8

**チェックポイント:**
- Task 2 完了: 集約ロジックの単体テスト通過
- Task 5 完了: 実データがDBに投入され確認可能
- Task 6 完了: 実験結果が得られ判定確定
- Task 8 完了: 全ドキュメント更新、FX分岐の最終結論がリポジトリに記録される

## 失敗モードと対処

| 失敗 | 対処 |
|---|---|
| yfinance 1h足で429/401 | プロキシ有効を確認、時間を空けて再試行 |
| 1h足のバー数が想定より少ない | 取得期間を調整、ただし過去730日より前は yfinance 側で返らないので受け入れる |
| 4h集約後のバー数が想定より少ない | 週末ギャップを許容、3000 → 2500 程度でも実験続行可 |
| 実験実行でエラー | 既存151テスト + tsc で基本動作を確認、バックフィル直後の DB 状態を psql で検証 |

## 将来拡張への配慮（MVPスコープ外）

- 他ペア（EURUSD/GBPUSD）の 4h データは取らない（USDJPYで判定決着する想定）
- 他戦略（Donchian, RSI, NR7）の 4h 版は作らない
- 実運用・実注文は依然として対象外

以上。

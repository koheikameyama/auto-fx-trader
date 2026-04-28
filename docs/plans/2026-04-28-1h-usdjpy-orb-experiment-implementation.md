# 1h USDJPY ORB Experiment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build London Opening Range Breakout strategy on 1h USDJPY bars, run a 17-window walk-forward, and produce a PASS/FAIL verdict against pre-defined criteria (OOS Sharpe ≥ 0.5, IS→OOS drop ≤ 50%).

**Architecture:** Reuse existing strategy/backtest/walk-forward infrastructure. Add a new ORB strategy under `src/core/orb/`, extend `ExitConfig` with an optional `sessionEndUtcHour` so positions can be force-closed at session end (current exit-manager only supports day-rounded time stops which break on intraday bars), reuse `fetchFxIntraday()` to backfill 2 years of 1h USDJPY into the existing `IntradayBar` table, and mirror `experiment-usdjpy-4h-ma.ts` for the experiment runner.

**Tech Stack:** TypeScript, Vitest (TDD, ESM `.js` imports), Prisma + PostgreSQL, dayjs, existing `walk-forward/engine.ts` & `backtest/engine.ts`.

**Design ref:** [docs/plans/2026-04-28-1h-usdjpy-orb-experiment-design.md](2026-04-28-1h-usdjpy-orb-experiment-design.md)

---

## Task 1: Extend ExitConfig with `sessionEndUtcHour`

The current `exit-manager.ts` time-stop uses `daysBetween` which rounds to days — useless on 1h bars where ORB positions live for hours. We add an optional `sessionEndUtcHour: number | null` so positions opened in a session are force-closed when the bar's UTC hour reaches that value. Backwards-compatible: if `null` or undefined, behavior is unchanged.

**Files:**
- Modify: `src/types/strategy.ts`
- Modify: `src/backtest/exit-manager.ts`
- Test: `src/backtest/__tests__/exit-manager-session.test.ts` (new)

**Step 1: Write the failing test**

Create `src/backtest/__tests__/exit-manager-session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluateExit } from "../exit-manager.js";

const baseCfg = {
  useTrailing: false,
  timeStopDays: 999,
  timeStopMaxDays: 999,
  slAtrMultiplier: 999,
  beAtrMultiplier: 999,
  trailEnabled: false,
  trailAtrMultiplier: 0,
  sessionEndUtcHour: 15,
};

const baseState = {
  side: "long" as const,
  entryDate: new Date("2026-01-15T07:00:00Z"),
  entryPrice: 150.0,
  entryAtr: 0.2,
  highSinceEntry: 150.0,
  lowSinceEntry: 150.0,
  currentSl: 149.0,
  hasBreakEven: false,
};

describe("evaluateExit with sessionEndUtcHour", () => {
  it("force-closes when bar UTC hour reaches sessionEndUtcHour", () => {
    const bar = { date: new Date("2026-01-15T15:00:00Z"), open: 150.5, high: 150.6, low: 150.4, close: 150.55, volume: null };
    const result = evaluateExit({ state: baseState, bar, cfg: baseCfg, daysHeld: 0 });
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("session-end");
    expect(result.exit.exitPrice).toBe(150.55);
  });

  it("does not force-close before sessionEndUtcHour", () => {
    const bar = { date: new Date("2026-01-15T14:00:00Z"), open: 150.5, high: 150.6, low: 150.4, close: 150.55, volume: null };
    const result = evaluateExit({ state: baseState, bar, cfg: baseCfg, daysHeld: 0 });
    expect(result.exit.exited).toBe(false);
  });

  it("ignores sessionEndUtcHour when null", () => {
    const cfg = { ...baseCfg, sessionEndUtcHour: null };
    const bar = { date: new Date("2026-01-15T15:00:00Z"), open: 150.5, high: 150.6, low: 150.4, close: 150.55, volume: null };
    const result = evaluateExit({ state: baseState, bar, cfg, daysHeld: 0 });
    expect(result.exit.exited).toBe(false);
  });
});
```

**Step 2: Run test, confirm it fails**

```bash
npm run test -- exit-manager-session
```
Expected: FAIL — `sessionEndUtcHour` field not on `ExitConfig`, and reason `session-end` not handled.

**Step 3: Update `ExitConfig` type**

Edit `src/types/strategy.ts` — add to `ExitConfig`:
```ts
sessionEndUtcHour?: number | null;
```

**Step 4: Update `exit-manager.ts`**

Add new exit reason `"session-end"` and a check at the top of the exit logic (before time-stop):
```ts
// Session-end exit (intraday strategies)
if (cfg.sessionEndUtcHour != null && bar.date.getUTCHours() >= cfg.sessionEndUtcHour) {
  return {
    newState: { ...state, highSinceEntry, lowSinceEntry, currentSl, hasBreakEven },
    exit: { exited: true, exitPrice: bar.close, exitReason: "session-end" },
  };
}
```
Place this check **after** the existing SL/BE updates but **before** the time-stop block. Also extend the `exitReason` union type if it's a literal.

**Step 5: Verify the new test passes and no regressions**

```bash
npm run test
```
Expected: All tests pass (existing + 3 new).

**Step 6: Commit**

```bash
git add src/types/strategy.ts src/backtest/exit-manager.ts src/backtest/__tests__/exit-manager-session.test.ts
git commit -m "feat: add sessionEndUtcHour exit option for intraday strategies"
```

---

## Task 2: Define ORB params type

**Files:**
- Create: `src/core/orb/params.ts`

**Step 1: Write `params.ts`**

```ts
export interface OrbParams {
  rangeHours: number;
  atrMultStop: number;
  atrPeriod: number;
  sessionStartUtcHour: number;
  sessionEndUtcHour: number;
}

export const orbDefaults: OrbParams = {
  rangeHours: 3,
  atrMultStop: 1.5,
  atrPeriod: 14,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 15,
};
```

**Step 2: Commit**

```bash
git add src/core/orb/params.ts
git commit -m "feat: add ORB strategy params"
```

---

## Task 3: Write ORB strategy tests (TDD)

**Files:**
- Create: `src/core/orb/__tests__/orb.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { orbStrategy } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

// Build a bar at a given UTC datetime
function bar(iso: string, o: number, h: number, l: number, c: number): DailyBar {
  return { date: new Date(iso), open: o, high: h, low: l, close: c, volume: null };
}

describe("orbStrategy.generateSignals", () => {
  const params = {
    rangeHours: 3,
    atrMultStop: 1.5,
    atrPeriod: 14,
    sessionStartUtcHour: 7,
    sessionEndUtcHour: 15,
  };

  it("emits no signal when no breakout occurs in session", () => {
    // 14 priming bars (for ATR), then session 07:00-14:00 UTC stays flat
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    for (let h = 7; h < 15; h++) {
      bars.push(bar(`2026-01-15T${String(h).padStart(2, "0")}:00:00Z`, 150.0, 150.05, 149.95, 150.0));
    }
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(0);
  });

  it("emits long signal when bar after range window breaks above range high", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    // Session range bars (07,08,09 UTC) form range 149.9–150.2
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.10));
    bars.push(bar("2026-01-15T09:00:00Z", 150.10, 150.20, 150.00, 150.15));
    // Breakout bar at 10:00 UTC closes above 150.20
    bars.push(bar("2026-01-15T10:00:00Z", 150.15, 150.40, 150.10, 150.35));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].side).toBe("long");
    expect(sigs[0].entryPrice).toBe(150.35);
    expect(sigs[0].date.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("emits short signal when bar after range window breaks below range low", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.00));
    bars.push(bar("2026-01-15T09:00:00Z", 150.00, 150.10, 149.90, 149.95));
    bars.push(bar("2026-01-15T10:00:00Z", 149.95, 150.00, 149.70, 149.75));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].side).toBe("short");
  });

  it("emits at most one signal per session day (first breakout wins)", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    bars.push(bar("2026-01-15T07:00:00Z", 150.0, 150.1, 149.9, 150.05));
    bars.push(bar("2026-01-15T08:00:00Z", 150.05, 150.15, 149.95, 150.10));
    bars.push(bar("2026-01-15T09:00:00Z", 150.10, 150.20, 150.00, 150.15));
    // Two breakouts in one day — only first should fire
    bars.push(bar("2026-01-15T10:00:00Z", 150.15, 150.40, 150.10, 150.35));
    bars.push(bar("2026-01-15T11:00:00Z", 150.35, 150.50, 150.30, 150.45));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].date.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("does not emit signals from bars outside the London session", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push(bar(`2026-01-14T${String(i).padStart(2, "0")}:00:00Z`, 150.0, 150.1, 149.9, 150.0));
    }
    // Asia session breakout at 03:00 UTC — should be ignored
    bars.push(bar("2026-01-15T03:00:00Z", 150.0, 151.0, 149.0, 151.0));
    const sigs = orbStrategy.generateSignals(bars, "USDJPY", params);
    expect(sigs).toHaveLength(0);
  });
});
```

**Step 2: Run tests, confirm they fail**

```bash
npm run test -- orb
```
Expected: FAIL — `orbStrategy` does not exist.

**Step 3: Commit (test-only commit)**

```bash
git add src/core/orb/__tests__/orb.test.ts
git commit -m "test: add ORB strategy spec"
```

---

## Task 4: Implement ORB strategy

**Files:**
- Create: `src/core/orb/index.ts`

**Step 1: Implement `index.ts`**

```ts
import { computeATR } from "../../lib/indicators/atr.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { PairSymbol } from "../../types/pair.js";
import { orbDefaults, type OrbParams } from "./params.js";

export { orbDefaults } from "./params.js";
export type { OrbParams } from "./params.js";

export const orbStrategy: Strategy<OrbParams> = {
  name: "orb",
  defaultParams: orbDefaults,
  exitConfig: {
    useTrailing: false,
    timeStopDays: 999, // disabled — session-end handles intraday close
    timeStopMaxDays: 999,
    slAtrMultiplier: 1.5,
    beAtrMultiplier: 999,
    trailAtrMultiplier: 0,
    sessionEndUtcHour: 15,
  },
  generateSignals(
    bars: DailyBar[],
    pair: PairSymbol,
    params: OrbParams,
  ): EntrySignal[] {
    const atr = computeATR(bars, params.atrPeriod);
    const signals: EntrySignal[] = [];

    // Group bars by UTC date string and within each day, identify session bars
    let currentDay = "";
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    let rangeBarsCollected = 0;
    let sessionFired = false;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const a = atr[i];
      const hour = b.date.getUTCHours();
      const day = b.date.toISOString().slice(0, 10);

      if (day !== currentDay) {
        currentDay = day;
        rangeHigh = -Infinity;
        rangeLow = Infinity;
        rangeBarsCollected = 0;
        sessionFired = false;
      }

      // Skip bars outside the London session
      if (hour < params.sessionStartUtcHour || hour >= params.sessionEndUtcHour) continue;
      if (sessionFired) continue;

      // First `rangeHours` bars of the session define the range
      if (rangeBarsCollected < params.rangeHours) {
        rangeHigh = Math.max(rangeHigh, b.high);
        rangeLow = Math.min(rangeLow, b.low);
        rangeBarsCollected++;
        continue;
      }

      // After range is set, look for breakout (close-based)
      if (a === null) continue;
      if (b.close > rangeHigh) {
        signals.push({
          date: b.date,
          pair,
          side: "long",
          entryPrice: b.close,
          atr: a,
        });
        sessionFired = true;
      } else if (b.close < rangeLow) {
        signals.push({
          date: b.date,
          pair,
          side: "short",
          entryPrice: b.close,
          atr: a,
        });
        sessionFired = true;
      }
    }
    return signals;
  },
};
```

**Step 2: Run tests, confirm they pass**

```bash
npm run test -- orb
```
Expected: All 5 ORB tests pass.

**Step 3: Run full suite for regressions**

```bash
npm run test
```
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/core/orb/index.ts
git commit -m "feat: implement ORB strategy"
```

---

## Task 5: Add 1h USDJPY backfill script

Mirror `scripts/backfill-usdjpy-4h.ts` but skip the 1h→4h aggregation step (we want 1h bars persisted directly).

**Files:**
- Create: `scripts/backfill-usdjpy-1h.ts`
- Modify: `package.json`

**Step 1: Write the script**

```ts
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
  const start = end.subtract(23, "month"); // yfinance 1h limit ~730 days
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

**Step 2: Add npm script**

In `package.json` `scripts`:
```json
"backfill:usdjpy-1h": "tsx scripts/backfill-usdjpy-1h.ts",
```

**Step 3: Commit**

```bash
git add scripts/backfill-usdjpy-1h.ts package.json
git commit -m "feat: add 1h USDJPY backfill script"
```

---

## Task 6: Run backfill (manual checkpoint)

**Stop and ask the user to run:**

```fish
# Ensure yfinance-service is running on port 8765 (with proxy if needed)
npm run backfill:usdjpy-1h
```

Expected output: `Inserted ~12000 1h bars`. If <8000 bars, investigate (yfinance throttling, proxy issue) before continuing.

**Verification query:**
```fish
psql $DATABASE_URL -c 'SELECT COUNT(*), MIN(datetime), MAX(datetime) FROM "IntradayBar" WHERE timeframe = '"'"'1h'"'"';'
```
Expected: count > 8000, span ≈ 2 years.

---

## Task 7: Implement experiment runner

Mirror `scripts/experiment-usdjpy-4h-ma.ts` with ORB-specific param grid and bar count thresholds.

**Files:**
- Create: `scripts/experiment-usdjpy-1h-orb.ts`
- Modify: `package.json`

**Step 1: Write the script**

```ts
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
  maxSharpeDrop: 0.50,
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
    atrMultStop: [1.5],
    atrPeriod: [14],
    sessionStartUtcHour: [7],
    sessionEndUtcHour: [15],
  };

  console.log(`\n========================================`);
  console.log(`Experiment: ${EXPERIMENT_ID}`);
  console.log(`Bars: ${bars.length} | Period: ${bars[0].date.toISOString().slice(0, 10)} -> ${bars[bars.length - 1].date.toISOString().slice(0, 10)}`);
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
  const variance = oosSharpes.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(oosSharpes.length, 1);
  const stdev = Math.sqrt(variance);

  console.log(`\nWindows: ${result.windows.length}`);
  console.log(`OOS avg Sharpe: ${result.oosAvgSharpe.toFixed(3)}`);
  console.log(`OOS Sharpe stdev: ${stdev.toFixed(3)}`);
  console.log(`OOS winning windows: ${winningWindows}/${oosSharpes.length} (${(winRate * 100).toFixed(1)}%)`);
  console.log(`OOS avg MAR: ${result.oosAvgMar.toFixed(3)}`);
  console.log(`OOS avg PF: ${result.oosAvgPf.toFixed(3)}`);
  console.log(`OOS max DD: ${(result.oosMaxDd * 100).toFixed(2)}%`);
  console.log(`IS->OOS Sharpe drop: ${(result.isOosSharpeDrop * 100).toFixed(2)}%`);

  const check = checkRobustness(result, criteria);

  // Apply 4-bucket verdict from design
  const sharpePass = result.oosAvgSharpe >= 0.5;
  const dropPass = result.isOosSharpeDrop <= 0.50;
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
    `| OOS Avg Sharpe | ${result.oosAvgSharpe.toFixed(3)} | >= 0.5 | ${sharpePass ? "✅" : "❌"} |`,
    `| IS->OOS Sharpe Drop | ${(result.isOosSharpeDrop * 100).toFixed(2)}% | <= 50% | ${dropPass ? "✅" : "❌"} |`,
    `| OOS Sharpe Stdev | ${stdev.toFixed(3)} | <= 1.0 | ${stdev <= 1.0 ? "✅" : "❌"} |`,
    `| OOS Winning Windows | ${winningWindows}/${oosSharpes.length} (${(winRate * 100).toFixed(1)}%) | >= 60% | ${winRate >= 0.6 ? "✅" : "❌"} |`,
    `| OOS Avg MAR | ${result.oosAvgMar.toFixed(3)} | >= 0.3 | ${result.oosAvgMar >= 0.3 ? "✅" : "❌"} |`,
    `| OOS Avg PF | ${result.oosAvgPf.toFixed(3)} | >= 1.2 | ${result.oosAvgPf >= 1.2 ? "✅" : "❌"} |`,
    `| OOS Max DD | ${(result.oosMaxDd * 100).toFixed(2)}% | <= 15% | ${result.oosMaxDd <= 0.15 ? "✅" : "❌"} |`,
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
```

**Step 2: Add npm script**

In `package.json`:
```json
"experiment:orb-1h": "tsx scripts/experiment-usdjpy-1h-orb.ts",
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add scripts/experiment-usdjpy-1h-orb.ts package.json
git commit -m "feat: add 1h USDJPY ORB experiment runner"
```

---

## Task 8: Run experiment (manual checkpoint)

**Stop and ask the user to run:**

```fish
npm run experiment:orb-1h
```

Expected output: console summary + report path. Report goes to `reports/experiments/orb-1h-usdjpy-<timestamp>.md`. Verdict will be one of `PASS / PARTIAL_DROP / PARTIAL_SHARPE / FAIL`.

---

## Task 9: Write the result document (verdict-driven)

Based on the verdict from Task 8, write `docs/specs/orb-1h-experiment-result.md` and update the executive summary.

**Branching by verdict:**

### If `PASS`:
- Write result doc summarizing all PASS criteria met
- Add a "Next phase" section noting the design's follow-up tasks (NY ORB, other pairs, forward test)
- Update `docs/specs/executive-summary.md` to note the ORB success and next phase
- Do **not** declare full FX victory — make clear this is "minimum bar cleared, more validation needed"

### If `FAIL`:
- Write result doc with full KPI table, window breakdown, and "FX completely withdrawn — no timeframe works" conclusion
- Update `docs/specs/minimum-experiment-result.md` to cross-reference the new doc
- Update `docs/specs/executive-summary.md`: "Daily / 4h / 1h all FAIL — FX strategically discontinued"
- Update [CLAUDE.md](../../CLAUDE.md) "現状" line to reflect 1h failure too

### If `PARTIAL_*`:
- Write result doc explaining the partial result
- Document the **single follow-up trial** allowed by the design (e.g., for `PARTIAL_DROP`: fix `rangeHours = best window's mode` and rerun; for `PARTIAL_SHARPE`: try NY session or different stop)
- Hand off to the user to decide whether to run the follow-up

**Step 1: Write the doc** (template will be filled with actual numbers from the report)

Path: `docs/specs/orb-1h-experiment-result.md`

Template (verdict-aware, fill numbers from report):
```markdown
# Experiment Result: 1h USDJPY London ORB

**Date:** YYYY-MM-DD
**Status:** [PASS / FAIL / PARTIAL_DROP / PARTIAL_SHARPE]

## Conditions
[fill from report]

## Results
[KPI table from report]

## Per-Window
[abbreviated window table — first/last 5 + summary stats]

## Verdict & Next Action
[verdict-specific section per branching above]

## Reference
- [Design](../plans/2026-04-28-1h-usdjpy-orb-experiment-design.md)
- [Implementation Plan](../plans/2026-04-28-1h-usdjpy-orb-experiment-implementation.md)
- [Generated report](../../reports/experiments/orb-1h-usdjpy-<ts>.md)
```

**Step 2: Update executive summary and (if FAIL) CLAUDE.md**

**Step 3: Commit**

```bash
git add docs/specs/orb-1h-experiment-result.md docs/specs/executive-summary.md
# Also CLAUDE.md if FAIL
git commit -m "docs: 1h ORB experiment result and verdict"
```

---

## Verification Checklist

Before declaring this plan complete:

- [ ] Task 1: `exit-manager-session.test.ts` passes; full test suite green
- [ ] Task 2-4: ORB strategy implemented, all 5 unit tests green, full suite green
- [ ] Task 5-6: 1h backfill script works; DB has > 8000 1h USDJPY bars
- [ ] Task 7: Experiment script type-checks
- [ ] Task 8: Experiment runs to completion, produces report markdown + DB row
- [ ] Task 9: Result doc written with correct verdict + follow-ups

## Out of scope (do NOT do)

- NY session ORB, other pairs (EURUSD/GBPUSD), forward testing — only after PASS verdict
- Adding more parameters to optimize beyond `rangeHours` — design forbids this to avoid overfitting
- Changing WF window sizes mid-experiment — pre-committed parameters
- Re-running after seeing results to "improve" — single trial discipline (the design's PARTIAL section allows ONE pre-declared follow-up only)

# Auto FX Trader Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** FXで「実用化できる戦略」をバックテスト + Walk-Forward検証で見つける研究フレームワークをゼロから構築する。

**Architecture:** TypeScript単一モノレポ。Hono + Prisma(PostgreSQL) + Python yfinance-service。4戦略（Donchian / MA Crossover / RSI Mean Reversion / NR7 Breakout）を共通バックテストエンジンと共通Exitマネージャで実装。WFエンジンが12ヶ月IS/6ヶ月OOS/0.5年ステップでパラメータ最適化 + ロバスト性判定。結果はDB + Markdownレポートに出力。

**Tech Stack:** Node.js 22+ / TypeScript / Hono / Prisma / PostgreSQL / Python 3 / yfinance / technicalindicators / Vitest / ESLint

**設計ドキュメント:** `docs/plans/2026-04-23-auto-fx-trader-design.md`

---

## Phase 1: 基盤セットアップ

### Task 1: package.json とディレクトリ骨格

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/` / `scripts/` / `yfinance-service/` / `reports/` / `prisma/` ディレクトリ

**Step 1: package.json作成**

参考リポの `package.json` を参照し、FX版に必要な最小依存だけを入れる:

```json
{
  "name": "auto-fx-trader",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0", "npm": ">=10.0.0" },
  "scripts": {
    "backfill:prices": "tsx scripts/backfill-fx-prices.ts",
    "backtest:donchian": "tsx src/backtest/donchian-run.ts",
    "backtest:ma-crossover": "tsx src/backtest/ma-crossover-run.ts",
    "backtest:rsi-reversion": "tsx src/backtest/rsi-reversion-run.ts",
    "backtest:nr7": "tsx src/backtest/nr7-run.ts",
    "backtest:combined": "tsx src/backtest/combined-run.ts",
    "walk-forward:donchian": "tsx scripts/walk-forward-donchian.ts",
    "walk-forward:ma-crossover": "tsx scripts/walk-forward-ma-crossover.ts",
    "walk-forward:rsi-reversion": "tsx scripts/walk-forward-rsi-reversion.ts",
    "walk-forward:nr7": "tsx scripts/walk-forward-nr7.ts",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "dayjs": "^1.11.13",
    "technicalindicators": "^3.1.0",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "eslint": "^9.13.0",
    "prisma": "^5.22.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 2: tsconfig.json作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "scripts/**/*"]
}
```

**Step 3: .gitignore**

```
node_modules/
dist/
.env
.env.local
reports/backtests/*.json
!reports/backtests/.gitkeep
*.log
yfinance-service/__pycache__/
yfinance-service/.venv/
```

**Step 4: ディレクトリ作成**

```bash
mkdir -p src/{core,backtest,walk-forward,lib,data,reports,types} \
         scripts yfinance-service reports/{backtests,walk-forward} \
         prisma docs/specs
touch reports/backtests/.gitkeep reports/walk-forward/.gitkeep
```

**Step 5: npm install実行**

```bash
npm install
```

Expected: `node_modules/` が作成される、lockfile生成。

**Step 6: コミット**

```bash
git add package.json package-lock.json tsconfig.json .gitignore reports/ src/ scripts/ prisma/ yfinance-service/ docs/
git commit -m "chore: scaffold project skeleton"
```

---

### Task 2: Prisma + PostgreSQL セットアップ

**Files:**
- Create: `prisma/schema.prisma`
- Create: `.env.example`

**Step 1: .env.example作成**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_fx_trader?schema=public"
YFINANCE_SERVICE_URL="http://localhost:8765"
```

**Step 2: prisma/schema.prisma作成**

設計ドキュメント §11「データモデル（Prisma）」のスキーマをそのまま書き出す（Pair / DailyBar / BacktestRun / WalkForwardRun / Trade）。

**Step 3: ローカルDB起動（fishシェル）**

```fish
docker run --name auto-fx-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=auto_fx_trader -p 5432:5432 -d postgres:16
cp .env.example .env
```

**Step 4: マイグレーション**

```bash
npx prisma migrate dev --name init
```

Expected: `prisma/migrations/<timestamp>_init/` が生成され、`Pair` / `DailyBar` / `BacktestRun` / `WalkForwardRun` / `Trade` がDBに作成される。

**Step 5: コミット**

```bash
git add prisma/ .env.example
git commit -m "feat: add Prisma schema and initial migration"
```

---

### Task 3: Vitest + ESLint セットアップ

**Files:**
- Create: `vitest.config.ts`
- Create: `eslint.config.js`

**Step 1: vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/*.test.ts"],
    globals: true,
  },
});
```

**Step 2: eslint.config.js**

参考リポの `eslint.config.js` を流用。最小限でOK。

**Step 3: ダミーテストで動作確認**

Create `src/lib/__tests__/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

Run: `npm test`
Expected: 1 passed

**Step 4: コミット**

```bash
git add vitest.config.ts eslint.config.js src/lib/__tests__/smoke.test.ts
git commit -m "chore: set up Vitest and ESLint"
```

---

### Task 4: yfinance-service (Python) セットアップ

**Files:**
- Create: `yfinance-service/main.py`
- Create: `yfinance-service/requirements.txt`
- Create: `yfinance-service/README.md`

**Step 1: requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
yfinance==0.2.48
pandas==2.2.3
```

**Step 2: main.py（FastAPI + yfinance）**

```python
from fastapi import FastAPI, HTTPException
from datetime import date
import yfinance as yf

app = FastAPI()

@app.get("/fx/daily")
def fx_daily(ticker: str, start: str, end: str):
    """
    ticker: yfinance FX ticker, e.g. 'USDJPY=X', 'EURUSD=X', 'GBPUSD=X'
    start, end: 'YYYY-MM-DD'
    """
    try:
        df = yf.download(ticker, start=start, end=end, interval="1d", progress=False, auto_adjust=False)
    except Exception as e:
        raise HTTPException(500, str(e))
    if df.empty:
        return {"ticker": ticker, "bars": []}
    df = df.reset_index()
    bars = [
        {
            "date": r["Date"].strftime("%Y-%m-%d"),
            "open": float(r["Open"]),
            "high": float(r["High"]),
            "low": float(r["Low"]),
            "close": float(r["Close"]),
            "volume": float(r["Volume"]) if r["Volume"] else None,
        }
        for _, r in df.iterrows()
    ]
    return {"ticker": ticker, "bars": bars}
```

**Step 3: 起動確認**

```fish
cd yfinance-service
python -m venv .venv
source .venv/bin/activate.fish
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765
```

別ターミナルで:

```bash
curl 'http://localhost:8765/fx/daily?ticker=USDJPY=X&start=2024-01-01&end=2024-02-01'
```

Expected: `{"ticker":"USDJPY=X","bars":[{"date":"2024-01-02",...}]}`

**Step 4: コミット**

```bash
git add yfinance-service/
git commit -m "feat: add yfinance-service for FX daily bars"
```

---

## Phase 2: 型定義と共通ライブラリ

### Task 5: 型定義

**Files:**
- Create: `src/types/bar.ts` / `trade.ts` / `signal.ts` / `strategy.ts` / `pair.ts`

**Step 1: src/types/bar.ts**

```typescript
export interface DailyBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}
```

**Step 2: src/types/pair.ts**

```typescript
export type PairSymbol = "USDJPY" | "EURUSD" | "GBPUSD";
```

**Step 3: src/types/signal.ts**

```typescript
import type { PairSymbol } from "./pair.js";
export interface EntrySignal {
  date: Date;
  pair: PairSymbol;
  side: "long" | "short";
  entryPrice: number;
  atr: number;
}
```

**Step 4: src/types/trade.ts**

```typescript
import type { PairSymbol } from "./pair.js";
export type ExitReason = "sl" | "trailing" | "time" | "signal" | "end_of_data";
export interface BacktestTrade {
  pair: PairSymbol;
  strategy: string;
  side: "long" | "short";
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: ExitReason;
  sizeUnits: number;
  pnlPips: number;
  pnlJpy: number;
  holdingDays: number;
}
```

**Step 5: src/types/strategy.ts**

```typescript
import type { DailyBar } from "./bar.js";
import type { EntrySignal } from "./signal.js";
import type { PairSymbol } from "./pair.js";

export interface ExitConfig {
  useTrailing: boolean;
  timeStopDays: number;
  timeStopMaxDays: number;
  slAtrMultiplier: number;
  beAtrMultiplier: number;
  trailAtrMultiplier: number;
}

export interface Strategy<P = Record<string, unknown>> {
  name: string;
  defaultParams: P;
  exitConfig: ExitConfig;
  generateSignals(bars: DailyBar[], pair: PairSymbol, params: P): EntrySignal[];
}
```

**Step 6: コミット**

```bash
git add src/types/
git commit -m "feat: add core type definitions"
```

---

### Task 6: メトリクス計算（TDD）

**Files:**
- Create: `src/lib/metrics.ts`
- Test: `src/lib/__tests__/metrics.test.ts`

**Step 1: テストを先に書く**

`src/lib/__tests__/metrics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  sharpeRatio, maxDrawdown, profitFactor, expectancy, marRatio,
} from "../metrics.js";

describe("sharpeRatio", () => {
  it("returns 0 for empty returns", () => {
    expect(sharpeRatio([])).toBe(0);
  });
  it("handles positive returns with variance", () => {
    const result = sharpeRatio([0.01, 0.02, -0.01, 0.015, 0.005]);
    expect(result).toBeGreaterThan(0);
  });
  it("annualizes with 252 by default", () => {
    // constant 0.001 daily return, std=0 → guard: return 0
    expect(sharpeRatio([0.001, 0.001, 0.001])).toBe(0);
  });
});

describe("maxDrawdown", () => {
  it("returns 0 for monotonically increasing equity", () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });
  it("returns correct DD for U-shape", () => {
    expect(maxDrawdown([100, 80, 120])).toBeCloseTo(0.2, 5);
  });
});

describe("profitFactor", () => {
  it("returns Infinity when no losses", () => {
    expect(profitFactor([10, 20, 30])).toBe(Infinity);
  });
  it("returns gross_win / gross_loss", () => {
    expect(profitFactor([10, -5, 20, -10])).toBeCloseTo(30 / 15, 5);
  });
});

describe("expectancy", () => {
  it("returns average PnL per trade", () => {
    expect(expectancy([10, -5, 20, -10])).toBeCloseTo(15 / 4, 5);
  });
});

describe("marRatio", () => {
  it("returns annual_return / max_dd", () => {
    expect(marRatio(0.15, 0.1)).toBeCloseTo(1.5, 5);
  });
  it("returns 0 when dd is 0", () => {
    expect(marRatio(0.15, 0)).toBe(0);
  });
});
```

**Step 2: テストが失敗するか確認**

Run: `npm test -- src/lib/__tests__/metrics.test.ts`
Expected: ファイル/関数未実装で全FAIL

**Step 3: 最小実装**

`src/lib/metrics.ts`:

```typescript
const TRADING_DAYS = 252;

export function sharpeRatio(returns: number[], tradingDays = TRADING_DAYS): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(tradingDays);
}

export function maxDrawdown(equityCurve: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function profitFactor(pnls: number[]): number {
  const gains = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = pnls.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function expectancy(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.reduce((a, b) => a + b, 0) / pnls.length;
}

export function marRatio(annualReturn: number, maxDd: number): number {
  if (maxDd === 0) return 0;
  return annualReturn / maxDd;
}

export function annualReturn(totalReturn: number, years: number): number {
  if (years <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

export function winRate(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.filter((p) => p > 0).length / pnls.length;
}
```

**Step 4: テスト確認**

Run: `npm test -- src/lib/__tests__/metrics.test.ts`
Expected: all PASS

**Step 5: コミット**

```bash
git add src/lib/metrics.ts src/lib/__tests__/metrics.test.ts
git commit -m "feat: add risk metrics (Sharpe, MAR, PF, DD, expectancy)"
```

---

### Task 7: 技術指標ラッパ（TDD）

**Files:**
- Create: `src/lib/indicators/atr.ts` / `ema.ts` / `rsi.ts` / `donchian.ts`
- Test: 各々の `__tests__` ファイル

**Step 1: ATR テスト + 実装**

`src/lib/indicators/__tests__/atr.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeATR } from "../atr.js";

describe("computeATR", () => {
  it("returns N-1 undefined then ATR values for period N", () => {
    const bars = [
      { high: 10, low: 9, close: 9.5 },
      { high: 11, low: 10, close: 10.5 },
      { high: 12, low: 11, close: 11.5 },
      { high: 13, low: 11, close: 12 },
    ];
    const result = computeATR(bars as any, 3);
    expect(result.length).toBe(4);
    expect(result.slice(0, 2).every((v) => v === null)).toBe(true);
    expect(typeof result[2]).toBe("number");
  });
});
```

`src/lib/indicators/atr.ts`:

```typescript
import { ATR } from "technicalindicators";
import type { DailyBar } from "../../types/bar.js";

export function computeATR(bars: DailyBar[], period = 14): (number | null)[] {
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const values = ATR.calculate({ period, high, low, close });
  // ATR calculation uses first `period` bars for initialization
  const pad = bars.length - values.length;
  return [...Array(pad).fill(null), ...values];
}
```

**Step 2: EMA / RSI / Donchian も同様にTDD**

- `ema.ts`: `technicalindicators.EMA` ラッパ、同じパディング方式
- `rsi.ts`: `technicalindicators.RSI` ラッパ
- `donchian.ts`: `period日間の最高値/最安値` を返す（自前実装）

```typescript
// src/lib/indicators/donchian.ts
import type { DailyBar } from "../../types/bar.js";

export function donchianChannel(bars: DailyBar[], period: number) {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > h) h = bars[j].high;
      if (bars[j].low < l) l = bars[j].low;
    }
    upper.push(h);
    lower.push(l);
  }
  return { upper, lower };
}
```

各関数にテスト作成 → 実装 → テストPASS確認。

**Step 3: コミット**

```bash
git add src/lib/indicators/
git commit -m "feat: add ATR/EMA/RSI/Donchian indicator wrappers"
```

---

### Task 8: pair-config.ts

**Files:**
- Create: `src/data/pair-config.ts`
- Test: `src/data/__tests__/pair-config.test.ts`

**Step 1: テスト**

```typescript
import { describe, it, expect } from "vitest";
import { getPairConfig, PAIRS } from "../pair-config.js";

describe("pair-config", () => {
  it("returns all 3 pairs", () => {
    expect(PAIRS).toEqual(["USDJPY", "EURUSD", "GBPUSD"]);
  });
  it("returns config for USDJPY with spread and swap", () => {
    const cfg = getPairConfig("USDJPY");
    expect(cfg.spreadPips).toBe(0.3);
    expect(cfg.yfinanceTicker).toBe("USDJPY=X");
    expect(cfg.buySwapJpy).toBeGreaterThan(0);
  });
});
```

**Step 2: 実装**

```typescript
import type { PairSymbol } from "../types/pair.js";

export const PAIRS: PairSymbol[] = ["USDJPY", "EURUSD", "GBPUSD"];

export interface PairConfig {
  symbol: PairSymbol;
  yfinanceTicker: string;
  spreadPips: number;
  buySwapJpy: number;    // 円/1万通貨/日
  sellSwapJpy: number;
  pipDecimals: number;   // USDJPY=2 (0.01=1pip), EURUSD=4 (0.0001=1pip)
}

const CONFIGS: Record<PairSymbol, PairConfig> = {
  USDJPY: { symbol: "USDJPY", yfinanceTicker: "USDJPY=X", spreadPips: 0.3, buySwapJpy: 100, sellSwapJpy: -130, pipDecimals: 2 },
  EURUSD: { symbol: "EURUSD", yfinanceTicker: "EURUSD=X", spreadPips: 0.3, buySwapJpy: -50, sellSwapJpy: 30, pipDecimals: 4 },
  GBPUSD: { symbol: "GBPUSD", yfinanceTicker: "GBPUSD=X", spreadPips: 0.8, buySwapJpy: -30, sellSwapJpy: 10, pipDecimals: 4 },
};

export function getPairConfig(pair: PairSymbol): PairConfig {
  return CONFIGS[pair];
}
```

**Step 3: テスト確認 + コミット**

```bash
npm test -- src/data/__tests__/pair-config.test.ts
git add src/data/
git commit -m "feat: add pair configuration with spread and swap"
```

---

### Task 9: pip-value.ts（TDD）

**Files:**
- Create: `src/lib/pip-value.ts`
- Test: `src/lib/__tests__/pip-value.test.ts`

**Step 1: 要件**

- USDJPY: 1pip = 0.01, 1万通貨あたり = 100円（直接換算）
- EURUSD: 1pip = 0.0001, 1万通貨あたり = USD 1 = 現在のUSDJPY円換算
- GBPUSD: 同上

**Step 2: テスト**

```typescript
import { describe, it, expect } from "vitest";
import { pipsToJpy, jpyToUnits } from "../pip-value.js";

describe("pipsToJpy", () => {
  it("USDJPY: 1 pip × 10000 units = 100 JPY", () => {
    expect(pipsToJpy("USDJPY", 1, 10000, 150)).toBe(100);
  });
  it("EURUSD: 1 pip × 10000 units × USDJPY=150 = 150 JPY", () => {
    expect(pipsToJpy("EURUSD", 1, 10000, 150)).toBeCloseTo(150, 5);
  });
});

describe("jpyToUnits", () => {
  it("USDJPY: 20000 JPY risk over 50 pips = 4000 units", () => {
    expect(jpyToUnits("USDJPY", 20000, 50, 150)).toBeCloseTo(4000, 0);
  });
});
```

**Step 3: 実装**

```typescript
import type { PairSymbol } from "../types/pair.js";

export function pipsToJpy(pair: PairSymbol, pips: number, units: number, usdJpyRate: number): number {
  if (pair === "USDJPY") {
    // 1 pip = 0.01 JPY per 1 unit
    return pips * 0.01 * units;
  }
  // EURUSD / GBPUSD: 1 pip = 0.0001 USD per 1 unit → convert to JPY
  return pips * 0.0001 * units * usdJpyRate;
}

export function jpyToUnits(
  pair: PairSymbol,
  riskJpy: number,
  slPips: number,
  usdJpyRate: number,
): number {
  if (slPips <= 0) return 0;
  const perUnitLossJpy = pipsToJpy(pair, slPips, 1, usdJpyRate);
  if (perUnitLossJpy <= 0) return 0;
  return riskJpy / perUnitLossJpy;
}
```

**Step 4: テスト確認 + コミット**

```bash
npm test -- src/lib/__tests__/pip-value.test.ts
git add src/lib/pip-value.ts src/lib/__tests__/pip-value.test.ts
git commit -m "feat: add pip-value JPY conversion helpers"
```

---

### Task 10: correlation.ts

**Files:**
- Create: `src/lib/correlation.ts`
- Test: `src/lib/__tests__/correlation.test.ts`

**Step 1: 要件**

- EUR/USD vs GBP/USD は相関0.8（同方向同時保有で実効ポジション加算）
- その他のペアは独立（相関 < 0.5）
- 関数 `isHighCorrelation(pairA, sideA, pairB, sideB)` で判定

**Step 2: テスト**

```typescript
import { describe, it, expect } from "vitest";
import { isHighCorrelation } from "../correlation.js";

describe("isHighCorrelation", () => {
  it("EURUSD long + GBPUSD long → true", () => {
    expect(isHighCorrelation("EURUSD", "long", "GBPUSD", "long")).toBe(true);
  });
  it("EURUSD long + GBPUSD short → false", () => {
    expect(isHighCorrelation("EURUSD", "long", "GBPUSD", "short")).toBe(false);
  });
  it("USDJPY + EURUSD → false (independent)", () => {
    expect(isHighCorrelation("USDJPY", "long", "EURUSD", "long")).toBe(false);
  });
});
```

**Step 3: 実装**

```typescript
import type { PairSymbol } from "../types/pair.js";

type Side = "long" | "short";

const HIGH_CORR_PAIRS: Array<[PairSymbol, PairSymbol]> = [["EURUSD", "GBPUSD"]];

export function isHighCorrelation(a: PairSymbol, sideA: Side, b: PairSymbol, sideB: Side): boolean {
  if (sideA !== sideB) return false;
  return HIGH_CORR_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}
```

**Step 4: コミット**

```bash
git add src/lib/correlation.ts src/lib/__tests__/correlation.test.ts
git commit -m "feat: add pair correlation helper"
```

---

## Phase 3: データ層

### Task 11: yfinance-service と連携する price-loader

**Files:**
- Create: `src/data/price-loader.ts`
- Test: `src/data/__tests__/price-loader.test.ts`（モックHTTP）

**Step 1: テスト（fetchをモック）**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFxDaily } from "../price-loader.js";

afterEach(() => vi.restoreAllMocks());

describe("fetchFxDaily", () => {
  it("parses yfinance-service response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticker: "USDJPY=X",
        bars: [{ date: "2024-01-02", open: 141.5, high: 142, low: 141, close: 141.8, volume: 0 }],
      }),
    }) as any;
    const bars = await fetchFxDaily("USDJPY", "2024-01-01", "2024-02-01");
    expect(bars.length).toBe(1);
    expect(bars[0].close).toBe(141.8);
    expect(bars[0].date).toBeInstanceOf(Date);
  });
});
```

**Step 2: 実装**

```typescript
import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import { getPairConfig } from "./pair-config.js";

const SERVICE_URL = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8765";

export async function fetchFxDaily(
  pair: PairSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const { yfinanceTicker } = getPairConfig(pair);
  const url = `${SERVICE_URL}/fx/daily?ticker=${encodeURIComponent(yfinanceTicker)}&start=${startIso}&end=${endIso}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`yfinance-service error: ${res.status}`);
  const body = await res.json();
  return body.bars.map((b: any) => ({
    date: new Date(b.date + "T00:00:00Z"),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}
```

**Step 3: コミット**

```bash
git add src/data/price-loader.ts src/data/__tests__/price-loader.test.ts
git commit -m "feat: add price-loader for yfinance-service"
```

---

### Task 12: backfill-fx-prices スクリプト

**Files:**
- Create: `scripts/backfill-fx-prices.ts`

**Step 1: 実装**

```typescript
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { PAIRS, getPairConfig } from "../src/data/pair-config.js";
import { fetchFxDaily } from "../src/data/price-loader.js";

const prisma = new PrismaClient();

async function upsertPair(symbol: (typeof PAIRS)[number]) {
  const cfg = getPairConfig(symbol);
  return prisma.pair.upsert({
    where: { symbol },
    create: {
      symbol,
      yfinanceTicker: cfg.yfinanceTicker,
      pipValueJpy: symbol === "USDJPY" ? 100 : 150,
      spreadPips: cfg.spreadPips,
      buySwapJpy: cfg.buySwapJpy,
      sellSwapJpy: cfg.sellSwapJpy,
    },
    update: {
      spreadPips: cfg.spreadPips,
      buySwapJpy: cfg.buySwapJpy,
      sellSwapJpy: cfg.sellSwapJpy,
    },
  });
}

async function main() {
  const end = dayjs();
  const start = end.subtract(10, "year");
  for (const symbol of PAIRS) {
    console.log(`Fetching ${symbol}...`);
    const pairRecord = await upsertPair(symbol);
    const bars = await fetchFxDaily(symbol, start.format("YYYY-MM-DD"), end.format("YYYY-MM-DD"));
    console.log(`  ${bars.length} bars`);
    // Batch insert
    await prisma.dailyBar.createMany({
      data: bars.map((b) => ({
        pairId: pairRecord.id,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      skipDuplicates: true,
    });
  }
  console.log("Done.");
}

main().finally(() => prisma.$disconnect());
```

**Step 2: 実行**

yfinance-serviceを起動した状態で:

```bash
npm run backfill:prices
```

Expected: 3ペア × 約2600日 = 約7800レコードがDBに保存される

**Step 3: 確認**

```bash
npx prisma studio
```

`DailyBar` テーブルに行があることを確認。

**Step 4: コミット**

```bash
git add scripts/backfill-fx-prices.ts
git commit -m "feat: add FX price backfill script"
```

---

## Phase 4: バックテストエンジン

### Task 13: position-sizer.ts（TDD）

**Files:**
- Create: `src/backtest/position-sizer.ts`
- Test: `src/backtest/__tests__/position-sizer.test.ts`

**Step 1: 要件**

- 入力: `equity`(JPY), `riskRatio`(0.01), `pair`, `slPips`, `usdJpyRate`
- 出力: 通貨ユニット数
- 連敗時縮小: `recentLosses`で呼び出し側がロットを半減する形にする（関数はシンプル保持）

**Step 2: テスト + 実装**

```typescript
// テスト
import { describe, it, expect } from "vitest";
import { calcPositionUnits } from "../position-sizer.js";

describe("calcPositionUnits", () => {
  it("1M JPY * 1% / (50 pips * 100 JPY/万通貨) = 2000 units", () => {
    // USDJPY: 1 unit * 50 pips = 0.5 JPY loss → 10000 JPY risk / 0.5 = 20000 units
    // 1,000,000 * 0.01 = 10,000 JPY, pipsToJpy(USDJPY, 50, 1, 150) = 0.5
    expect(calcPositionUnits({ equity: 1_000_000, riskRatio: 0.01, pair: "USDJPY", slPips: 50, usdJpyRate: 150 })).toBe(20000);
  });
});
```

```typescript
// 実装
import type { PairSymbol } from "../types/pair.js";
import { jpyToUnits } from "../lib/pip-value.js";

export function calcPositionUnits(args: {
  equity: number;
  riskRatio: number;
  pair: PairSymbol;
  slPips: number;
  usdJpyRate: number;
}): number {
  const riskJpy = args.equity * args.riskRatio;
  return Math.floor(jpyToUnits(args.pair, riskJpy, args.slPips, args.usdJpyRate));
}
```

**Step 3: コミット**

```bash
git add src/backtest/position-sizer.ts src/backtest/__tests__/position-sizer.test.ts
git commit -m "feat: add position sizer with fixed-risk model"
```

---

### Task 14: cost-model.ts（TDD）

**Files:**
- Create: `src/backtest/cost-model.ts`
- Test: `src/backtest/__tests__/cost-model.test.ts`

**Step 1: 要件**

- `applySpread(pair, side, rawPrice)`: エントリー価格にスプレッド不利を反映（買いなら +spread/2、売りなら -spread/2、簡易モデルとしてbid/askスプレッド全額を買い側に不利適用でもOK）
- `calcSwapJpy(pair, side, units, holdingDays)`: 累計スワップ

**Step 2: 実装**

```typescript
import type { PairSymbol } from "../types/pair.js";
import { getPairConfig } from "../data/pair-config.js";

function pipSize(pair: PairSymbol): number {
  return pair === "USDJPY" ? 0.01 : 0.0001;
}

export function applySpread(pair: PairSymbol, side: "long" | "short", rawPrice: number): number {
  const { spreadPips } = getPairConfig(pair);
  const spreadPrice = spreadPips * pipSize(pair);
  return side === "long" ? rawPrice + spreadPrice : rawPrice - spreadPrice;
}

export function calcSwapJpy(pair: PairSymbol, side: "long" | "short", units: number, holdingDays: number): number {
  const { buySwapJpy, sellSwapJpy } = getPairConfig(pair);
  const swapPerDay = side === "long" ? buySwapJpy : sellSwapJpy;
  return (swapPerDay * units * holdingDays) / 10000;
}
```

**Step 3: テスト + コミット**

```bash
npm test
git add src/backtest/cost-model.ts src/backtest/__tests__/cost-model.test.ts
git commit -m "feat: add spread and swap cost model"
```

---

### Task 15: exit-manager.ts（TDD）

**Files:**
- Create: `src/backtest/exit-manager.ts`
- Test: `src/backtest/__tests__/exit-manager.test.ts`

**Step 1: 要件**

状態機械として実装:

```typescript
export interface PositionState {
  side: "long" | "short";
  entryDate: Date;
  entryPrice: number;
  entryAtr: number;
  units: number;
  currentSl: number;
  highSinceEntry: number; // long用、毎日更新
  lowSinceEntry: number;
  hasBreakEven: boolean;
  pair: PairSymbol;
}

export interface ExitResult {
  exited: boolean;
  exitPrice?: number;
  exitReason?: "sl" | "trailing" | "time" | "end_of_data";
}

export function evaluateExit(
  state: PositionState,
  bar: DailyBar,
  daysHeld: number,
  cfg: ExitConfig,
): { newState: PositionState; exit: ExitResult };
```

ロジック:
1. 当日の高値/安値を更新（新しいHH/LLなら記録）
2. BE発動判定（利益がATR×beAtrMultiplier超えたらSLを建値に）
3. トレーリングSL更新（useTrailing時、新しいHH/LLからATR×trailAtrMultiplier下/上）
4. SLタッチ判定（当日のlow/highがSLに触れた場合、SL価格でエグジット）
5. タイムストップ判定（daysHeld >= timeStopDays → 引け価格でエグジット）

**Step 2: 複数ケースをテスト（ロング）**

```typescript
describe("evaluateExit (long)", () => {
  const base: PositionState = {
    side: "long",
    entryDate: new Date("2024-01-01"),
    entryPrice: 150.0,
    entryAtr: 0.5,
    units: 10000,
    currentSl: 149.5,
    highSinceEntry: 150.0,
    lowSinceEntry: 150.0,
    hasBreakEven: false,
    pair: "USDJPY",
  };
  const cfg: ExitConfig = {
    useTrailing: true,
    timeStopDays: 10,
    timeStopMaxDays: 20,
    slAtrMultiplier: 1.0,
    beAtrMultiplier: 0.5,
    trailAtrMultiplier: 1.0,
  };

  it("hits SL when low touches currentSl", () => {
    const bar = { date: new Date(), open: 149.8, high: 150, low: 149.4, close: 149.7, volume: 0 };
    const { exit } = evaluateExit(base, bar, 1, cfg);
    expect(exit.exited).toBe(true);
    expect(exit.exitReason).toBe("sl");
    expect(exit.exitPrice).toBe(149.5);
  });

  it("raises SL to BE when profit exceeds BE threshold", () => {
    const bar = { date: new Date(), open: 150.1, high: 150.4, low: 150, close: 150.35, volume: 0 };
    const { newState, exit } = evaluateExit(base, bar, 1, cfg);
    expect(exit.exited).toBe(false);
    expect(newState.hasBreakEven).toBe(true);
    expect(newState.currentSl).toBe(150.0);
  });

  it("trailing SL advances with new highs", () => {
    const afterBE = { ...base, currentSl: 150.0, hasBreakEven: true, highSinceEntry: 150.4 };
    const bar = { date: new Date(), open: 150.4, high: 151.2, low: 150.4, close: 151, volume: 0 };
    const { newState } = evaluateExit(afterBE, bar, 2, cfg);
    // New high = 151.2, trail = 1.0 * ATR(0.5) = 0.5 → SL = 150.7
    expect(newState.currentSl).toBeCloseTo(150.7, 5);
  });

  it("time-stops at close after timeStopDays", () => {
    const bar = { date: new Date(), open: 150.1, high: 150.2, low: 150, close: 150.1, volume: 0 };
    const { exit } = evaluateExit(base, bar, 10, cfg);
    expect(exit.exited).toBe(true);
    expect(exit.exitReason).toBe("time");
    expect(exit.exitPrice).toBe(150.1);
  });
});
```

**Step 3: 実装**

状態機械を忠実に実装。SL判定 → BE → トレイル → タイムストップの順で処理。

**Step 4: ショートも同等のテスト + 実装**

**Step 5: コミット**

```bash
git add src/backtest/exit-manager.ts src/backtest/__tests__/exit-manager.test.ts
git commit -m "feat: add exit manager with SL/BE/trailing/time-stop"
```

---

### Task 16: engine.ts (共通バックテストエンジン)

**Files:**
- Create: `src/backtest/engine.ts`
- Test: `src/backtest/__tests__/engine.test.ts`

**Step 1: インターフェース**

```typescript
export interface BacktestInput {
  bars: DailyBar[];
  pair: PairSymbol;
  strategy: Strategy<any>;
  params: Record<string, unknown>;
  initialCapital: number;
  riskRatio: number; // 0.01
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: { date: Date; equity: number }[];
  // KPIs
  totalReturn: number;
  sharpe: number;
  mar: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  tradeCount: number;
}
```

**Step 2: 処理フロー**

1. 戦略から`generateSignals`で全期間のシグナル取得
2. 日足を順次処理:
   - 保有中ならexit-managerで評価、エグジットなら確定
   - 新規シグナルがあり枠空きならエントリー（スプレッド適用、サイジング計算）
   - 毎日スワップを累計
3. エクイティカーブを記録
4. 全バー走査後、保有中ならend_of_dataエグジット
5. KPI計算

**Step 3: テスト（合成データ + ダミー戦略）**

既知の結果になる合成バーで1トレードのPnLを検証:

```typescript
describe("engine", () => {
  it("completes single trade with expected PnL", () => {
    // 150→160への単純上昇、Donchianでロング→利益確定
    // (detailed test setup)
  });
});
```

**Step 4: 実装**

```typescript
// pseudocode
export function runBacktest(input: BacktestInput): BacktestResult {
  const signals = input.strategy.generateSignals(input.bars, input.pair, input.params);
  let equity = input.initialCapital;
  let openPosition: PositionState | null = null;
  let openTrade: Partial<BacktestTrade> | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: Date; equity: number }[] = [];

  for (let i = 0; i < input.bars.length; i++) {
    const bar = input.bars[i];

    // 1. 保有中ならExit評価
    if (openPosition && openTrade) {
      const daysHeld = /* count */;
      const { newState, exit } = evaluateExit(openPosition, bar, daysHeld, input.strategy.exitConfig);
      openPosition = newState;
      if (exit.exited) {
        // 確定処理（スワップ含むPnL計算、tradesにpush）
        openPosition = null;
        openTrade = null;
      }
    }

    // 2. 新規エントリー（枠空き時）
    if (!openPosition) {
      const sig = signals.find((s) => s.date.getTime() === bar.date.getTime());
      if (sig) {
        const slPips = input.strategy.exitConfig.slAtrMultiplier * sig.atr / pipSize(input.pair);
        const units = calcPositionUnits({ ... });
        const entryPrice = applySpread(input.pair, sig.side, bar.close);
        openPosition = { ... };
        openTrade = { entryDate: bar.date, entryPrice, side: sig.side, sizeUnits: units };
      }
    }

    equityCurve.push({ date: bar.date, equity });
  }

  // 3. 未決済を end_of_data で決済
  // 4. KPI計算
  return { ... };
}
```

**Step 4: コミット**

```bash
git add src/backtest/engine.ts src/backtest/__tests__/engine.test.ts
git commit -m "feat: add common backtest engine"
```

---

### Task 17: markdown-writer.ts + kpi-formatter.ts

**Files:**
- Create: `src/reports/markdown-writer.ts` / `kpi-formatter.ts`
- Test: `src/reports/__tests__/markdown-writer.test.ts`

**Step 1: 要件**

- 入力: `BacktestResult` + メタ情報（戦略名、ペア、期間、パラメータ）
- 出力: `reports/backtests/<strategy>-<pair>-<timestamp>.md` に保存、パスを返す

**Step 2: 実装**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import type { BacktestResult } from "../backtest/engine.js";
import type { PairSymbol } from "../types/pair.js";

export async function writeBacktestReport(args: {
  strategy: string;
  pair: PairSymbol | "combined";
  result: BacktestResult;
  startDate: Date;
  endDate: Date;
  params: Record<string, unknown>;
  outputDir?: string;
}): Promise<string> {
  const outDir = args.outputDir ?? "reports/backtests";
  await fs.mkdir(outDir, { recursive: true });
  const filename = `${args.strategy}-${args.pair}-${dayjs().format("YYYYMMDD-HHmmss")}.md`;
  const fullpath = path.join(outDir, filename);

  const md = buildMarkdown(args);
  await fs.writeFile(fullpath, md);
  return fullpath;
}

function buildMarkdown(args: any): string {
  const { result } = args;
  return [
    `# Backtest Report: ${args.strategy} / ${args.pair}`,
    ``,
    `**Period:** ${dayjs(args.startDate).format("YYYY-MM-DD")} – ${dayjs(args.endDate).format("YYYY-MM-DD")}`,
    ``,
    `## KPIs`,
    `| Metric | Value |`,
    `|---|---|`,
    `| Sharpe | ${result.sharpe.toFixed(3)} |`,
    `| MAR | ${result.mar.toFixed(3)} |`,
    `| Profit Factor | ${result.profitFactor.toFixed(3)} |`,
    `| Max Drawdown | ${(result.maxDrawdown * 100).toFixed(2)}% |`,
    `| Total Return | ${(result.totalReturn * 100).toFixed(2)}% |`,
    `| Win Rate | ${(result.winRate * 100).toFixed(2)}% |`,
    `| Trades | ${result.tradeCount} |`,
    `| Expectancy | ${result.expectancy.toFixed(2)} |`,
    ``,
    `## Parameters`,
    `\`\`\`json`,
    JSON.stringify(args.params, null, 2),
    `\`\`\``,
  ].join("\n");
}
```

**Step 3: コミット**

```bash
git add src/reports/
git commit -m "feat: add Markdown backtest report writer"
```

---

## Phase 5: 戦略実装

### Task 18: Donchian Breakout 戦略（TDD）

**Files:**
- Create: `src/core/donchian/index.ts` / `params.ts`
- Test: `src/core/donchian/__tests__/index.test.ts`

**Step 1: params.ts**

```typescript
export interface DonchianParams {
  entryPeriod: number;   // 20
  exitPeriod: number;    // 55（未使用、タイムストップで代替可）
  atrPeriod: number;     // 14
}
export const donchianDefaults: DonchianParams = {
  entryPeriod: 20,
  exitPeriod: 55,
  atrPeriod: 14,
};
```

**Step 2: TDDテスト**

既知の上昇トレンドデータで買いシグナルが出ること、下降トレンドで売りシグナルが出ることを確認。

```typescript
describe("donchian strategy", () => {
  it("generates long signal when price breaks N-day high", () => {
    // 20日間上昇トレンド → 21日目にbreak
    const bars = /* ... */;
    const signals = donchianStrategy.generateSignals(bars, "USDJPY", donchianDefaults);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].side).toBe("long");
  });
});
```

**Step 3: 実装**

```typescript
import { donchianChannel } from "../../lib/indicators/donchian.js";
import { computeATR } from "../../lib/indicators/atr.js";
import type { Strategy } from "../../types/strategy.js";
import { donchianDefaults, type DonchianParams } from "./params.js";

export const donchianStrategy: Strategy<DonchianParams> = {
  name: "donchian",
  defaultParams: donchianDefaults,
  exitConfig: {
    useTrailing: true,
    timeStopDays: 10,
    timeStopMaxDays: 20,
    slAtrMultiplier: 1.0,
    beAtrMultiplier: 0.5,
    trailAtrMultiplier: 1.0,
  },
  generateSignals(bars, pair, params) {
    const { upper, lower } = donchianChannel(bars, params.entryPeriod);
    const atr = computeATR(bars, params.atrPeriod);
    const signals = [];
    for (let i = 1; i < bars.length; i++) {
      if (upper[i - 1] == null || atr[i] == null) continue;
      // Long: close breaks above prior upper
      if (bars[i].close > upper[i - 1]!) {
        signals.push({ date: bars[i].date, pair, side: "long", entryPrice: bars[i].close, atr: atr[i]! });
      } else if (bars[i].close < lower[i - 1]!) {
        signals.push({ date: bars[i].date, pair, side: "short", entryPrice: bars[i].close, atr: atr[i]! });
      }
    }
    return signals;
  },
};
```

**Step 4: テスト確認 + コミット**

```bash
npm test -- src/core/donchian
git add src/core/donchian/
git commit -m "feat: add Donchian breakout strategy"
```

---

### Task 19: MA Crossover 戦略

**Files:**
- Create: `src/core/ma-crossover/index.ts` / `params.ts`
- Test: `src/core/ma-crossover/__tests__/index.test.ts`

**Step 1: params**

```typescript
export interface MaCrossoverParams { shortEma: number; longEma: number; atrPeriod: number; }
export const maCrossoverDefaults: MaCrossoverParams = { shortEma: 20, longEma: 50, atrPeriod: 14 };
```

**Step 2: ロジック（TDD）**

- `short`が`long`を上抜け→ロングシグナル（クロス発生日）
- `short`が`long`を下抜け→ショート
- エグジット条件は exit-manager 任せ

**Step 3: 実装 + テスト + コミット**

```bash
git add src/core/ma-crossover/
git commit -m "feat: add MA Crossover strategy"
```

---

### Task 20: RSI Mean Reversion 戦略

**Files:**
- Create: `src/core/rsi-reversion/index.ts` / `params.ts`
- Test: 同__tests__

**Step 1: params**

```typescript
export interface RsiReversionParams { rsiPeriod: number; buyThreshold: number; sellThreshold: number; atrPeriod: number; }
export const rsiReversionDefaults: RsiReversionParams = { rsiPeriod: 14, buyThreshold: 30, sellThreshold: 70, atrPeriod: 14 };
```

**Step 2: ロジック**

- RSI < buyThreshold → 翌日ロング
- RSI > sellThreshold → 翌日ショート
- exitConfig: `useTrailing: false, timeStopDays: 5, slAtrMultiplier: 1.0`

**Step 3: 実装 + テスト + コミット**

```bash
git add src/core/rsi-reversion/
git commit -m "feat: add RSI mean reversion strategy"
```

---

### Task 21: NR7 Breakout 戦略

**Files:**
- Create: `src/core/nr7-breakout/index.ts` / `params.ts`
- Test: 同__tests__

**Step 1: params**

```typescript
export interface Nr7Params { lookback: number; atrPeriod: number; }
export const nr7Defaults: Nr7Params = { lookback: 7, atrPeriod: 14 };
```

**Step 2: ロジック**

- 当日レンジ(high-low)が直近7日で最小 = NR7日
- 翌日、NR7日のhighをブレイクでロング、lowをブレイクでショート
- exitConfig: Donchianと同等

**Step 3: 実装 + テスト + コミット**

```bash
git add src/core/nr7-breakout/
git commit -m "feat: add NR7 breakout strategy"
```

---

## Phase 6: 個別バックテストランナー

### Task 22: 共通ランナーヘルパ

**Files:**
- Create: `src/backtest/runner-helpers.ts`

**Step 1: 実装**

DB からバー取得 → `runBacktest` 呼び出し → `BacktestRun` と `Trade` を保存 → Markdownレポート出力 → コンソールにKPI表示、までを共通化:

```typescript
export async function runAndPersist(args: {
  strategy: Strategy<any>;
  pair: PairSymbol;
  params: Record<string, unknown>;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  riskRatio: number;
}): Promise<BacktestResult>;
```

**Step 2: コミット**

```bash
git add src/backtest/runner-helpers.ts
git commit -m "feat: add shared backtest runner helpers"
```

---

### Task 23: 4戦略のランナースクリプト

**Files:**
- Create: `src/backtest/donchian-run.ts`
- Create: `src/backtest/ma-crossover-run.ts`
- Create: `src/backtest/rsi-reversion-run.ts`
- Create: `src/backtest/nr7-run.ts`

**Step 1: donchian-run.ts**

```typescript
import { runAndPersist } from "./runner-helpers.js";
import { donchianStrategy } from "../core/donchian/index.js";
import { PAIRS } from "../data/pair-config.js";
import dayjs from "dayjs";

async function main() {
  const end = dayjs();
  const start = end.subtract(10, "year");
  for (const pair of PAIRS) {
    console.log(`\n=== Donchian / ${pair} ===`);
    await runAndPersist({
      strategy: donchianStrategy,
      pair,
      params: donchianStrategy.defaultParams,
      startDate: start.toDate(),
      endDate: end.toDate(),
      initialCapital: 1_000_000,
      riskRatio: 0.01,
    });
  }
}
main();
```

他3戦略も同パターン。

**Step 2: 実行確認**

```bash
npm run backtest:donchian
```

Expected: コンソールにKPI表示、`BacktestRun`テーブルに3行追加、`reports/backtests/` にMarkdownファイル。

**Step 3: コミット**

```bash
git add src/backtest/{donchian,ma-crossover,rsi-reversion,nr7}-run.ts
git commit -m "feat: add individual backtest runners for all strategies"
```

---

## Phase 7: Walk-Forward 検証

### Task 24: walk-forward/optimizer.ts

**Files:**
- Create: `src/walk-forward/optimizer.ts`
- Test: `src/walk-forward/__tests__/optimizer.test.ts`

**Step 1: 要件**

- パラメータグリッド探索
- IS窓での全組み合わせ評価 → 最大Sharpe比のパラメータ返却
- 並列処理は不要（MVPでは逐次でOK）

**Step 2: インターフェース**

```typescript
export interface OptimizerResult<P> { bestParams: P; bestSharpe: number; allResults: Array<{ params: P; sharpe: number }>; }
export function optimizeStrategy<P extends Record<string, number>>(args: {
  strategy: Strategy<P>;
  bars: DailyBar[];
  pair: PairSymbol;
  paramGrid: Record<keyof P, number[]>;
  initialCapital: number;
  riskRatio: number;
}): OptimizerResult<P>;
```

**Step 3: 実装（全組み合わせ展開 + runBacktest + Sharpe最大化）**

**Step 4: テスト + コミット**

```bash
git add src/walk-forward/optimizer.ts src/walk-forward/__tests__/optimizer.test.ts
git commit -m "feat: add grid-search optimizer"
```

---

### Task 25: walk-forward/engine.ts

**Files:**
- Create: `src/walk-forward/engine.ts`
- Test: `src/walk-forward/__tests__/engine.test.ts`

**Step 1: 要件**

- 全期間を 12ヶ月IS + 6ヶ月OOS の窓で順次処理（0.5年ステップ）
- 各窓: IS最適化 → OOSに適用 → KPI記録
- 全窓の集約結果を返す

**Step 2: インターフェース**

```typescript
export interface WfWindowResult<P> {
  isStart: Date; isEnd: Date; oosStart: Date; oosEnd: Date;
  bestParams: P;
  isSharpe: number; oosSharpe: number; oosMar: number; oosPf: number; oosMaxDd: number;
}
export interface WfAggregate<P> {
  windows: WfWindowResult<P>[];
  oosAvgSharpe: number; oosAvgMar: number; oosAvgPf: number; oosMaxDd: number;
  isOosSharpeDrop: number;
  passed: boolean;
}
export function runWalkForward<P extends Record<string, number>>(args: { ... }): WfAggregate<P>;
```

**Step 3: 実装（窓の生成→最適化→OOS評価→集約）**

**Step 4: テスト（合成データで窓数と集約が正しいか）**

**Step 5: コミット**

```bash
git add src/walk-forward/engine.ts src/walk-forward/__tests__/engine.test.ts
git commit -m "feat: add walk-forward engine"
```

---

### Task 26: robustness.ts

**Files:**
- Create: `src/walk-forward/robustness.ts`
- Test: `src/walk-forward/__tests__/robustness.test.ts`

**Step 1: 要件**

- `checkRobustness(aggregate)`: Sharpe≥1.0 & MAR≥0.5 & PF≥1.3 & DD≤0.20 & drop≤0.30 を判定
- `checkCrossPairRobustness(perPairAggregates)`: 3ペア中2ペア以上で合格しているか

**Step 2: 実装 + テスト + コミット**

```bash
git add src/walk-forward/robustness.ts src/walk-forward/__tests__/robustness.test.ts
git commit -m "feat: add robustness checker"
```

---

### Task 27: 4戦略のWFスクリプト

**Files:**
- Create: `scripts/walk-forward-donchian.ts`
- Create: `scripts/walk-forward-ma-crossover.ts`
- Create: `scripts/walk-forward-rsi-reversion.ts`
- Create: `scripts/walk-forward-nr7.ts`

**Step 1: scripts/walk-forward-donchian.ts**

```typescript
import { PrismaClient } from "@prisma/client";
import { runWalkForward } from "../src/walk-forward/engine.js";
import { donchianStrategy } from "../src/core/donchian/index.js";
import { PAIRS } from "../src/data/pair-config.js";
import { checkRobustness, checkCrossPairRobustness } from "../src/walk-forward/robustness.js";
// ... load bars from DB, run WF per pair, save WalkForwardRun

const paramGrid = {
  entryPeriod: [10, 20, 30, 55],
  exitPeriod: [10, 20, 55],
  atrPeriod: [14],
};

async function main() {
  const prisma = new PrismaClient();
  const perPair = {};
  for (const pair of PAIRS) {
    const bars = await loadBars(prisma, pair);
    const result = runWalkForward({
      strategy: donchianStrategy,
      bars, pair,
      paramGrid,
      isMonths: 12, oosMonths: 6, stepMonths: 0.5,
      initialCapital: 1_000_000, riskRatio: 0.01,
    });
    perPair[pair] = result;
    // persist WalkForwardRun
    // write Markdown report
  }
  const passed = checkCrossPairRobustness(perPair);
  console.log(`Cross-pair robustness: ${passed ? "PASS" : "FAIL"}`);
  await prisma.$disconnect();
}
main();
```

他3戦略も同様。パラメータグリッドは戦略別に調整。

**Step 2: コミット**

```bash
git add scripts/walk-forward-*.ts
git commit -m "feat: add walk-forward runner scripts for all 4 strategies"
```

---

## Phase 8: ポートフォリオ（combined）

### Task 28: portfolio-manager.ts

**Files:**
- Create: `src/backtest/portfolio-manager.ts`
- Test: `src/backtest/__tests__/portfolio-manager.test.ts`

**Step 1: 要件**

- 開いているポジション一覧を管理
- 新規シグナルに対し、ポジション上限・戦略別上限・ペア別上限・相関実効枠を判定
- 通過したシグナルだけ受け入れる

**Step 2: インターフェース**

```typescript
export class PortfolioManager {
  constructor(limits: { totalMax: number; perStrategyMax: number; perPairMax: number });
  canOpen(sig: EntrySignal, strategy: string, openPositions: OpenPosition[]): boolean;
}
```

相関実効枠: `EURUSD long + GBPUSD long` で1枠消費（片方拒否 or 両方受けてリスク加算は設計で選択、MVPは片方拒否）。

**Step 3: テスト + 実装 + コミット**

```bash
git add src/backtest/portfolio-manager.ts src/backtest/__tests__/portfolio-manager.test.ts
git commit -m "feat: add portfolio manager with correlation limits"
```

---

### Task 29: combined-run.ts

**Files:**
- Create: `src/backtest/combined-run.ts`

**Step 1: 要件**

- 全戦略・全ペアのシグナルを合流
- `PortfolioManager` で制約下に採用シグナルを選別
- 共通engineを拡張した`runCombinedBacktest`で実行
- 結果をBacktestRun(`strategy: "combined", pairSymbol: null`)に保存

**Step 2: 実装の要点**

- 日付インデックスでシグナルを集める
- 各日:
  1. Exit評価（全保有ポジション）
  2. 新規シグナル候補を列挙 → PortfolioManagerでフィルタ → 採用分だけエントリー

**Step 3: 実行**

```bash
npm run backtest:combined
```

Expected: 総合 Sharpe/MAR/DD が表示され、レポート出力。

**Step 4: コミット**

```bash
git add src/backtest/combined-run.ts
git commit -m "feat: add combined portfolio backtest runner"
```

---

## Phase 9: 実データ検証と最終レポート

### Task 30: 個別バックテスト一斉実行

**Step 1: 価格データ取得**

yfinance-service起動 + `npm run backfill:prices` 完了を確認。

**Step 2: 4戦略を順次実行**

```bash
npm run backtest:donchian
npm run backtest:ma-crossover
npm run backtest:rsi-reversion
npm run backtest:nr7
```

**Step 3: 結果確認**

`reports/backtests/` に12ファイル（4戦略×3ペア）生成されていること。期待値>0 & PF≥1.3 を満たす戦略×ペア組合せを記録。

**Step 4: コミット（レポートは gitignore 対象だが、1次サマリーは手書きドキュメント化）**

```bash
git add docs/
git commit -m "docs: initial individual backtest results summary"
```

---

### Task 31: Walk-Forward一斉実行

**Step 1: 実行**

```bash
npm run walk-forward:donchian
npm run walk-forward:ma-crossover
npm run walk-forward:rsi-reversion
npm run walk-forward:nr7
```

処理時間: 4戦略 × 3ペア × 18窓 × グリッド展開で、実行に数十分〜数時間かかる想定。

**Step 2: 結果集約**

各戦略の `WalkForwardRun` から合格/不合格を一覧化:

```sql
SELECT strategy, pairSymbol, oosAvgSharpe, oosAvgMar, isOosSharpeDrop, passed
FROM WalkForwardRun
ORDER BY createdAt DESC;
```

**Step 3: 「実用化候補」確定**

3ペア中2ペア以上で合格した戦略をリストアップ。`docs/specs/strategies-validated.md` にサマリー記述。

**Step 4: コミット**

```bash
git add docs/specs/strategies-validated.md
git commit -m "docs: walk-forward validation results"
```

---

### Task 32: combined 実行 + 最終判定

**Step 1: 実用化候補だけをcombined対象にしたフラグを設定**

各戦略に `enabled: boolean` を持たせ、WF合格判定に応じてオン/オフを設定。

**Step 2: combined実行**

```bash
npm run backtest:combined
```

**Step 3: 総合KPI確認**

Sharpe≥1.0 / MAR≥0.5 / DD≤20% を満たすか。

**Step 4: 最終レポート**

`docs/specs/final-portfolio.md` にこのMVPの最終結論を記述:
- 採用戦略
- 各ペアでの期待値
- combined での総合KPI
- 実運用時の想定（初期資金、年率リターン予測、最大DD想定）

**Step 5: コミット**

```bash
git add docs/specs/final-portfolio.md
git commit -m "docs: final portfolio validation report"
```

---

## Phase 10: ドキュメント仕上げ

### Task 33: README.md

**Files:**
- Create: `README.md`

**Step 1: 内容**

- プロダクト概要（コンセプト、主KPI）
- セットアップ手順（fishシェル前提、Docker Postgres起動、yfinance-service起動、backfill、backtest、WF、combined）
- 設計ドキュメントと実装プランへのリンク
- ディレクトリ構成
- ライセンス: Private

**Step 2: コミット**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 34: CLAUDE.md (プロジェクト固有ルール)

**Files:**
- Create: `CLAUDE.md`

**Step 1: 参考リポ踏襲**

- ロール: 「プロのFXトレーダーとして仕様を考えてください」
- プロダクトコンセプト（設計ドキュメントのサマリー）
- バックテスト運用ルール（WF実行タイミング、判定基準）
- 技術ルール（`.claude/rules/` と同等の最小セット）

**Step 2: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with FX-trader rules"
```

---

## 実装順序の推奨

Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 は順次実装。Phase 9 & 10 は実データ検証後に実施。

**重要なチェックポイント**:
- Phase 4 完了時点で engine が動く（ダミー戦略でもバックテストが通る）
- Phase 6 完了時点で1戦略の個別バックテストが通しで動く
- Phase 7 完了時点でWFが通しで動く
- Phase 8 完了時点でcombinedが動く
- Phase 9 で実データ検証 → 戦略の取捨選択

## テスト戦略

- **各ライブラリ関数**: TDDで必ずテストから書く（metrics, indicators, pip-value, correlation, cost-model, position-sizer, exit-manager）
- **エンジン**: 合成データで既知のPnLを検証する統合テスト
- **戦略**: 既知のパターンで正しいシグナルが出るかを確認する単体テスト
- **WF**: 窓数と集約ロジックの正しさを小さな合成データで確認
- **E2E的な検証**: 実データでの実行を Phase 9 で行う（テストには含めない）

## 将来拡張への配慮

MVPには含めないが、以下の構造だけ残す:
- `src/core/` の戦略追加が容易（Strategyインターフェース経由）
- `Pair` テーブルに新ペア追加可能
- `DailyBar` と並列に将来 `IntradayBar` を追加可能（枠だけ）
- `broker/` レイヤー未追加だが、命名空間は空けておく

# Auto FX Trader 設計ドキュメント

**作成日**: 2026-04-23
**ステータス**: 設計完了（実装未着手）
**参考**: `auto-stock-trader` リポジトリのコンセプトを踏襲

---

## 1. プロダクト概要

**Auto FX Trader** — ロバスト性 × 低相関ポートフォリオで勝つFX自動取引戦略の研究フレームワーク（リサーチ特化MVP）。

### コンセプト

> **「FXは過学習しやすい。複数ペアで頑健に機能するエッジだけを採用する」**

参考リポの「リスク調整後リターンで勝つ」思想を踏襲しつつ、FX固有の特性（24時間市場、ギャップほぼ無し、ランダムウォーク性が強い、通貨ペア間相関が高い、スプレッド・スワップの影響大）に合わせてKPIとフレームワークを再構築する。

### スコープ

**リサーチ特化MVP**。バックテストとWalk-Forward検証で「実用化できる戦略」を見つけることに集中。実取引・ペーパートレード・ブローカーAPI連携は将来拡張として設計の邪魔にならない範囲で考慮するが、MVPには含めない。

---

## 2. 主要KPI & 判定基準

### 主KPI（必達）

| KPI | 閾値 | 備考 |
|---|---|---|
| **Sharpe比（OOS）** | ≥ 1.0 | FX/ヘッジファンド業界標準の実用ライン |

### 副KPI

| KPI | 閾値 |
|---|---|
| MAR比（Calmar比） | ≥ 0.5 |
| Profit Factor | ≥ 1.3 |
| 最大ドローダウン | ≤ 20% |

### ロバスト性条件

| 条件 | 閾値 |
|---|---|
| IS→OOS の Sharpe比低下率 | ≤ 30% |
| 機能するペア数（3ペア中） | ≥ 2 ペア |

### 前提条件

- スプレッド・スワップ控除後の期待値 > 0
- 年間取引回数 ≥ 20（統計的有意性確保）

### 実用化判定フロー

```
1. 個別バックテスト: 期待値>0 & PF≥1.3 を通過
2. WF OOS: Sharpe≥1.0 & MAR≥0.5 & PF≥1.3 & DD≤20% を通過
3. ロバスト性: IS/OOS Sharpe低下率≤30%
4. 汎用性: 3ペア中2ペア以上で上記を通過
→ 全部通過した戦略のみ「実用化候補」として採用
```

---

## 3. スコープ確定事項

| 項目 | 決定値 |
|---|---|
| スコープ | リサーチ特化（バックテスト + WF） |
| 時間軸 | 日足 |
| 対象ペア | USD/JPY / EUR/USD / GBP/USD |
| データソース | yfinance（`USDJPY=X` 等のティッカー） |
| データ範囲 | 過去10年 |
| 実装言語 | TypeScript + Python（価格取得のみ） |
| DB | PostgreSQL + Prisma |
| 出力 | コンソール + DB + Markdownレポート（`reports/` 配下） |
| Web UI | 無し（将来拡張） |

---

## 4. 戦略ポートフォリオ

### 採用戦略（MVP）

| # | 戦略 | タイプ | パラメータ初期値 |
|---|---|---|---|
| 1 | **Donchian Breakout** | 順張り（トレンドフォロー） | 直近20日高値ブレイクで買い / 安値ブレイクで売り、55日でエグジット |
| 2 | **MA Crossover** | 順張り | EMA20 が EMA50 を上抜け買い / 下抜け売り |
| 3 | **RSI Mean Reversion** | 逆張り | RSI(14) < 30 で買い / > 70 で売り |
| 4 | **NR7 Breakout** | ボラ圧縮→拡張 | 直近7日で最小レンジの翌日、高値ブレイクで買い / 安値ブレイクで売り |

**設計意図**:
- 順張り2 + 逆張り1 + パターン1 で戦略タイプを分散 → ポートフォリオ運用時の相関を下げる
- 各戦略のパラメータはWFで最適化（上記は初期値）

### 検討したが初期採用しなかった戦略（将来拡張候補）

| 戦略 | 理由 |
|---|---|
| Bollinger Reversion | RSI Mean Reversion と役割重複 |
| Inside Bar Breakout | NR7 と思想重複 |
| Momentum（ROC） | MA Crossover と役割重複 |
| Carry Trade | 日足スイング・MVP向きではない（長期保有前提） |

---

## 5. エグジット戦略

### 共通フレームワーク

参考リポ踏襲。ATRベースのSL + トレーリング + タイムストップで全戦略統一。

| パラメータ | 役割 | 初期値（WFで最適化） |
|---|---|---|
| 損切り（SL） | エントリー価格から ATR × N | ATR × 1.0（上限3%） |
| BE発動 | ATR × M で建値に引き上げ | ATR × 0.5 |
| トレール幅 | 利確方向の追跡距離 | ATR × 1.0 |
| タイムストップ（基本） | この日数で決着なければ手仕舞い | 10営業日 |
| タイムストップ（上限） | 絶対的な保有上限 | 20営業日 |

### 戦略タイプ別の差分

| 戦略 | トレーリングストップ | タイムストップ |
|---|---|---|
| Donchian Breakout（順張り） | 有効 | 適用 |
| MA Crossover（順張り） | 有効 | 適用 |
| RSI Mean Reversion（逆張り） | **無効**（逆張りなのでトレイルは機能しない） | 短め（5営業日） |
| NR7 Breakout（ボラ拡張） | 有効 | 適用 |

---

## 6. コストモデル

### スプレッド（固定値）

| ペア | スプレッド (pips) |
|---|---|
| USD/JPY | 0.3 |
| EUR/USD | 0.3 |
| GBP/USD | 0.8 |

※各ブローカー実勢値の約1.2倍を保守的に採用。初期値、実装時に確定。

### スワップ（固定値、円/1万通貨/日）

| ペア | 買スワップ | 売スワップ |
|---|---|---|
| USD/JPY | +100 | -130 |
| EUR/USD | -50 | +30 |
| GBP/USD | -30 | +10 |

※値は仮。実装時にSBI FXトレード等の公開実績値を参考に確定。毎日の保有で計上。

### 実装方針

- ペア別のスプレッド・スワップは `Pair` テーブルで管理（環境変数でオーバーライド可能）
- エントリー時にスプレッド分だけ不利な価格で約定
- 保有中は毎日スワップを累計（バイ/セル方向別）

---

## 7. ポジションサイジング

### 方式: 固定リスク率（参考リポ踏襲）

| 項目 | 値 |
|---|---|
| 1トレードあたりリスク | 資金の **1%** |
| 計算式 | `ロット = (資金 × 1%) / (SL幅pips × pip価値)` |
| 連敗時縮小 | N連敗でロット半減（WFで調整） |

### pip価値変換

ペアごとに1pipあたりの円換算価値が異なるため、専用ヘルパ `lib/pip-value.ts` で吸収:

- USD/JPY: 1pip = 100円/1万通貨（直接）
- EUR/USD: 1pip = `現在のドル円レート × 1` 円/1万通貨
- GBP/USD: 同上

### 初期資金

バックテストのデフォルト初期資金: **100万円**

---

## 8. ポートフォリオ運用ルール（combined用）

### ポジション上限

- **全体**: 最大6枠同時保有
- **戦略別**: 各戦略 最大2枠（過度な集中を防ぐ）
- **ペア別**: 各ペア 最大2枠

### ペア間相関管理

- EUR/USD と GBP/USD が**同方向**で同時保有 → 実効1枠としてリスク管理（相関 ≈ 0.8）
- USD/JPY と EUR/USD は独立（相関低）
- 実装: 相関テーブルを持ち、「相関0.7超 × 同方向 → 実効リスク加算」で判定

### 資金配分

- 等分（戦略×ペア組合せに1%リスクを一律割当）
- 連敗時の縮小は個別戦略ごとに適用

---

## 9. Walk-Forward 検証

### 窓設定

| 項目 | 値 |
|---|---|
| In-Sample (IS) | 12ヶ月（約252営業日） |
| Out-of-Sample (OOS) | 6ヶ月（約126営業日） |
| ステップ | 0.5年（126営業日）前進 |
| 想定窓数 | 過去10年で **約18窓** |

### 採用理由

1. 日足FXは取引頻度が株より低くなりがち → サンプル数確保優先
2. FXは金融政策サイクル（FOMC/日銀）が重要 → IS窓で年間サイクルを最低1周カバー
3. 統計的有意性のため窓数 ≥ 15 を確保

### 最適化対象パラメータ（戦略別）

| 戦略 | 探索パラメータ |
|---|---|
| Donchian | エントリー窓（10〜55日）、エグジット窓（10〜55日） |
| MA Crossover | 短期EMA（10〜30）、長期EMA（30〜100） |
| RSI Reversion | 期間（7〜21）、買い閾値（20〜35）、売り閾値（65〜80） |
| NR7 Breakout | ブレイク確認パラメータ、ストップ距離 |

共通: ATR倍率（0.5〜2.0）、トレール倍率（0.3〜1.5）、タイムストップ日数

### 判定

全窓のOOS平均で主KPI・副KPI・ロバスト性条件を満たせば合格。各ペアで独立に実行。

---

## 10. 技術スタック

| レイヤー | 採用技術 |
|---|---|
| Runtime | Hono + Node.js (>=22) + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| 価格データ取得 | Python + yfinance（参考リポの `yfinance-service` パターン流用） |
| 技術指標 | `technicalindicators` (npm) |
| テスト | Vitest |
| Lint | ESLint |
| シェル | fish（開発環境） |

**将来拡張の想定**:
- 実取引: OANDA API等を追加する想定、`broker/` レイヤーを後日追加
- Web UI: Hono のルーティングを活用、リサーチ結果ダッシュボードを後日追加

---

## 11. アーキテクチャ

### ディレクトリ構成

```
auto-fx-trader/
├── src/
│   ├── core/                       # 戦略実装
│   │   ├── donchian/
│   │   │   ├── index.ts
│   │   │   ├── entry.ts           # エントリーシグナル判定
│   │   │   ├── params.ts          # デフォルトパラメータ
│   │   │   └── __tests__/
│   │   ├── ma-crossover/
│   │   ├── rsi-reversion/
│   │   └── nr7-breakout/
│   ├── backtest/
│   │   ├── engine.ts              # 共通バックテストエンジン
│   │   ├── exit-manager.ts        # ATR SL + トレイル + タイムストップ
│   │   ├── cost-model.ts          # スプレッド + スワップ適用
│   │   ├── position-sizer.ts      # 1%リスクサイジング
│   │   ├── portfolio-manager.ts   # combined用: 枠管理 + 相関管理
│   │   ├── donchian-run.ts        # 個別バックテストランナー
│   │   ├── ma-crossover-run.ts
│   │   ├── rsi-reversion-run.ts
│   │   ├── nr7-breakout-run.ts
│   │   ├── combined-run.ts        # ポートフォリオバックテスト
│   │   └── __tests__/
│   ├── walk-forward/
│   │   ├── engine.ts              # WF共通エンジン（12/6窓、0.5年ステップ）
│   │   ├── optimizer.ts           # IS窓でのパラメータ探索
│   │   ├── robustness.ts          # ロバスト性判定
│   │   └── __tests__/
│   ├── lib/
│   │   ├── metrics.ts             # Sharpe / MAR / PF / DD / 期待値計算
│   │   ├── indicators/            # ATR, RSI, EMA ラッパ
│   │   ├── correlation.ts         # ペア間相関管理
│   │   ├── pip-value.ts           # ペア別pip価値変換
│   │   ├── date.ts                # dayjs + JST
│   │   └── __tests__/
│   ├── data/
│   │   ├── price-loader.ts        # yfinance-service ラッパ
│   │   └── pair-config.ts         # ペア別スプレッド/スワップ定数
│   ├── reports/
│   │   ├── markdown-writer.ts     # Markdownレポート生成
│   │   └── kpi-formatter.ts
│   └── types/
│       ├── bar.ts                 # OHLCV
│       ├── trade.ts               # Trade
│       ├── signal.ts              # EntrySignal
│       └── strategy.ts            # Strategy interface
├── scripts/
│   ├── walk-forward-donchian.ts
│   ├── walk-forward-ma-crossover.ts
│   ├── walk-forward-rsi-reversion.ts
│   ├── walk-forward-nr7.ts
│   ├── backfill-fx-prices.ts      # yfinanceから過去10年分取得
│   └── requirements.txt           # Python依存
├── yfinance-service/              # Pythonワーカー
│   ├── main.py                    # FXペア取得エンドポイント
│   └── requirements.txt
├── reports/                       # Markdownレポート出力先（Git管理）
│   ├── backtests/
│   └── walk-forward/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
│   ├── plans/
│   └── specs/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

### データモデル（Prisma）

```prisma
model Pair {
  id                String   @id @default(cuid())
  symbol            String   @unique  // "USDJPY", "EURUSD", "GBPUSD"
  yfinanceTicker    String   @unique  // "USDJPY=X" 等
  pipValueJpy       Float              // 1万通貨あたりのpip価値（円換算、参考値）
  spreadPips        Float              // 固定スプレッド
  buySwapJpy        Float              // 買スワップ（円/1万通貨/日）
  sellSwapJpy       Float              // 売スワップ（円/1万通貨/日）
  dailyBars         DailyBar[]
  trades            Trade[]
}

model DailyBar {
  id        String   @id @default(cuid())
  pairId    String
  pair      Pair     @relation(fields: [pairId], references: [id])
  date      DateTime
  open      Float
  high      Float
  low       Float
  close     Float
  volume    Float?
  @@unique([pairId, date])
  @@index([pairId, date])
}

model BacktestRun {
  id              String   @id @default(cuid())
  strategy        String   // "donchian", "ma-crossover", "rsi-reversion", "nr7-breakout", "combined"
  pairSymbol      String?  // null if combined
  startDate       DateTime
  endDate         DateTime
  initialCapital  Float
  params          Json     // 戦略パラメータ + コスト・サイジング設定
  // KPI
  totalReturn     Float
  sharpe          Float
  mar             Float
  profitFactor    Float
  maxDrawdown     Float
  winRate         Float
  tradeCount      Int
  expectancy      Float
  // メタ
  createdAt       DateTime @default(now())
  trades          Trade[]
  reportPath      String?  // Markdownレポートへの相対パス
  @@index([strategy, pairSymbol, createdAt])
}

model WalkForwardRun {
  id               String   @id @default(cuid())
  strategy         String
  pairSymbol       String
  startDate        DateTime
  endDate          DateTime
  isMonths         Int      // 12
  oosMonths        Int      // 6
  stepMonths       Float    // 0.5
  // 集約KPI（全窓OOS平均）
  oosAvgSharpe     Float
  oosAvgMar        Float
  oosAvgPf         Float
  oosMaxDd         Float
  isOosSharpeDrop  Float    // IS→OOS低下率
  passed           Boolean  // 合格判定
  windows          Json     // 各窓の詳細結果配列
  createdAt        DateTime @default(now())
  reportPath       String?
  @@index([strategy, pairSymbol, createdAt])
}

model Trade {
  id               String   @id @default(cuid())
  backtestRunId    String
  backtestRun      BacktestRun @relation(fields: [backtestRunId], references: [id])
  pairId           String
  pair             Pair     @relation(fields: [pairId], references: [id])
  strategy         String
  side             String   // "long" | "short"
  entryDate        DateTime
  entryPrice       Float
  exitDate         DateTime?
  exitPrice        Float?
  exitReason       String?  // "sl", "trailing", "time", "signal"
  sizeUnits        Float    // 通貨単位
  pnlPips          Float?
  pnlJpy           Float?
  holdingDays      Int?
  @@index([backtestRunId])
  @@index([pairId, entryDate])
}
```

### 戦略インターフェース

```typescript
// src/types/strategy.ts
export interface Strategy {
  name: string;
  defaultParams: Record<string, unknown>;
  generateSignals(bars: DailyBar[], params: Record<string, unknown>): EntrySignal[];
  exitConfig: ExitConfig;  // トレイル有効/無効、タイムストップ日数等
}

export interface EntrySignal {
  date: Date;
  side: "long" | "short";
  entryPrice: number;
  atr: number;  // その日のATR（SL計算に使う）
}

export interface ExitConfig {
  useTrailing: boolean;
  timeStopDays: number;
  timeStopMaxDays: number;
  slAtrMultiplier: number;
  beAtrMultiplier: number;
  trailAtrMultiplier: number;
}
```

### 共通バックテストエンジンの責務

1. 日足バーをストリーム処理
2. 戦略の `generateSignals` でシグナル取得
3. `position-sizer` でロットサイズ決定
4. `cost-model` でスプレッド・スワップ適用
5. `exit-manager` でSL/トレイル/タイムストップを毎日評価
6. Trade単位の結果を集約し `metrics.ts` でKPI計算
7. DB保存 + Markdownレポート出力

---

## 12. 検証プロセス（全体フロー）

```
[Phase 1: データ整備]
  1. yfinanceから3ペア×10年の日足取得 → DailyBar
  2. Pairマスタにスプレッド・スワップ投入

[Phase 2: 個別バックテスト]
  各戦略 × 各ペアで実行（4 × 3 = 12組合せ）
  → 期待値>0 & PF≥1.3 で1次足切り
  → 不合格の戦略は原因分析 → 戦略再検討 or 廃止

[Phase 3: Walk-Forward検証]
  1次足切りを通った戦略 × ペアで実行
  約18窓のOOS平均で:
    - Sharpe ≥ 1.0
    - MAR ≥ 0.5
    - PF ≥ 1.3
    - DD ≤ 20%
    - IS/OOS Sharpe低下率 ≤ 30%
  → 全条件通過で「単独合格」

[Phase 4: 汎用性検証]
  3ペア中2ペア以上で単独合格した戦略を「実用化候補」として採用

[Phase 5: ポートフォリオ検証]
  実用化候補の戦略群でcombinedバックテスト
  → 総合 Sharpe / MAR / DD を評価
  → 相関で効率落ちる戦略はポートフォリオから除外

[最終成果]
  「FXで実用化できる戦略ポートフォリオ」の確定
```

---

## 13. 最終的な期待成果物

- **12組合せ**（4戦略 × 3ペア）の個別バックテスト結果（DB + Markdown）
- **WF結果**（各ペア・各戦略）とロバスト性判定
- **実用化候補戦略リスト**（≥ 2ペアで合格したもの）
- **combined ポートフォリオバックテスト結果**（採用戦略群の総合評価）
- **Markdownレポート群**（`reports/` 配下にGit管理）

---

## 14. 将来拡張（MVPスコープ外）

以下はMVPに含めないが、設計の邪魔にならないように構造を準備する:

- **ペーパートレード**: デモ口座で戦略を検証する仕組み（OANDA demo等）
- **実取引**: `broker/` レイヤー追加（OANDA / MT5 / SBI等）
- **Web UI**: Hono で戦略・バックテスト結果のダッシュボード
- **短期足（1H/4H）への展開**: データモデルは日足のみだが、将来 `IntradayBar` を追加可能
- **追加戦略**: Bollinger / Inside Bar / Momentum / Carry等
- **マルチタイムフレーム戦略**: 日足でトレンド、下位足でエントリー
- **AIレジーム判定**: 参考リポの `market-assessment` 相当
- **ペア拡張**: メジャー7ペア、クロス含む

---

## 15. 参考リポとの差分まとめ

| 項目 | auto-stock-trader | auto-fx-trader (本件) |
|---|---|---|
| 対象市場 | 日本株 | FX（USDJPY/EURUSD/GBPUSD） |
| 主KPI | Calmar比 ≥ 3.0 | **Sharpe比 ≥ 1.0 (OOS)** |
| コンセプト | 損小利大で複利、Calmar最大化 | **ロバスト性 × 低相関ポートフォリオ** |
| 時間軸 | 日足 | 日足（踏襲） |
| 戦略 | gapup + PSC（2本柱） | Donchian / MA / RSI / NR7（4本柱） |
| エグジット | ATR SL + トレイル + タイム | 踏襲（平均回帰のみ差分） |
| WF窓 | 6ヶ月IS / 3ヶ月OOS | **12ヶ月IS / 6ヶ月OOS**（低頻度戦略対応） |
| ポジションリスク | 2% | **1%**（FXはレバレッジ前提で保守的に） |
| ポートフォリオ | combined | 踏襲 + 相関管理強化 |
| 実取引 | あり（立花証券API） | なし（MVPはリサーチ特化） |
| コスト | なし（株は取引手数料のみ） | **スプレッド + スワップ**（FX特有） |
| 技術スタック | TS + Prisma + PG + Python(yfinance) | 踏襲 |

---

## 16. 未解決事項（実装フェーズで決定）

- 各戦略パラメータ探索空間の具体的なグリッド（WF最適化の計算量とのトレードオフで調整）
- スプレッド・スワップ具体値の実勢確認（実装時に調査）
- BacktestRunのパラメータJSON構造（フィールド追加時の後方互換）
- combined時のリバランス頻度（毎日 / 週次 / トレードイベント駆動）
- 連敗時ポジション縮小のトリガー値（WF対象にするか、固定値にするか）

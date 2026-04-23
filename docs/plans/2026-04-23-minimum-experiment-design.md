# 最小実験設計: USDJPY 4h × MA Crossover

**作成日**: 2026-04-23
**ステータス**: 設計完了（実装未着手）
**親コンテキスト**: [エグゼクティブサマリ](../specs/executive-summary.md) の「もし続けるなら最小実験」を受けた単発検証

---

## 1. 目的

**FX撤退の判断を確定させるための最後の実験**。以下の最小条件で WF OOS Sharpe ≥ 0.5 を達成できるか検証する:

- **最もエッジが観察されたペア**: USDJPY
- **サンプル数を増やす時間軸**: 4時間足（1日6本）
- **最もシンプルな戦略**: MA Crossover 単独
- **最も過学習耐性が高いパラメータ設計**: shortEma のみ最適化（他2つは固定）

### 判定基準

| 結果 | アクション |
|---|---|
| WF OOS Sharpe ≥ 0.5 | FX再挑戦の具体検討へ（他ペア拡張、他時間軸試行等） |
| WF OOS Sharpe < 0.5 | **FX撤退確定**。auto-stock-trader に集中 |

---

## 2. スコープ確定事項

| 項目 | 決定値 |
|---|---|
| ペア | USDJPY 単独 |
| 時間軸 | 4時間足 |
| データソース | yfinance `interval="1h"` → 4h集約 |
| データ範囲 | 直近2年（yfinance の1h足保持期間制約） |
| データ本数 | ~3000本（4h足） |
| データ保存 | 新テーブル `IntradayBar` |
| 戦略 | MA Crossover 単独 |
| 最適化パラメータ | `shortEma` のみ |
| パラメータグリッド | `shortEma` ∈ [5, 10, 15, 20, 25] |
| 固定パラメータ | `longEma=50`, `atrPeriod=14` |
| 初期資金 | 1,000,000 JPY |
| リスク率 | 1% |
| コストモデル | 既存（スプレッド0.3pips + スワップ） |

### エグジット（4h換算）

| パラメータ | 値 | 日足版との比較 |
|---|---|---|
| slAtrMultiplier | 1.0 | 同じ |
| beAtrMultiplier | 0.5 | 同じ |
| trailAtrMultiplier | 1.0 | 同じ |
| useTrailing | true | 同じ |
| timeStopBars | 60 | 日足 10日 × 6本/日 |
| timeStopMaxBars | 120 | 日足 20日 × 6本/日 |

**注**: 既存 `ExitConfig.timeStopDays` を「バー数」として解釈。フィールド名は据え置き（リネームは別スコープ）。

### Walk-Forward窓

| パラメータ | 値 | 換算 |
|---|---|---|
| isBars | 500 | ≈ 3.5ヶ月（4h×6/日×83日） |
| oosBars | 250 | ≈ 1.7ヶ月 |
| stepBars | 125 | ≈ 1ヶ月 |
| 期待窓数 | ~10 | 過去2年から切り出し |

### ロバスト性閾値

| 指標 | 閾値 |
|---|---|
| **主KPI**: OOS Sharpe | **≥ 0.5** |
| 副KPI: OOS MAR | ≥ 0.3 |
| 副KPI: OOS PF | ≥ 1.2 |
| 副KPI: OOS Max DD | ≤ 15% |
| IS→OOS Sharpe低下率 | ≤ 50%（日足より緩和） |

※ 参考リポの厳格基準より緩いが、これは「最後の実験」の性質を反映: 緩くても通らなければ、厳格基準では絶望的ということ。

---

## 3. アーキテクチャ

### 既存コードへの影響

**最小改変が原則**。以下のみ追加:

```
新規追加ファイル:
  prisma/schema.prisma                         # IntradayBar モデル追加
  src/types/intraday-bar.ts                    # IntradayBar 型
  src/data/intraday-loader.ts                  # 1h→4h 集約ヘルパ
  scripts/backfill-usdjpy-4h.ts                # 取得スクリプト
  scripts/experiment-usdjpy-4h-ma.ts           # 単発実験ランナー

既存コードの修正:
  yfinance-service/main.py                     # /fx/intraday?interval=1h 追加
  src/data/price-loader.ts                     # fetchFxIntraday 追加
  src/backtest/runner-helpers.ts               # loadBars を datetime 対応に拡張（または別関数）

影響を受けないコンポーネント（流用のみ）:
  src/backtest/engine.ts                       # 時間軸非依存
  src/core/ma-crossover/                       # そのまま使える
  src/walk-forward/engine.ts                   # バー数ベースなのでそのまま
  src/walk-forward/optimizer.ts                # 同上
  src/lib/metrics.ts                           # 同上
  src/backtest/exit-manager.ts                 # daysHeld をバー数として流用
```

### Prisma スキーマ追加

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

`Pair` モデルにもrelationを追加: `intradayBars IntradayBar[]`

### データ型

```typescript
// src/types/intraday-bar.ts
export interface IntradayBar {
  datetime: Date;  // UTC
  timeframe: "1h" | "4h";
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

// エンジン互換: DailyBar と同形状に寄せる（date: Date, volume: number|null）
// エンジン内では `date` フィールドを使うので、実験ランナーでは IntradayBar を DailyBar 形式に変換するアダプタを挟む
```

**アダプタ方針**: 既存 `runBacktest` は `DailyBar[]` を期待するので、`IntradayBar → DailyBar` 変換で `datetime → date` にマップし、既存エンジンをそのまま使う。「日足」という名前は今回の実験では意味を持たないが、バー配列として扱う限り問題なし。

---

## 4. データパイプライン

### yfinance-service 側（`/fx/intraday`）

```python
@app.get("/fx/intraday")
async def fx_intraday(ticker: str, interval: str, start: str, end: str):
    # interval: "1h" のみ想定
    # yfinance は "1h" または "60m" をサポート
    # 内部的に throttled_with_retry 経由で取得
    # 既存 _df_to_bars と同パターンで JSON 返す
    # date は "YYYY-MM-DDTHH:MM:SSZ" 形式（UTC）
```

### 取得スクリプト `scripts/backfill-usdjpy-4h.ts`

```
1. yfinance-service へ /fx/intraday?ticker=USDJPY=X&interval=1h&start=<2年前>&end=<今日>
2. レスポンスを IntradayBar (timeframe="1h") として DB 保存（skipDuplicates）
3. 1h足を4本ずつグループ化して4h足を生成:
   - 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC 区切り
   - open = グループ最初のopen
   - high = グループ最大high
   - low = グループ最小low
   - close = グループ最後のclose
   - volume = グループ合計（nullでないもののみ）
4. 4h足を IntradayBar (timeframe="4h") として保存
```

### 実験ランナー `scripts/experiment-usdjpy-4h-ma.ts`

```
1. IntradayBar (pair=USDJPY, timeframe="4h") をロード、DailyBar 互換形式に変換
2. MA Crossover 戦略 + paramGrid={shortEma: [5,10,15,20,25], longEma:[50], atrPeriod:[14]} で runWalkForward
3. WalkForwardRun に結果保存（strategy="ma-crossover-4h", pairSymbol="USDJPY"）
4. Markdownレポートを reports/experiments/ 配下に出力
5. コンソールに判定結果を表示:
   - PASS: OOS Sharpe 0.53 >= 0.5 → "FX再挑戦検討"
   - FAIL: OOS Sharpe 0.12 < 0.5 → "FX撤退確定"
```

---

## 5. テスト戦略

### 単体テスト
- 1h → 4h 集約ロジック（boundary handling、欠損バー処理）
- IntradayBar → DailyBar アダプタ
- 既存テスト 151本は影響を受けない

### 統合テスト
- backfill スクリプトの smoke test（短期間で取得→保存→読み出し）
- 実験ランナー自体は実データ実行なので手動検証

---

## 6. 期待成果物

- 実行結果レポート: `docs/specs/minimum-experiment-result.md`
  - OOS Sharpe 実数値
  - 10窓のKPI詳細
  - 各窓で選ばれた shortEma 値（安定していれば良い兆候、毎窓異なれば過学習）
  - 判定: PASS / FAIL
- 判定に基づく次のアクション決定
- DB/Markdown レポートは `WalkForwardRun` / `reports/experiments/` に永続化

---

## 7. 所要時間見積

| フェーズ | 見積 |
|---|---|
| Prisma + IntradayBar 追加 | 15分 |
| yfinance-service エンドポイント追加 | 20分 |
| intraday-loader + 集約 | 30分 |
| backfill スクリプト | 30分 |
| 実験ランナー | 30分 |
| 実データ取得 + 実行 | 15分 |
| レポート作成 + 判定 | 30分 |
| **計** | **約3時間** |

---

## 8. 撤退条件の明確化

この実験を通じて「FX撤退」の判断に必要な情報を全て得る。以下が記録として残る:

1. **実験結果（定量）**: OOS Sharpe と他KPI
2. **shortEma の安定性（定性）**: 窓ごとに最適値がぶれるか
3. **判定とその理由**: なぜ続ける/止めるか

これが揃えば、**後日「FXをもう一度」という誘惑が来たとき、根拠をもって判断できる**。

---

## 9. 未解決事項（実装フェーズで決定）

- yfinance の `/fx/intraday` 呼び出しで `end` より後の日時が弾かれる場合の対処（end = 今日より少し前にする等）
- 1h足のタイムスタンプが取引所時間なのかUTCなのか（おそらくUTC、実装時に確認）
- 4h集約の境界時刻（UTC 00:00始点固定 vs. 東京ボックス開始3:00始点など） — 東京ボックス基準は複雑なのでUTC 00:00固定を推奨
- 4h足で出来高が意味を持つか（FXは原則volumeゼロ/null、今回も気にしない）

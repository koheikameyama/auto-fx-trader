## 背景

直近の検証で本リポジトリは**FX撤退**を確定した（[minimum-experiment-result.md](../specs/minimum-experiment-result.md)）。
日足12組合せ（4戦略×3ペア）→ USDJPY 4h MA Crossover 最小実験まで全て FAIL。

撤退条件のドキュメントには「再開には**新しい戦略アイデア・新データソース・新時間軸・構造的変化**のいずれかが必要」と明記している。本実験はその「**新時間軸（1h）+ 1h足だから機能する戦略構造（時間帯特化型 ORB）**」に該当する最後の探索として位置づける。

本実験で FAIL した場合、日足/4h/1h 全タイムフレームでの失敗が確定し、テクニカル単独でのFXは構造的に困難という結論を強化する。PASS した場合のみ次フェーズ（NYセッション・他ペア・フォワードテスト）に進む。

---

## 戦略仕様: London Opening Range Breakout (1h × USDJPY)

**コンセプト**: 24時間FX市場の構造（流動性が時間帯で変動）を活用し、ロンドン時間の最初の数時間で形成されるレンジのブレイクアウトを取る。日中完結戦略のためトレード頻度が高く、Sharpe推定の統計的安定性を確保できる。

### エントリー
- 毎営業日のロンドン時間（07:00-15:00 UTC = 16:00-24:00 JST）開始から `rangeHours` 時間の高値/安値をレンジとして記録
- レンジ確定後、ロンドン時間内に高値ブレイク → ロング、安値ブレイク → ショート
- 1日1ポジション（最初のシグナルのみ採用、両側エントリーしない）

### エグジット
- ロンドン時間終了（15:00 UTC）で強制クローズ
- もしくは `atrMultStop × ATR` の損切りラインに到達

### パラメータ
- 最適化対象: `rangeHours ∈ [2, 3, 4]`（3値のみ）
- 固定: `atrMultStop = 1.5`, `atrPeriod = 14`, `riskRatio = 0.01`, `sessionStartUtc = 7`, `sessionEndUtc = 15`

### 過学習対策
- 4h実験は5値×1パラメータでも過学習 → 3値に絞る
- ATR系を全て固定し、レンジ窓の最適性のみ検証
- 「日中の特定時間帯」という構造的仮定を入れて、純粋なパラメータ最適化への依存を低減

---

## Walk-Forward 設計

### データ
- ソース: yfinance `/fx/intraday` endpoint（既存、interval=1h）
- 期間: 過去2年（yfinance 1h 制限 ≈ 730日）
- 銘柄: USDJPY 単独
- 推定本数: 約 12,500 本（FX 24/5、週末除く）

### WF パラメータ（バー数ベース）

| 項目 | 値 | 期間目安 |
|---|---|---|
| IS 期間 | 3,000 bars | 約6ヶ月 |
| OOS 期間 | 1,000 bars | 約2ヶ月 |
| Step | 500 bars | 約1ヶ月 |
| 窓数 | **約17窓** | - |

### 設計根拠
- 4h実験は IS=500/OOS=250/Step=125 で17窓 → 1hでも同等の窓数で「失敗パターンの再現性」を比較可能に
- IS=6ヶ月で約 60〜100 トレード/IS窓を確保（4h実験はIS窓あたり10〜30トレード、これを大幅改善）
- OOS=2ヶ月で約 20〜40 トレード → Sharpe推定の統計的安定性が4h時より明確に高い
- IS:OOS = 3:1（4h実験は2:1だったが、1hはノイズ多いためOOS厚めに）

### 最適化ロジック
1. 各IS窓で `rangeHours ∈ [2, 3, 4]` を試し、最高 IS Sharpe を選択
2. そのパラメータで OOS 期間の Sharpe / MAR / PF / DD を計測
3. 17窓の OOS 結果を集計（平均 Sharpe、IS→OOS低下率、勝ち窓比率、Sharpeの標準偏差）

---

## 実装スコープ

### 既存基盤の再利用
- `yfinance-service` の `/fx/intraday` endpoint（1h対応済み）
- `IntradayBar` テーブル（timeframe フィールドで1h判別）
- `fetchFxIntraday()` ローダー（[src/data/price-loader.ts](../../src/data/price-loader.ts)）
- `walk-forward-shared.ts` の WFランナーロジック
- コストモデル、pip価値、Sharpe/MAR/PF計算系すべて

### 新規作成ファイル

| コンポーネント | パス | 内容 |
|---|---|---|
| 戦略本体 | `src/core/orb/index.ts` | London ORB シグナル生成、エントリー/エグジット |
| 戦略パラメータ型 | `src/core/orb/params.ts` | `OrbParams { rangeHours, atrMultStop, atrPeriod, sessionStartUtc, sessionEndUtc }` |
| 戦略テスト | `src/core/orb/__tests__/orb.test.ts` | TDD: レンジ確定、ブレイク検知、セッション終了強制決済、ATR損切り |
| 1hバックフィル | `scripts/backfill-usdjpy-1h.ts` | 4h版を流用、`aggregate1hTo4h` 呼び出しを削除 |
| WFランナー | `scripts/walk-forward-orb.ts` | `walk-forward-shared.ts` を1hバー対応で呼び出し |
| 実験ランナー | `scripts/experiment-usdjpy-1h-orb.ts` | 4h MA Crossover実験スクリプトを参考に |

### npm scripts 追加

```json
"backfill:usdjpy-1h": "tsx scripts/backfill-usdjpy-1h.ts",
"walk-forward:orb": "tsx scripts/walk-forward-orb.ts",
"experiment:orb-1h": "tsx scripts/experiment-usdjpy-1h-orb.ts"
```

### 変更が必要かもしれないもの（要確認）
- `walk-forward-shared.ts` が日足/4h前提なら、1h時系列を扱えるよう汎用化（おそらくバー配列を受けるだけなので変更最小）
- ATR計算など `lib/indicators` は時間軸非依存のはず（要確認）

### TDD進行（小さい順）
1. ORB戦略のユニットテスト（モックバーで シグナル生成 → エントリー/エグジット動作確認）
2. ORB戦略実装
3. backfill 実行 → DBに約12,500本格納
4. シングルラン バックテスト（パラメータ固定で1回回す、結果のサニティチェック）
5. WFランナー実行 → 17窓集計
6. レポート出力 → Markdown、撤退判定

---

## 撤退判定ロジック

事前に判定ラインを明文化することで、結果が出てから「もう少し粘れば」というバイアスを排除する。

### 判定マトリクス

| OOS Avg Sharpe | IS→OOS低下率 | 判定 | 次のアクション |
|---|---|---|---|
| **≥ 0.5** | **≤ 50%** | ✅ **PASS** | 堅牢性追加検証へ進む |
| ≥ 0.5 | > 50% | ⚠️ 部分合格 | パラメータ削減（rangeHours固定）で再検証 → クリアすれば PASS |
| < 0.5 | ≤ 50% | ⚠️ 部分合格 | OOS Sharpe底上げのため stop方式 or session変更を1回だけ追試 |
| < 0.5 | > 50% | ❌ **FAIL** | **FX完全撤退を最終確定**、本リポジトリは保管モードへ |

### 追加チェック（PASS時）
- 17窓のうち **OOS Sharpe > 0 の窓比率 ≥ 60%**（4h実験は約50%でランダムウォーク判定 → これを構造的改善として要求）
- 17窓のOOS Sharpeの**標準偏差 ≤ 1.0**
- OOS Max DD ≤ 15%
- OOS PF ≥ 1.2

### 部分合格時の追試ポリシー
- 追試は **1回限り**（連鎖的に試すと p-hacking）
- 追試の変更内容と仮説を**事前にレポートに記載**してから実行
- 追試結果も同じ判定マトリクスに通す
- 追試で PASS しても「初回 FAIL → 追試 PASS」は実用化判断ではなく**「探索的所見」として記録**

### PASS時の次フェーズ（参考、本実験スコープ外）
1. ロバスト性検証: NYセッション ORB、EUR/USD など別ペアで機能するか
2. ライブ模擬: 直近1ヶ月のフォワードテスト（実時間）
3. 維持できれば実用化検討（少額デモ → 本番）

### FAIL時の確定アクション
- `docs/specs/orb-1h-experiment-result.md` を新規作成（[minimum-experiment-result.md](../specs/minimum-experiment-result.md) の続編として）
- README / executive-summary に「日足/4h/1h 全タイムフレームで失敗確認」を追記
- 本リポジトリは**保管モード**（次にFX再開する場合は新データソース or 構造的市場変化が前提）

---

## 主要KPI（再掲）

| KPI | 目標 | 測定方法 |
|---|---|---|
| OOS Avg Sharpe | ≥ 0.5 | 17窓のOOS Sharpe平均 |
| IS→OOS Sharpe Drop | ≤ 50% | (IS Sharpe - OOS Sharpe) / IS Sharpe |
| OOS 勝ち窓比率 | ≥ 60% | OOS Sharpe > 0 の窓 / 全窓 |
| OOS Sharpe 標準偏差 | ≤ 1.0 | 17窓のOOS Sharpeのstdev |
| OOS Max DD | ≤ 15% | 全窓を通じた最大DD |
| OOS PF | ≥ 1.2 | 全窓の利益合計 / 損失合計 |

---

## 参考リンク
- [日足リサーチ結果](../specs/research-findings.md)
- [4h最小実験結果（撤退判定）](../specs/minimum-experiment-result.md)
- [4h最小実験設計](2026-04-23-minimum-experiment-design.md)
- [4h最小実験実装プラン](2026-04-23-minimum-experiment-implementation.md)

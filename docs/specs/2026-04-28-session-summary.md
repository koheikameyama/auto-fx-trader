# Session Summary: 2026-04-28

**所要時間**: 約 4〜5 時間相当
**コミット数**: 19
**最終状態**: 1h ORB 凍結最終確定 + 将来再開条件のロードマップ完成

---

## セッション開始時の状態

- 4h MA Crossover 最小実験で FAIL → **FX撤退判断確定**（直近コミット 144d473）
- ユーザーから「他に戦略ないですかね」の問いかけ
- 撤退決定の根拠は強かったが、未試行の方向性として「新時間軸 (1h)」と「時間帯特化型戦略 (ORB)」が残っていた

## やったこと（時系列）

### Phase 1: 1h ORB 戦略実装と検証 (Tasks 1-9)

1. ブレインストーミング → 設計合意（London ORB / 1h × USDJPY 単独 / yfinance 2年分 / Sortino/MAR副、Sharpe主、撤退4-bucket判定）
2. 実装プラン策定（9タスク、TDD前提）
3. Subagent-driven-development で順次実装
   - `sessionEndUtcHour` 拡張（exit-manager）
   - ORB 戦略本体（params型 + TDD 6テスト + 実装）
   - 1h backfill スクリプト + 実行（11,733 bars 投入）
   - 実験ランナー + 実行
4. 結果: **PARTIAL_SHARPE**（OOS Sharpe 0.217 < 0.5、他6KPI合格）

### Phase 2: Option B 追試（事前宣言1回限り）

5. ストップ拡大（slAtrMultiplier 1.5 → 2.5）を事前宣言ドキュメント化
6. コード変更 → 再実行
7. 結果: **依然 PARTIAL_SHARPE**（Sharpe 0.201、仮説否定）→ 「探索済み・未採用」凍結
8. `slAtrMultiplier` を設計値 1.5 に戻し、追試値は所見として記録のみ

### Phase 3: KPI 再設計（Sortino、ユーザー指示「A/b」）

9. 新KPI設計合意（主KPI Sortino ≥ 0.7、副KPI MAR/PF を厳格化）
10. `sortinoRatio` 関数追加 + メトリクス系統に統合（Backtest/WF/Robustness 全層）
11. 再実験
12. 結果: **FAIL**（OOS Sortino 0.459 < 0.7）→ 凍結最終確定

### Phase 4: 将来ロードマップ整備

13. 新データソース評価ロードマップ作成（COT・FRED 等 6候補、Phase 1〜3 整理）
14. 4リポ視点の戦略選択肢ドキュメント作成（Crypto判定 5/9 を踏まえた Option A〜E）

---

## 主要な実証的発見

### 1. 1h ORB は4h MA Crossover より大幅に改善した

| 指標 | 4h MA | 1h ORB | 改善 |
|---|---:|---:|---|
| OOS Avg Sharpe | 0.118 | 0.217 | +84% |
| IS→OOS Sharpe Drop | 69% | 36% | 大幅改善 |
| OOS Sharpe Stdev | ~0.9 | 0.43 | 半減 |
| OOS 勝ち窓比率 | ~50% | 62.5% | ランダム超え |
| 最適パラメータ安定性 | 窓ごとブレ | 14/16窓で同一 | 構造化 |

→ **戦略構造そのものに再現可能なエッジが存在する**ことは確認できた。

### 2. しかし絶対水準が業界実用ラインに届かない

- 寛容な KPI 再設計（Sortino基準）でも未達 (0.459 vs 0.7)
- ストップ拡大（追試 Option B）でも改善しない
- 追加パラメータ調整は p-hacking につながるため禁止

→ **戦略の「質」自体が業界基準のエッジを下回る**。これ以上の探索は無駄。

### 3. レジーム変化の可能性

- 2024-12 〜 2025-08: 強く機能（Sharpe 1.20 の窓も）
- 2025-09 〜 2026-04: 劣化（半数が負）

→ レジーム変化に脆弱、フォワードテストでも不安定な可能性。

---

## 成果物

### 新規ドキュメント
- [docs/plans/2026-04-28-1h-usdjpy-orb-experiment-design.md](../plans/2026-04-28-1h-usdjpy-orb-experiment-design.md)
- [docs/plans/2026-04-28-1h-usdjpy-orb-experiment-implementation.md](../plans/2026-04-28-1h-usdjpy-orb-experiment-implementation.md)
- [docs/specs/orb-1h-experiment-result.md](orb-1h-experiment-result.md)
- [docs/specs/future-data-sources-roadmap.md](future-data-sources-roadmap.md)
- [docs/specs/post-fx-strategic-options.md](post-fx-strategic-options.md)

### 更新ドキュメント
- `docs/specs/executive-summary.md`: ステータスを「凍結最終確定」に
- `CLAUDE.md`: 現状行に Sortino 再評価結果を反映

### コード追加
- `src/core/orb/`: 戦略本体、params、テスト6本
- `src/types/strategy.ts`: `sessionEndUtcHour` フィールド
- `src/backtest/exit-manager.ts`: session-end exit 分岐
- `src/lib/metrics.ts`: `sortinoRatio` 関数 + テスト5本
- `src/walk-forward/engine.ts`: Sortino 統合（IS/OOS）
- `src/walk-forward/robustness.ts`: `SortinoRobustnessCriteria` + チェック関数
- `scripts/backfill-usdjpy-1h.ts`
- `scripts/experiment-usdjpy-1h-orb.ts`

### 実験データ
- DB: 11,733 1h USDJPY bars (2024-05-28 〜 2026-04-28)
- DB: WalkForwardRun レコード × 3（初回 / Option B 追試 / Sortino 再評価）
- レポート3本: `reports/experiments/orb-1h-usdjpy-{160501,161254,163617}.md`

### テスト
- セッション開始時: 151 → セッション終了時: **175** (+24, 全て新メトリクス・新戦略系)
- 全テスト PASS、tsc clean

---

## 確定した結論（記録）

1. **FX日足/4h/1h のすべてで実用ラインのエッジは見つからない** (テクニカル単独前提)
2. **ロバスト性指標（IS→OOS Drop, 勝ち窓比率）は構造的に改善可能**だが、絶対リターン水準は別問題
3. **Sharpe vs Sortino の指標差し替えは効果僅か** — スパース戦略でも0.7に届かない
4. **再開には新データソース or 構造的市場変化の観察が必須**
5. このリポジトリは「**勝てない」を実証した記録**として価値あり

---

## 次の判断（5/9 後に再検討）

[post-fx-strategic-options.md](post-fx-strategic-options.md) 参照。

**第一推奨**: Option A — Crypto Phase 2.1 Micro 判定 (5/9) 待ち + auto-stock-trader 運用強化を並行。

**重要制約**: 5/9 までは crypto に影響する変更を最小限に抑える。

---

## メタ所感（プロセス）

- Subagent-driven-development の TDD サイクルが効果的に機能した
- 「事前宣言ルール」が指標 p-hacking を防ぎ、Sortino再評価を「設計レベル決定」として位置づけられた
- 1セッション内で「実装 → 失敗 → 追試 → 再失敗 → KPI再設計 → 再失敗 → 凍結確定 → 将来ロードマップ作成」を完遂
- Subagent + 自動レビュー（spec / quality）で品質を維持しつつ高速イテレーション

---

## 参考リンク

- [全コミット履歴](../../) — `git log 73fe9a3^..HEAD --reverse`
- [エグゼクティブサマリ](executive-summary.md)
- [初期撤退判断（4h MA）](minimum-experiment-result.md)

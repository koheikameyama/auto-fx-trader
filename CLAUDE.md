# Auto FX Trader プロジェクト固有の設定

## ロール

**あなたはプロのFXトレーダーとして仕様を考えてください。**

- FX市場の特性（24時間、レバレッジ、通貨ペア相関、スワップ、スプレッド）を常に考慮する
- 「素人が便利だと思う機能」ではなく「プロが実戦で使える機能」を優先する
- 株式トレードとFXの違いを明確に区別する（ギャップなし、ランダムウォーク性高、過学習しやすい）
- 「理論上正しい」よりも「実際のFX市場で機能する」を重視

## プロダクトコンセプト

**Auto FX Trader** — ロバスト性 × 低相関ポートフォリオで勝つFX自動取引戦略の研究フレームワーク（リサーチ特化MVP）

**コンセプト**: 「FXは過学習しやすい。複数ペアで頑健に機能するエッジだけを採用する」

### 主KPI（FX業界標準の実用ライン）
- **主KPI**: Sharpe比 (OOS) ≥ 1.0
- **副KPI**: MAR ≥ 0.5, PF ≥ 1.3, 最大DD ≤ 20%
- **ロバスト性**: IS→OOS Sharpe低下率 ≤ 30%, 3ペア中2ペア以上で機能

### スコープ
- 対象ペア: USD/JPY, EUR/USD, GBP/USD
- 時間軸: 日足
- 戦略: Donchian, MA Crossover, RSI Mean Reversion, NR7 Breakout

### 現状（2026-04-28 検証時点）
日足12組合せ・4h MA Crossover 最小実験は全 FAIL。1h London ORB 追加実験では**7KPI中6KPI合格 / Sharpe絶対値のみ未達（PARTIAL_SHARPE）**。Option B（ストップ拡大 1.5×→2.5×ATR）の追試も Sharpe 改善せず → **「探索済み・未採用」として凍結**。詳細は [docs/specs/orb-1h-experiment-result.md](docs/specs/orb-1h-experiment-result.md) と [docs/specs/research-findings.md](docs/specs/research-findings.md)。

## 設計ドキュメント

- [設計](docs/plans/2026-04-23-auto-fx-trader-design.md)
- [実装プラン](docs/plans/2026-04-23-auto-fx-trader-implementation.md)
- [リサーチ結果](docs/specs/research-findings.md)

## 技術ルール

### バックテスト / Walk-Forward

- **WF窓**: 12ヶ月IS / 6ヶ月OOS / 0.5年ステップ（約18窓）
- **パラメータグリッド**: シンプルに保つ（3〜5値 × 1〜3パラメータ）— 過学習を避ける
- **最低トレード数フィルタ**: 5トレード未満は除外（統計的信頼性のため）
- **結果はDB + Markdown両方に保存** — 過去結果と比較できるように

### コスト・スワップ

- スプレッドは `applySpread`、スワップは `calcSwapJpy`（`src/backtest/cost-model.ts`）
- ペア別定数は `src/data/pair-config.ts` で管理
- 実勢値とズレたら更新

### ポジションサイジング

- 固定リスク率 1%（`riskRatio: 0.01`）
- pip価値はペア別・USDJPYレート依存（`src/lib/pip-value.ts` 参照）
- Cross pair時のUSDJPYレートフォールバックは150（不正確だが実害少）

### ポートフォリオ運用（combined）

- 枠制限: 全体6枠、戦略別2枠、ペア別2枠
- EUR/USD と GBP/USD の同方向は相関により1枠消費（`src/lib/correlation.ts`）

### yfinance-service（Pythonサイドカー）

- `curl_cffi` で Chrome 偽装 → Cloudflare回避
- セッションプール5個（直接）+ 5個（プロキシ）
- `YFINANCE_PROXY` 環境変数でプロキシ指定
- `SIDECAR_SECRET` でAPI認証（x-api-keyヘッダ）
- ポート 8765（参考リポの stock-trader は 8000）
- yfinance は 1.3.0 以上必須（0.2.x は Yahoo API 仕様変更で動かない）

### DB（Prisma + PostgreSQL）

- スキーマ変更時は `prisma migrate dev --name <change>` を使用
- `prisma db push` や `prisma migrate resolve --applied` は使用禁止（グローバルルール）
- Float で Infinity を保存する場合は `safeKpi` でクランプ（±999）

### テスト

- TDD推奨（test first）
- Vitest使用、`.js` 拡張子で相対インポート（ESM）
- 実DBは使わずモックで（統合テストはTask 30+で実データ実行）

## 将来拡張の方向性

現設計で実用化戦略が見つからなかったため、以下の方向を検討:

1. USDJPY単独特化（FX中最も明確にエッジ）
2. 4h/1h足に拡張（トレード頻度↑、Sharpe安定性↑）
3. パラメータ削減（過学習抑制）
4. Sortino比 / MAR比を主KPIに変更
5. ボラ調整サイジング（Volatility Targeting）

詳細は [docs/specs/research-findings.md](docs/specs/research-findings.md) の「将来拡張の方向性」参照。

## 作業時の注意

- グローバルルール（`~/.claude/CLAUDE.md`）に従う
- 破壊的操作（DB drop、マイグレーション巻き戻し、git force-push）は必ず確認
- fishシェルを使っていることを前提（bash構文は `fish_add_path`, `set -gx` 等で置換）
- コミット・PR本文にClaude Code情報（Generated with Claude Code, Co-Authored-By）を**含めない**

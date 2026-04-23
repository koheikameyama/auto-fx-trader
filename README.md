# Auto FX Trader

FX取引戦略のバックテスト + Walk-Forward検証フレームワーク（リサーチ特化MVP）。

参考リポジトリ: `auto-stock-trader`

## コンセプト

> 「FXは過学習しやすい。複数ペアで頑健に機能するエッジだけを採用する」

FX日足 × 複数戦略 × 厳密な Walk-Forward で「実用化できる戦略」を探索する研究フレームワーク。

### 主KPI
- **Sharpe比 (OOS) ≥ 1.0** — ロバスト性を主軸
- **MAR ≥ 0.5 / PF ≥ 1.3 / 最大DD ≤ 20%**
- **IS→OOS Sharpe 低下率 ≤ 30%**（過学習監視）
- **3ペア中2ペア以上**で合格した戦略のみ採用

### スコープ
- 対象ペア: USD/JPY, EUR/USD, GBP/USD
- 時間軸: 日足（10年データ）
- 戦略: Donchian / MA Crossover / RSI Mean Reversion / NR7 Breakout
- 実運用なし（リサーチ特化）

## リサーチ結果

2026-04-23 実施の検証結果の要約（詳細は [docs/specs/research-findings.md](docs/specs/research-findings.md)）:

- **主KPI達成戦略: 0/12**
- 全組合せで IS→OOS Sharpe 低下率が大幅超過 → 過学習が支配的
- USDJPY はFXペアの中で唯一エッジが観察される（全4戦略で最高）
- Combined ポートフォリオ: Sharpe 0.50, DD 25.3%（目標未達）

## 技術スタック

- **Runtime**: Node.js 22+ / TypeScript / Hono
- **DB**: PostgreSQL + Prisma
- **価格データ**: yfinance (Python FastAPI サイドカー、Cloudflare回避+プロキシ対応)
- **技術指標**: `technicalindicators` (npm)
- **テスト**: Vitest (151 tests)

## セットアップ

### 1. 依存インストール

```fish
# Node.js
npm install

# Python (yfinance-service)
cd yfinance-service
python3 -m venv .venv
source .venv/bin/activate.fish
pip install -r requirements.txt
cd ..
```

### 2. 環境変数

`.env.example` を `.env` にコピーし、値を設定:

| 変数 | 必須 | 説明 |
|---|:---:|---|
| `DATABASE_URL` | ○ | PostgreSQL接続文字列 |
| `YFINANCE_SERVICE_URL` | ○ | yfinance-service URL（デフォルト `http://localhost:8765`）|
| `YFINANCE_PROXY` | | Yahoo Finance レートリミット回避用プロキシ |
| `SIDECAR_SECRET` | | yfinance-service 認証シークレット |

### 3. DB初期化

```fish
npx prisma migrate deploy
```

### 4. 価格データ取得

```fish
# yfinance-service を起動（別ターミナル）
cd yfinance-service
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8765

# バックフィル（10年分）
npm run backfill:prices
```

## 実行方法

### 個別バックテスト

```fish
npm run backtest:donchian
npm run backtest:ma-crossover
npm run backtest:rsi-reversion
npm run backtest:nr7
```

結果は DB の `BacktestRun` テーブル + `reports/backtests/` 配下の Markdown に保存。

### Walk-Forward

```fish
npm run walk-forward:donchian
npm run walk-forward:ma-crossover
npm run walk-forward:rsi-reversion
npm run walk-forward:nr7
```

結果は DB の `WalkForwardRun` テーブル + `reports/walk-forward/` に保存。

### Combined ポートフォリオ

```fish
npm run backtest:combined
```

## ディレクトリ構成

```
src/
├── core/                # 4戦略の実装
│   ├── donchian/
│   ├── ma-crossover/
│   ├── rsi-reversion/
│   └── nr7-breakout/
├── backtest/            # バックテストエンジン + ランナー
├── walk-forward/        # WF最適化 + ロバスト性判定
├── lib/                 # メトリクス・指標・pip-value・相関
├── data/                # 価格ローダー + ペア設定
├── reports/             # Markdownレポート生成
└── types/               # 型定義
scripts/                 # WFランナースクリプト + バックフィル
yfinance-service/        # Python FastAPI サイドカー
prisma/                  # DB スキーマ + マイグレーション
reports/                 # バックテスト/WF レポート出力先
docs/                    # 設計・計画・リサーチ結果
```

## テスト

```fish
npm test         # 全テスト実行
npm run lint     # ESLint
```

## 設計ドキュメント

- [設計ドキュメント](docs/plans/2026-04-23-auto-fx-trader-design.md) — 全体設計、KPI、アーキテクチャ
- [実装プラン](docs/plans/2026-04-23-auto-fx-trader-implementation.md) — 34タスクの詳細
- [リサーチ結果](docs/specs/research-findings.md) — 2026-04-23 実施の検証結果

## ライセンス

Private

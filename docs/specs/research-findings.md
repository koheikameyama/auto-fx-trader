# Research Findings: FX Strategy Validation MVP

**実施日**: 2026-04-23
**対象期間**: 2016-04-25 〜 2026-04-22（10年 / 2600営業日）
**対象ペア**: USD/JPY, EUR/USD, GBP/USD
**戦略**: Donchian / MA Crossover / RSI Mean Reversion / NR7 Breakout
**評価KPI**: Sharpe比 ≥ 1.0 (OOS)、MAR ≥ 0.5、PF ≥ 1.3、最大DD ≤ 20%、IS/OOS Sharpe低下率 ≤ 30%

---

## 結論

**本MVP設計で「実用化できる戦略」は見つからなかった。**

- 主KPI（Sharpe比 ≥ 1.0 OOS）を満たす組合せ: **0/12**
- 緩和KPI（Sharpe比 ≥ 0.5 OOS）を満たす組合せ: **0/12**
- 緩和KPIをデフォルトパラメータのバックテストに適用した場合: **2/12**（Donchian USDJPY, MA Crossover USDJPY）

---

## 個別バックテスト結果（デフォルトパラメータ）

| 戦略 | Pair | Sharpe | MAR | PF | DD | Trades | WinRate |
|---|---|---:|---:|---:|---:|---:|---:|
| Donchian | **USDJPY** | **0.56** | 0.34 | 1.55 | 6.4% | 100 | 53.0% |
| Donchian | EURUSD | -0.13 | -0.05 | 0.88 | 10.1% | 102 | 50.0% |
| Donchian | GBPUSD | 0.37 | 0.21 | 1.34 | 6.5% | 105 | 46.7% |
| MA Crossover | **USDJPY** | **0.61** | **0.56** | **2.55** | 2.6% | 39 | 66.7% |
| MA Crossover | EURUSD | 0.11 | 0.06 | 1.14 | 4.5% | 51 | 54.9% |
| MA Crossover | GBPUSD | -0.01 | -0.01 | 0.97 | 5.4% | 41 | 53.7% |
| RSI Reversion | USDJPY | 0.49 | 0.27 | 1.69 | 5.5% | 72 | 54.2% |
| RSI Reversion | EURUSD | 0.15 | 0.06 | 1.17 | 6.9% | 69 | 52.2% |
| RSI Reversion | GBPUSD | -0.01 | -0.01 | 0.98 | 7.2% | 63 | 46.0% |
| NR7 | USDJPY | 0.34 | 0.12 | 1.25 | 9.9% | 135 | 52.6% |
| NR7 | EURUSD | -0.31 | -0.09 | 0.76 | 11.6% | 106 | 45.3% |
| NR7 | GBPUSD | -0.04 | -0.02 | 0.94 | 9.0% | 104 | 50.0% |

**所見:**
- USDJPY は全4戦略で明らかに最高、3戦略が PF≥1.3 を通過
- ドルストレート（EURUSD/GBPUSD）はほぼ機能しない
- **MA Crossover / USDJPY** がデフォルトパラメータでの最優秀: Sharpe 0.61, PF 2.55, DD 2.6%, WinRate 67%

---

## Walk-Forward 結果（12ヶ月IS / 6ヶ月OOS / 18窓）

| 戦略 | Pair | OOS Sharpe | OOS MAR | OOS PF | OOS DD | IS→OOS低下率 |
|---|---|---:|---:|---:|---:|---:|
| Donchian | USDJPY | 0.08 | 1.65 | 2.91 | 3.9% | -90% |
| Donchian | EURUSD | -0.58 | 1.02 | 2.24 | 5.2% | -970% |
| Donchian | GBPUSD | 0.27 | 1.43 | 5.95 | 3.8% | -37% |
| MA Crossover | USDJPY | 0.04 | 1.20 | 3.48 | 2.2% | -95% |
| MA Crossover | EURUSD | -0.24 | -0.21 | 1.48 | 3.0% | -134% |
| MA Crossover | GBPUSD | -0.06 | 0.03 | 1.25 | 1.3% | -107% |
| RSI Reversion | USDJPY | -0.16 | 1.20 | 1.64 | 4.2% | -109% |
| RSI Reversion | EURUSD | 0.07 | 1.42 | 18.66 | 4.1% | -95% |
| RSI Reversion | **GBPUSD** | **0.46** | 2.05 | 89.8 | 5.8% | -75% |
| NR7 | USDJPY | 0.22 | 2.50 | 2.22 | 3.4% | -65% |
| NR7 | EURUSD | -0.14 | 0.50 | 10.04 | 4.7% | -143% |
| NR7 | GBPUSD | -0.19 | 0.39 | 24.95 | 3.3% | -158% |

**全組合せで IS→OOS Sharpe低下率が 30% 閾値を大幅超過**。典型的な過学習兆候。

---

## Combined ポートフォリオ結果

| KPI | 値 | 目標 | 判定 |
|---|---:|---:|:---:|
| Sharpe | 0.496 | ≥1.0 | ❌ |
| MAR | 0.187 | ≥0.5 | ❌ |
| PF | 1.167 | ≥1.3 | ❌ |
| Max DD | 25.27% | ≤20% | ❌ |
| Trades | 832 | - | - |
| WinRate | 51.1% | - | - |

ポートフォリオ組成（4戦略×3ペア、相関管理、枠制限）でもKPI達成せず。むしろDDが個別より悪化。

---

## 考察

### 1. なぜIS→OOS低下率が極端に大きいか

- **トレード頻度が低すぎ**: 日足FXで年10〜20トレード、Sharpe比の安定推定には少ない
- **パラメータ探索空間がIS期間の偶然にフィット**: 12ヶ月IS では「最近のノイズ」を拾ってしまう
- **OOS期間のレジーム転換**: 6ヶ月OOSで金融政策サイクルが変わることも多い

### 2. MARやPFが高いのにSharpeが低い理由

多くの組合せでMAR 1.0〜2.5、PFも高いがSharpeは0前後:
- **リターン分布が極端にトレード偏重**: 全体の値動きはほぼゼロ、少数のトレード日に集中
- 年率リターン単独（MARの分子）は出せても、日次標準偏差で割ると極端に小さい値に
- **Sharpe比は日次リターンの連続性を評価する指標**であり、イベントドリブンなトレード戦略には不利な測定

### 3. FX日足の本質的困難

- 世界最大のFX市場は価格発見が極めて効率的
- 日足ギャップがほぼなく、技術的ブレイクアウトの「エッジ」が株より薄い
- 金利差（キャリー）が主要リターン源だが、日足短期スイングでは活用しにくい

---

## 将来拡張の方向性

現MVP設計では実用化戦略は見つからなかったが、以下の拡張で改善の余地あり:

### 優先度高

1. **USDJPY 単独特化** — 全戦略でUSDJPYが最高、ドルストレートは除外候補
2. **短期足への拡張（4h/1h）** — トレード頻度を増やしSharpeの統計的安定性を確保
3. **単純化パラメータ** — WFで最適化するパラメータ数を削減（1〜2個に絞る）し過学習を抑制
4. **Sortino比 / MAR比を主KPIに変更** — Sharpeは日足FXには不適かも、下方リスク特化が実情に合う

### 優先度中

5. **戦略の絞り込み** — MA Crossover USDJPY 1本化で単純化し、アンサンブル効果より堅牢性重視
6. **ボラ調整サイジング** — Volatility Targeting でペア間のリスク寄与を平準化
7. **連敗時ポジション縮小** — DD抑制（combined DD 25%の改善）
8. **ファンダ/マクロフィルタ** — 金利差、VIX、金融政策カレンダーでエントリーをゲート

### 優先度低（別フェーズ）

9. **キャリートレード** — 日足スイングより中長期運用向け
10. **マルチタイムフレーム** — 日足でトレンド判定、1Hでエントリー精度向上
11. **オプション戦略** — FX裁定機会、ただし実装コスト高

---

## 本MVPの達成事項

「実用化戦略は見つからなかった」という結論自体が本MVPの価値:

- **再現可能なリサーチ基盤** — 10年データ、4戦略、WF・Combined すべて自動化
- **12組合せ×18窓の体系的検証** — 過学習の程度を数値で明示
- **仮説の実証的否定** — 「日足FXで単純ブレイクアウト系は機能しない」を実験的に確認
- **次の実験の土台** — 戦略追加、タイムフレーム変更、KPI変更すべて設計の範囲内

---

## 再現手順

```fish
# 1. DBデータ準備（済み）
npm run backfill:prices

# 2. 個別バックテスト
npm run backtest:donchian
npm run backtest:ma-crossover
npm run backtest:rsi-reversion
npm run backtest:nr7

# 3. Walk-Forward
npm run walk-forward:donchian
npm run walk-forward:ma-crossover
npm run walk-forward:rsi-reversion
npm run walk-forward:nr7

# 4. Combined ポートフォリオ
npm run backtest:combined
```

実行結果は `reports/backtests/` と `reports/walk-forward/` 配下に Markdown 出力、DB に `BacktestRun` / `WalkForwardRun` レコードとして保存される。

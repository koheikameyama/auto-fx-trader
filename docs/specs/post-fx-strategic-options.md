# Post-FX Strategic Options

**作成日**: 2026-04-28
**位置づけ**: 1h ORB 凍結最終確定後、ユーザーの自動取引リサーチ全体（4リポジトリ）における**次の開発リソース配分**を整理する。本書は意思決定支援ドキュメントであり実装計画ではない。

---

## 現在のポートフォリオ状況

| リポ | 状態 | 直近マイルストーン |
|---|---|---|
| **auto-fx-trader**（本リポ） | 🔒 凍結最終確定 | 1h ORB 失敗、Sortino再評価でも未達 |
| **auto-stock-trader** | ✅ エッジ検証済み | 日本株 gapup/PSC、PF 3+、Calmar目標 ≥ 3 |
| **auto-crypto-trader** | 🟢 **実弾運用中** | Phase 2.1 Micro（¥30,000）、**判定 2026-05-09** |
| **auto-us-stock-trader** | 🚧 開発初期 | データ層完了、バックテスト層が次 |

### 直近11日間の重要イベント

- **2026-05-09**: auto-crypto-trader Phase 2.1 Micro 判定日。PASS なら Phase 2.2 Small（¥100,000）、FAIL なら戦略再考
- crypto はライブ取引中で、観察以外の開発作業は最小限が望ましい時期

---

## 戦略選択肢

### Option A: Crypto 判定待ち + Stock-trader 運用強化

**内容**:
- 2026-05-09 までは crypto を観察、無理に変更しない
- 並行して auto-stock-trader を運用面（自動執行・モニタリング・記録分析）で改善
- 検証済みエッジ（PF 3+）を実運用で確立する方向

**長所**:
- すでに勝てる戦略への投資 = 期待値が最も明確
- Crypto Micro の結果が出るまで、新たな大きな賭けを増やさない（リスク管理）
- 開発コストに対する売上（=トレード収益）期待値が他オプションより高い

**短所**:
- 「探索」要素が薄い、既存の延長
- US 株や他アセットへの長期投資が遅れる

**推定工数**: 2〜3週間で運用基盤整備、その後継続

---

### Option B: US 株バックテスト層構築

**内容**:
- auto-us-stock-trader のバックテスト層を本格構築
- データ層は稼働中なので、戦略実装+検証フローを整える
- 中期的に IBKR / Webull 取引層へ繋ぐ準備

**長所**:
- 米国株は流動性・銘柄数・データ充実度が日本株を上回る
- SPYオプション・先物・extended hours等、応用余地大
- auto-fx-trader / auto-stock-trader で築いたフレームワーク経験が活きる

**短所**:
- 米国市場は機関投資家・HFT競争が激しい（FXほどではないが日本株より厳しい）
- 開発期間が長い（バックテスト層〜取引層で数ヶ月）
- 為替リスク（USD建て口座管理）

**推定工数**: 4〜8週間でバックテスト層MVP、取引層は別フェーズ

---

### Option C: 共通基盤（Walk-Forward / Robustness）の抽出ライブラリ化

**内容**:
- 4リポで重複実装している WF エンジン・KPI計算・コストモデル・WFレポート生成を共通ライブラリに抽出
- npm私有パッケージ or git submodule で各リポから利用
- 新戦略リサーチの初期コストを削減

**長所**:
- リサーチ速度の継続的改善（新戦略のWF検証が数日 → 数時間）
- DRY原則、保守性向上
- auto-fx-trader で得た「ロバスト性検証フレーム」（Sortino追加等）が他リポに即適用可能

**短所**:
- 直接的な売上貢献ではない（メタ作業）
- 抽出時の互換性問題、テスト工数あり
- 各リポで微妙に異なる前提を一般化するコスト

**推定工数**: 2〜3週間で抽出+各リポ統合、長期的に大幅な時短

---

### Option D: FX Phase 1 データソース実装（ロードマップ #2 の継続）

**内容**:
- [future-data-sources-roadmap.md](future-data-sources-roadmap.md) の Phase 1（COT + 金利差）を実装
- 既存FXフレーム上で COT逆張り or 金利差順張り戦略を試す
- 1h ORB と独立した新カテゴリの戦略

**長所**:
- 既存フレームワーク再利用で低コスト
- Phase 1 候補は無料データ + 確立されたファクター
- FX再開の判断材料が得られる

**短所**:
- すでに検証済みエッジ（auto-stock-trader）への投資効率に劣る
- 「FXを諦めない」ことの心理的バイアスを助長
- 週足・日足戦略はトレード頻度低、検証に時間かかる

**推定工数**: 1〜2週間でPhase 1 MVP、効果不明

---

### Option E: 完全 hibernation（休む / オフライン）

**内容**:
- 開発作業を休止、crypto Micro 結果待ち
- 既存運用は最小限のモニタリングのみ
- 5/9 判定後に方針再検討

**長所**:
- 燃え尽き予防
- 判定結果次第で大幅戦略変更の可能性 → 今動くと無駄になる作業もあり得る
- 集中力リセットで次の開発質向上

**短所**:
- 機会損失（ただし11日程度なので限定的）
- 学習慣性が途切れるリスク

**推定工数**: 0（モニタリング除く）

---

## 推奨

### 第一推奨: **Option A（Crypto判定待ち + Stock-trader 運用強化）**

理由:
1. **5/9まで11日のクリティカル期間** — crypto結果が出るまで大きな新規開発は控える
2. **既に検証済みのエッジに投資する**のがリサーチ全体の期待値最大化
3. Stock-trader 運用強化は crypto 結果に依存しない並行作業
4. 5/9 後の方針（crypto拡大 or 別バケットへ振り分け）に柔軟対応できる

### 第二推奨: **Option C（共通基盤抽出）**

A と並行で実施可能。リサーチ全体の長期生産性に効く投資。優先度は A の次。

### 非推奨: Option D

「FXに戻る」心理を後押しする可能性がある。本書 #2 のロードマップでも「Phase 1 を実行する場合の前提条件」として「ユーザーが明示的に承認」を要求しているため、本書執筆時点では推奨しない。

### Option B / E は状況次第

- B（US株）: 中長期では価値ある投資だが、5/9判定後に判断するのが妥当
- E（休む）: 燃え尽き感があるなら有効、無ければ機会損失

---

## 5/9 後の判断分岐

Crypto Phase 2.1 Micro の結果次第で次のアクション:

### Case 1: Crypto PASS
- Phase 2.2 Small (¥100,000) 開始 → crypto 開発リソース増強
- Stock / FX / US はサブプロジェクトに格下げ、または現状維持

### Case 2: Crypto FAIL
- Crypto 戦略再考（Scheme F 探索 or 凍結）
- Stock-trader への投資集中度を上げる
- US 株 or FX ロードマップ #2 の Phase 1 を補助案として検討

---

## 重要な但し書き

本書は**4リポにまたがる戦略判断**を含むため、各リポの CLAUDE.md / ロードマップを読んだ上での提案。実行する場合:

1. ユーザーが Option を選択
2. 選択した Option の詳細プラン作成（各リポの状況に応じて）
3. リポ間の依存関係 / コード共有方針を確認
4. クリティカル期間（〜5/9）は **crypto に影響する変更を加えない** ことを優先

---

## 参考リンク

- [auto-stock-trader CLAUDE.md](file:///Users/kouheikameyama/development/auto-stock-trader/CLAUDE.md)
- [auto-crypto-trader CLAUDE.md](file:///Users/kouheikameyama/development/auto-crypto-trader/CLAUDE.md)
- [auto-us-stock-trader CLAUDE.md](file:///Users/kouheikameyama/development/auto-us-stock-trader/CLAUDE.md)
- [本リポの将来データソースロードマップ](future-data-sources-roadmap.md)
- [1h ORB 凍結結果](orb-1h-experiment-result.md)
- [エグゼクティブサマリ](executive-summary.md)

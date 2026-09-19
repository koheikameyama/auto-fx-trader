// src/demo/donchian-runner.ts
//
// Runs one demo-trading cycle for the frozen Donchian/USDJPY strategy
// against an OANDA practice account. No database — OANDA is the source of
// truth for positions, and Slack is the trade log (src/demo/slack-notifier.ts).
//
// Exit decisions reuse src/backtest/exit-manager.ts's evaluateExit verbatim
// via src/broker/trade-state.ts's replay, so exit semantics match the
// backtest exactly. Entry fill price cannot match the backtest (which fills
// at the signal bar's own close) — that divergence is measured and reported,
// not eliminated. See docs/plans/2026-04-23-auto-fx-trader-design.md and the
// KOH-642 plan for the full rationale.
import { donchianStrategy } from "../core/donchian/index.js";
import { calcPositionUnits } from "../backtest/position-sizer.js";
import { applySpread } from "../backtest/cost-model.js";
import { getPairConfig } from "../data/pair-config.js";
import { pairToInstrument, roundPrice, type OandaClient } from "../broker/oanda-client.js";
import {
  buildTradeId,
  encodeAnchorComment,
  decodeAnchor,
  replayPositionState,
} from "../broker/trade-state.js";
import { withRetry } from "./with-retry.js";
import {
  sendSlack,
  formatEntry,
  formatExit,
  formatStopUpdate,
  formatBrokerClosedTrade,
  formatNoSignal,
  formatStateRestoreMismatch,
  formatErrorAlert,
} from "./slack-notifier.js";
import type { PairSymbol } from "../types/pair.js";

const PAIR: PairSymbol = "USDJPY";
const RISK_RATIO = 0.01;
const CANDLE_COUNT = 120;
const RETRY_OPTS = { retries: 3, intervalMs: 5_000 };

export interface DonchianRunnerDeps {
  oanda: OandaClient;
  dryRun: boolean;
}

function pipSize(pair: PairSymbol): number {
  return getPairConfig(pair).pipDecimals === 2 ? 0.01 : 0.0001;
}

export async function runDemoCycle(deps: DonchianRunnerDeps): Promise<void> {
  const { oanda, dryRun } = deps;
  const instrument = pairToInstrument(PAIR);

  // 1. Account summary — balance is the equity figure fed into sizing,
  //    matching the backtest's `cash` (realized only, no open-position MtM).
  const account = await withRetry(() => oanda.getAccountSummary(), RETRY_OPTS);
  console.log(`Account: balance=${account.balance} ${account.currency}, NAV=${account.nav}`);

  // 2. Recent candles (complete bars only — see OandaClient.getCandles).
  const bars = await withRetry(() => oanda.getCandles(instrument, "D", CANDLE_COUNT), RETRY_OPTS);
  if (bars.length === 0) {
    console.error("No candles returned; skipping cycle");
    await sendSlack({ text: formatErrorAlert("NO_CANDLES", "OANDA returned zero complete candles"), level: "error" });
    return;
  }
  const latestBar = bars[bars.length - 1];
  console.log(`Latest complete bar: ${latestBar.date.toISOString()} close=${latestBar.close}`);

  // calcPositionUnits (src/backtest/position-sizer.ts) expects JPY-denominated
  // equity (matches the backtest's `cash`, always JPY). Convert non-JPY
  // account balances using the USDJPY rate — for PAIR=USDJPY the latest bar
  // close *is* that rate. Any other account currency is out of scope for
  // this MVP (single pair, no cross-rate source) — fail loudly rather than
  // silently mis-sizing.
  let equityJpy: number;
  if (account.currency === "JPY") {
    equityJpy = account.balance;
  } else if (account.currency === "USD") {
    equityJpy = account.balance * latestBar.close;
  } else {
    throw new Error(
      `Unsupported account currency for JPY-based position sizing: ${account.currency} (only JPY and USD accounts are supported for PAIR=USDJPY)`,
    );
  }

  // 3. Recover trades OANDA closed between runs (stopLossOnFill can fire
  //    unattended) so the exit is not silently lost from the trade log.
  const closedRecently = await withRetry(() => oanda.getRecentlyClosedTrades(instrument, 24), RETRY_OPTS);
  for (const closed of closedRecently) {
    console.log(`Broker-side close detected: trade ${closed.id}, realizedPL=${closed.realizedPL}`);
    await sendSlack({
      text: formatBrokerClosedTrade({ pair: PAIR, realizedPL: closed.realizedPL, closeTime: closed.closeTime }),
      level: "info",
    });
  }

  // 4. Reconcile open position against the strategy's exit rules.
  const openTrades = await withRetry(() => oanda.getOpenTrades(instrument), RETRY_OPTS);
  const openTrade = openTrades[0]; // single position at a time, matching backtest semantics

  if (openTrade) {
    const side: "long" | "short" = openTrade.currentUnits >= 0 ? "long" : "short";
    const anchor = decodeAnchor(PAIR, side, openTrade.clientExtensions?.id, openTrade.clientExtensions?.comment);
    if (!anchor) {
      console.error(`Could not decode state anchor for trade ${openTrade.id}`);
      await sendSlack({ text: formatStateRestoreMismatch({ pair: PAIR, tradeId: openTrade.id }), level: "warn" });
      return;
    }

    const replay = replayPositionState(anchor, bars, donchianStrategy.exitConfig);

    if (replay.exit) {
      console.log(`Exit condition met: ${replay.exit.exitReason} @ ${replay.exit.exitPrice}`);
      let filledExitPrice = replay.exit.exitPrice; // theoretical fallback for dry-run / failed close
      if (!dryRun) {
        const result = await oanda.closeTrade(openTrade.id);
        if (result.status !== "FILLED") {
          await sendSlack({ text: formatErrorAlert("CLOSE_FAILED", result.message ?? "unknown"), level: "error" });
          return;
        }
        if (result.filledPrice != null) filledExitPrice = result.filledPrice;
      }
      const pnlPips =
        ((filledExitPrice - anchor.theoreticalEntryPrice) / pipSize(PAIR)) * (side === "long" ? 1 : -1);
      const holdingDays = Math.round(
        (latestBar.date.getTime() - anchor.signalBarDate.getTime()) / 86_400_000,
      );
      await sendSlack({
        text: formatExit({
          dryRun,
          pair: PAIR,
          reason: replay.exit.exitReason,
          exitPrice: filledExitPrice,
          pnlPips,
          pnlJpy: null, // swap/JPY conversion intentionally not replicated here — see plan scope
          holdingDays,
        }),
        level: "info",
      });
      return;
    }

    if (openTrade.stopLossOrderPrice == null) {
      console.error(`Open trade ${openTrade.id} has no stop-loss order attached`);
      await sendSlack({
        text: formatErrorAlert(
          "MISSING_STOP_LOSS",
          `${PAIR} trade ${openTrade.id} has no stopLossOrder — position is unprotected`,
        ),
        level: "warn",
      });
      return;
    }

    const roundedNewSl = roundPrice(instrument, replay.currentSl);
    if (roundedNewSl !== openTrade.stopLossOrderPrice) {
      console.log(`Stop-loss moved: ${openTrade.stopLossOrderPrice} -> ${roundedNewSl}`);
      if (!dryRun) {
        await oanda.modifyTradeStopLoss(openTrade.id, instrument, roundedNewSl);
      }
      await sendSlack({
        text: formatStopUpdate({ dryRun, pair: PAIR, oldSl: openTrade.stopLossOrderPrice, newSl: roundedNewSl }),
        level: "info",
      });
    } else {
      console.log(`Position open, no stop change (SL=${roundedNewSl})`);
    }
    return;
  }

  // 5. No open position — evaluate for a new signal on the latest bar.
  const signals = donchianStrategy.generateSignals(bars, PAIR, donchianStrategy.defaultParams);
  const signal = signals.find((s) => s.date.getTime() === latestBar.date.getTime());
  if (!signal) {
    console.log(formatNoSignal({ pair: PAIR, close: latestBar.close }));
    return;
  }

  const slDistance = donchianStrategy.exitConfig.slAtrMultiplier * signal.atr;
  const slPips = slDistance / pipSize(PAIR);
  const sizeUnits = calcPositionUnits({
    equity: equityJpy,
    riskRatio: RISK_RATIO,
    pair: PAIR,
    slPips,
    usdJpyRate: latestBar.close, // USDJPY: bar close IS the USDJPY rate
  });
  if (sizeUnits <= 0) {
    console.log("Signal found but computed size is zero; skipping entry");
    return;
  }

  const theoreticalEntryPrice = applySpread(PAIR, signal.side, latestBar.close);
  const initialSl = roundPrice(
    instrument,
    signal.side === "long" ? theoreticalEntryPrice - slDistance : theoreticalEntryPrice + slDistance,
  );
  const tradeId = buildTradeId(PAIR, latestBar.date);
  const comment = encodeAnchorComment({ entryAtr: signal.atr, theoreticalEntryPrice });
  const orderUnits = signal.side === "long" ? sizeUnits : -sizeUnits;

  console.log(
    `Signal: ${signal.side} ${PAIR} theoretical=${theoreticalEntryPrice} sl=${initialSl} units=${orderUnits}`,
  );

  if (dryRun) {
    await sendSlack({
      text: formatEntry({
        dryRun: true,
        pair: PAIR,
        side: signal.side,
        units: sizeUnits,
        filledPrice: theoreticalEntryPrice,
        theoreticalPrice: theoreticalEntryPrice,
        stopLoss: initialSl,
        pipSize: pipSize(PAIR),
      }),
      level: "info",
    });
    return;
  }

  const result = await oanda.placeMarketOrder({
    instrument,
    units: orderUnits,
    stopLossPrice: initialSl,
    tradeClientExtensions: { id: tradeId, tag: "donchian", comment },
  });

  if (result.status !== "FILLED" || result.filledPrice == null) {
    await sendSlack({ text: formatErrorAlert("ORDER_FAILED", result.message ?? "unknown"), level: "error" });
    return;
  }

  await sendSlack({
    text: formatEntry({
      dryRun: false,
      pair: PAIR,
      side: signal.side,
      units: sizeUnits,
      filledPrice: result.filledPrice,
      theoreticalPrice: theoreticalEntryPrice,
      stopLoss: initialSl,
      pipSize: pipSize(PAIR),
    }),
    level: "info",
  });
}

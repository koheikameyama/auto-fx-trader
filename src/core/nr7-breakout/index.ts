import { computeATR } from "../../lib/indicators/atr.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { PairSymbol } from "../../types/pair.js";
import { nr7Defaults, type Nr7Params } from "./params.js";

export { nr7Defaults } from "./params.js";
export type { Nr7Params } from "./params.js";

export const nr7BreakoutStrategy: Strategy<Nr7Params> = {
  name: "nr7-breakout",
  defaultParams: nr7Defaults,
  exitConfig: {
    useTrailing: true,
    timeStopDays: 5,
    timeStopMaxDays: 10,
    slAtrMultiplier: 1.0,
    beAtrMultiplier: 0.5,
    trailAtrMultiplier: 1.0,
  },
  generateSignals(
    bars: DailyBar[],
    pair: PairSymbol,
    params: Nr7Params,
  ): EntrySignal[] {
    const atr = computeATR(bars, params.atrPeriod);
    const ranges = bars.map((b) => b.high - b.low);
    const signals: EntrySignal[] = [];
    const { lookback } = params;
    // Need at least `lookback` bars before bar i-1 (inclusive window of size lookback ending at i-1),
    // so i - lookback >= 0 → i >= lookback.
    for (let i = lookback; i < bars.length; i++) {
      const a = atr[i];
      if (a === null) continue;
      const prev = bars[i - 1];
      const prevRange = ranges[i - 1];
      // Window: bars[i - lookback .. i - 1] (size `lookback`, ending at i-1)
      let isNr7 = true;
      for (let j = i - lookback; j < i - 1; j++) {
        if (ranges[j] <= prevRange) {
          isNr7 = false;
          break;
        }
      }
      if (!isNr7) continue;
      const close = bars[i].close;
      if (close > prev.high) {
        signals.push({
          date: bars[i].date,
          pair,
          side: "long",
          entryPrice: close,
          atr: a,
        });
      } else if (close < prev.low) {
        signals.push({
          date: bars[i].date,
          pair,
          side: "short",
          entryPrice: close,
          atr: a,
        });
      }
    }
    return signals;
  },
};

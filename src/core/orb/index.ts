import { computeATR } from "../../lib/indicators/atr.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { PairSymbol } from "../../types/pair.js";
import { orbDefaults, type OrbParams } from "./params.js";

export { orbDefaults } from "./params.js";
export type { OrbParams } from "./params.js";

export const orbStrategy: Strategy<OrbParams> = {
  name: "orb",
  defaultParams: orbDefaults,
  exitConfig: {
    useTrailing: false,
    timeStopDays: 999,
    timeStopMaxDays: 999,
    slAtrMultiplier: 2.5,
    beAtrMultiplier: 999,
    trailAtrMultiplier: 0,
    sessionEndUtcHour: 15,
  },
  generateSignals(
    bars: DailyBar[],
    pair: PairSymbol,
    params: OrbParams,
  ): EntrySignal[] {
    const atr = computeATR(bars, params.atrPeriod);
    const signals: EntrySignal[] = [];

    let currentDay = "";
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    let rangeBarsCollected = 0;
    let sessionFired = false;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const a = atr[i];
      const hour = b.date.getUTCHours();
      const day = b.date.toISOString().slice(0, 10);

      if (day !== currentDay) {
        currentDay = day;
        rangeHigh = -Infinity;
        rangeLow = Infinity;
        rangeBarsCollected = 0;
        sessionFired = false;
      }

      if (hour < params.sessionStartUtcHour || hour >= params.sessionEndUtcHour) continue;
      if (sessionFired) continue;

      if (rangeBarsCollected < params.rangeHours) {
        rangeHigh = Math.max(rangeHigh, b.high);
        rangeLow = Math.min(rangeLow, b.low);
        rangeBarsCollected++;
        continue;
      }

      if (a === null) continue;
      if (b.close > rangeHigh) {
        signals.push({
          date: b.date,
          pair,
          side: "long",
          entryPrice: b.close,
          atr: a,
        });
        sessionFired = true;
      } else if (b.close < rangeLow) {
        signals.push({
          date: b.date,
          pair,
          side: "short",
          entryPrice: b.close,
          atr: a,
        });
        sessionFired = true;
      }
    }
    return signals;
  },
};

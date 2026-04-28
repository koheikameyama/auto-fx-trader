import type { DailyBar } from "./bar.js";
import type { EntrySignal } from "./signal.js";
import type { PairSymbol } from "./pair.js";

export interface ExitConfig {
  useTrailing: boolean;
  timeStopDays: number;
  timeStopMaxDays: number;
  slAtrMultiplier: number;
  beAtrMultiplier: number;
  trailAtrMultiplier: number;
  /**
   * If set, force-close the position when the bar's UTC hour is >= this value.
   * Intended for intraday strategies (e.g. ORB) that must flatten by session end.
   * Leave undefined or null for daily/swing strategies.
   */
  sessionEndUtcHour?: number | null;
}

export interface Strategy<P = Record<string, unknown>> {
  name: string;
  defaultParams: P;
  exitConfig: ExitConfig;
  generateSignals(bars: DailyBar[], pair: PairSymbol, params: P): EntrySignal[];
}

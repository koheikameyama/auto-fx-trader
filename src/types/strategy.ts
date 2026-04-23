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
}

export interface Strategy<P = Record<string, unknown>> {
  name: string;
  defaultParams: P;
  exitConfig: ExitConfig;
  generateSignals(bars: DailyBar[], pair: PairSymbol, params: P): EntrySignal[];
}

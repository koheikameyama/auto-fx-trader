import type { PairSymbol } from "./pair.js";

export type ExitReason = "sl" | "trailing" | "time" | "signal" | "end_of_data";

export interface BacktestTrade {
  pair: PairSymbol;
  strategy: string;
  side: "long" | "short";
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: ExitReason;
  sizeUnits: number;
  pnlPips: number;
  pnlJpy: number;
  holdingDays: number;
}

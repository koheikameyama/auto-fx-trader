import type { PairSymbol } from "./pair.js";

export interface EntrySignal {
  date: Date;
  pair: PairSymbol;
  side: "long" | "short";
  entryPrice: number;
  atr: number;
}

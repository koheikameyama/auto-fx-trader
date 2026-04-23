import type { PairSymbol } from "../types/pair.js";

type Side = "long" | "short";

const HIGH_CORR_PAIRS: Array<[PairSymbol, PairSymbol]> = [["EURUSD", "GBPUSD"]];

export function isHighCorrelation(
  a: PairSymbol,
  sideA: Side,
  b: PairSymbol,
  sideB: Side,
): boolean {
  if (a === b) return false;
  if (sideA !== sideB) return false;
  return HIGH_CORR_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}

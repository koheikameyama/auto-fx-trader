import type { PairSymbol } from "../types/pair.js";
import { getPairConfig } from "../data/pair-config.js";

function pipSize(pair: PairSymbol): number {
  return pair === "USDJPY" ? 0.01 : 0.0001;
}

export function applySpread(
  pair: PairSymbol,
  side: "long" | "short",
  rawPrice: number,
): number {
  const { spreadPips } = getPairConfig(pair);
  const spreadPrice = spreadPips * pipSize(pair);
  return side === "long" ? rawPrice + spreadPrice : rawPrice - spreadPrice;
}

export function calcSwapJpy(
  pair: PairSymbol,
  side: "long" | "short",
  units: number,
  holdingDays: number,
): number {
  if (units === 0 || holdingDays === 0) return 0;
  const { buySwapJpy, sellSwapJpy } = getPairConfig(pair);
  const swapPerDay = side === "long" ? buySwapJpy : sellSwapJpy;
  return (swapPerDay * units * holdingDays) / 10000;
}

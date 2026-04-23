import type { PairSymbol } from "../types/pair.js";

export function pipsToJpy(
  pair: PairSymbol,
  pips: number,
  units: number,
  usdJpyRate: number,
): number {
  if (pair === "USDJPY") {
    return pips * 0.01 * units;
  }
  return pips * 0.0001 * units * usdJpyRate;
}

export function jpyToUnits(
  pair: PairSymbol,
  riskJpy: number,
  slPips: number,
  usdJpyRate: number,
): number {
  if (slPips <= 0) return 0;
  const perUnitLossJpy = pipsToJpy(pair, slPips, 1, usdJpyRate);
  if (perUnitLossJpy <= 0) return 0;
  return riskJpy / perUnitLossJpy;
}

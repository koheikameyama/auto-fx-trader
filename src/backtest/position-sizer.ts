import type { PairSymbol } from "../types/pair.js";
import { jpyToUnits } from "../lib/pip-value.js";

export interface PositionSizerArgs {
  equity: number;
  riskRatio: number;
  pair: PairSymbol;
  slPips: number;
  usdJpyRate: number;
}

export function calcPositionUnits(args: PositionSizerArgs): number {
  if (args.slPips <= 0) return 0;
  if (args.equity <= 0 || args.riskRatio <= 0) return 0;
  const riskJpy = args.equity * args.riskRatio;
  return Math.floor(jpyToUnits(args.pair, riskJpy, args.slPips, args.usdJpyRate));
}

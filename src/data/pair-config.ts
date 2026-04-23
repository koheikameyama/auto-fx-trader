import type { PairSymbol } from "../types/pair.js";

export const PAIRS: PairSymbol[] = ["USDJPY", "EURUSD", "GBPUSD"];

export interface PairConfig {
  symbol: PairSymbol;
  yfinanceTicker: string;
  spreadPips: number;
  buySwapJpy: number;
  sellSwapJpy: number;
  pipDecimals: number;
}

const CONFIGS: Record<PairSymbol, PairConfig> = {
  USDJPY: {
    symbol: "USDJPY",
    yfinanceTicker: "USDJPY=X",
    spreadPips: 0.3,
    buySwapJpy: 100,
    sellSwapJpy: -130,
    pipDecimals: 2,
  },
  EURUSD: {
    symbol: "EURUSD",
    yfinanceTicker: "EURUSD=X",
    spreadPips: 0.3,
    buySwapJpy: -50,
    sellSwapJpy: 30,
    pipDecimals: 4,
  },
  GBPUSD: {
    symbol: "GBPUSD",
    yfinanceTicker: "GBPUSD=X",
    spreadPips: 0.8,
    buySwapJpy: -30,
    sellSwapJpy: 10,
    pipDecimals: 4,
  },
};

export function getPairConfig(pair: PairSymbol): PairConfig {
  return CONFIGS[pair];
}

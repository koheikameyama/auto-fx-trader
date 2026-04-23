import type { PairSymbol } from "../types/pair.js";
import { isHighCorrelation } from "../lib/correlation.js";

export interface OpenPosition {
  pair: PairSymbol;
  strategy: string;
  side: "long" | "short";
}

export interface PortfolioLimits {
  totalMax: number;
  perStrategyMax: number;
  perPairMax: number;
}

export const defaultLimits: PortfolioLimits = {
  totalMax: 6,
  perStrategyMax: 2,
  perPairMax: 2,
};

export type CanOpenReason =
  | "total_limit"
  | "strategy_limit"
  | "pair_limit"
  | "correlation_limit";

export interface CanOpenResult {
  allowed: boolean;
  reason?: CanOpenReason;
}

export class PortfolioManager {
  private readonly limits: PortfolioLimits;

  constructor(limits?: PortfolioLimits) {
    this.limits = limits ?? defaultLimits;
  }

  canOpen(
    candidate: { pair: PairSymbol; strategy: string; side: "long" | "short" },
    openPositions: OpenPosition[],
  ): CanOpenResult {
    // 1. Total limit
    if (openPositions.length >= this.limits.totalMax) {
      return { allowed: false, reason: "total_limit" };
    }

    // 2. Per-strategy limit
    let strategyCount = 0;
    for (const p of openPositions) {
      if (p.strategy === candidate.strategy) strategyCount++;
    }
    if (strategyCount >= this.limits.perStrategyMax) {
      return { allowed: false, reason: "strategy_limit" };
    }

    // 3. Per-pair limit
    let pairCount = 0;
    for (const p of openPositions) {
      if (p.pair === candidate.pair) pairCount++;
    }
    if (pairCount >= this.limits.perPairMax) {
      return { allowed: false, reason: "pair_limit" };
    }

    // 4. Correlation check
    for (const p of openPositions) {
      if (isHighCorrelation(candidate.pair, candidate.side, p.pair, p.side)) {
        return { allowed: false, reason: "correlation_limit" };
      }
    }

    return { allowed: true };
  }
}

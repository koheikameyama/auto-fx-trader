import type { PairSymbol } from "../types/pair.js";
import type { WfAggregate } from "./engine.js";

export interface RobustnessCriteria {
  minSharpe: number;
  minMar: number;
  minPf: number;
  maxDd: number;
  maxSharpeDrop: number;
}

/**
 * FX MVP robustness thresholds (from design doc).
 * A walk-forward result must clear all five bars to be considered robust.
 */
export const defaultRobustness: RobustnessCriteria = {
  minSharpe: 1.0,
  minMar: 0.5,
  minPf: 1.3,
  maxDd: 0.2,
  maxSharpeDrop: 0.3,
};

export interface RobustnessCheck {
  passed: boolean;
  reasons: string[];
}

/**
 * Evaluate a single walk-forward aggregate against the robustness criteria.
 * Returns `passed: true` only when all five thresholds are satisfied; otherwise
 * collects one reason string per failed check.
 */
export function checkRobustness<P>(
  agg: WfAggregate<P>,
  criteria: RobustnessCriteria = defaultRobustness,
): RobustnessCheck {
  const reasons: string[] = [];

  if (agg.oosAvgSharpe < criteria.minSharpe) {
    reasons.push(
      `OOS Sharpe ${agg.oosAvgSharpe.toFixed(3)} < min ${criteria.minSharpe}`,
    );
  }
  if (agg.oosAvgMar < criteria.minMar) {
    reasons.push(
      `OOS MAR ${agg.oosAvgMar.toFixed(3)} < min ${criteria.minMar}`,
    );
  }
  if (agg.oosAvgPf < criteria.minPf) {
    reasons.push(`OOS PF ${agg.oosAvgPf.toFixed(3)} < min ${criteria.minPf}`);
  }
  if (agg.oosMaxDd > criteria.maxDd) {
    reasons.push(
      `OOS Max DD ${(agg.oosMaxDd * 100).toFixed(2)}% > max ${(criteria.maxDd * 100).toFixed(2)}%`,
    );
  }
  if (agg.isOosSharpeDrop > criteria.maxSharpeDrop) {
    reasons.push(
      `IS->OOS Sharpe drop ${(agg.isOosSharpeDrop * 100).toFixed(2)}% > max ${(criteria.maxSharpeDrop * 100).toFixed(2)}%`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Sortino-based robustness criteria (KPI redesign, 2026-04-28).
 *
 * Replaces Sharpe as the primary KPI with Sortino (downside-only volatility
 * penalty), tightens MAR/PF, and adds Sortino stdev as a variance-stability
 * gate. Old `RobustnessCriteria` kept intact for backwards compatibility.
 */
export interface SortinoRobustnessCriteria {
  minSortino: number;
  minMar: number;
  minPf: number;
  maxDd: number;
  maxSortinoDrop: number;
  maxSortinoStdev: number;
  minWinningWindowRate: number;
}

export const sortinoDefaultRobustness: SortinoRobustnessCriteria = {
  minSortino: 0.7,
  minMar: 0.5,
  minPf: 1.3,
  maxDd: 0.15,
  maxSortinoDrop: 0.5,
  maxSortinoStdev: 1.5,
  minWinningWindowRate: 0.6,
};

/**
 * Evaluate a single walk-forward aggregate against the Sortino-based
 * robustness criteria. All seven thresholds must be satisfied to PASS.
 *
 * Winning-window rate is computed from per-window OOS Sortino > 0
 * (a window with non-positive Sortino did not produce profitable risk-adjusted
 * returns on the OOS slice).
 */
export function checkSortinoRobustness<P>(
  agg: WfAggregate<P>,
  criteria: SortinoRobustnessCriteria = sortinoDefaultRobustness,
): RobustnessCheck {
  const reasons: string[] = [];

  if (agg.oosAvgSortino < criteria.minSortino) {
    reasons.push(
      `OOS Sortino ${agg.oosAvgSortino.toFixed(3)} < min ${criteria.minSortino}`,
    );
  }
  if (agg.oosAvgMar < criteria.minMar) {
    reasons.push(
      `OOS MAR ${agg.oosAvgMar.toFixed(3)} < min ${criteria.minMar}`,
    );
  }
  if (agg.oosAvgPf < criteria.minPf) {
    reasons.push(`OOS PF ${agg.oosAvgPf.toFixed(3)} < min ${criteria.minPf}`);
  }
  if (agg.oosMaxDd > criteria.maxDd) {
    reasons.push(
      `OOS Max DD ${(agg.oosMaxDd * 100).toFixed(2)}% > max ${(criteria.maxDd * 100).toFixed(2)}%`,
    );
  }
  if (agg.isOosSortinoDrop > criteria.maxSortinoDrop) {
    reasons.push(
      `IS->OOS Sortino drop ${(agg.isOosSortinoDrop * 100).toFixed(2)}% > max ${(criteria.maxSortinoDrop * 100).toFixed(2)}%`,
    );
  }
  if (agg.oosSortinoStdev > criteria.maxSortinoStdev) {
    reasons.push(
      `OOS Sortino stdev ${agg.oosSortinoStdev.toFixed(3)} > max ${criteria.maxSortinoStdev}`,
    );
  }

  const winningWindows = agg.windows.filter((w) => w.oosSortino > 0).length;
  const winningWindowRate =
    agg.windows.length > 0 ? winningWindows / agg.windows.length : 0;
  if (winningWindowRate < criteria.minWinningWindowRate) {
    reasons.push(
      `OOS winning windows ${(winningWindowRate * 100).toFixed(1)}% < min ${(criteria.minWinningWindowRate * 100).toFixed(1)}%`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Evaluate robustness across all three FX pairs. A strategy "passes" at the
 * portfolio level only when at least `minPassingPairs` (default 2) of the
 * per-pair aggregates satisfy all robustness criteria.
 */
export function checkCrossPairRobustness<P>(
  perPair: Record<PairSymbol, WfAggregate<P>>,
  criteria: RobustnessCriteria = defaultRobustness,
  minPassingPairs = 2,
): {
  passed: boolean;
  passingPairs: PairSymbol[];
  details: Record<PairSymbol, RobustnessCheck>;
} {
  const details = {} as Record<PairSymbol, RobustnessCheck>;
  const passingPairs: PairSymbol[] = [];
  const pairs = Object.keys(perPair) as PairSymbol[];

  for (const pair of pairs) {
    const check = checkRobustness(perPair[pair], criteria);
    details[pair] = check;
    if (check.passed) {
      passingPairs.push(pair);
    }
  }

  return {
    passed: passingPairs.length >= minPassingPairs,
    passingPairs,
    details,
  };
}

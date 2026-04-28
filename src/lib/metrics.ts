const TRADING_DAYS = 252;

export function sharpeRatio(returns: number[], tradingDays = TRADING_DAYS): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(tradingDays);
}

/**
 * Sortino ratio: like Sharpe, but only penalizes downside deviation
 * (returns below the MAR threshold; here MAR = 0).
 *
 * Formula (Sortino & Price 1994, industry-standard):
 *   downsideDeviation = sqrt( sum(min(r, 0)^2) / n )   // n = total returns
 *   sortino = (mean(returns) / downsideDeviation) * sqrt(annualizationFactor)
 *
 * Sparse-data safeguard:
 *   - empty returns -> 0
 *   - no losses     -> 0 (Sortino with no downside observations is undefined /
 *                         degenerately inflated; flagging as 0 is the safe call)
 *   - tiny downside (< 1e-8) -> 0 (avoids Infinity / numerical blow-up)
 */
export function sortinoRatio(
  returns: number[],
  tradingDays = TRADING_DAYS,
): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downsideReturns = returns.filter((r) => r < 0);
  if (downsideReturns.length === 0) {
    // No losses observed: Sortino undefined / inflated. Return 0 to flag
    // "not meaningful" — a real Sortino requires some loss observations.
    return 0;
  }
  // Sum of squared downside deviations divided by TOTAL n (not just losses).
  // This matches the Sortino & Price (1994) convention.
  const downsideVariance =
    downsideReturns.reduce((a, b) => a + b ** 2, 0) / returns.length;
  const downsideStd = Math.sqrt(downsideVariance);
  if (downsideStd < 1e-8) return 0;
  return (mean / downsideStd) * Math.sqrt(tradingDays);
}

export function maxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length <= 1) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak <= 0) continue;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function profitFactor(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  const gains = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = pnls.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function expectancy(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.reduce((a, b) => a + b, 0) / pnls.length;
}

export function marRatio(annualReturnValue: number, maxDd: number): number {
  if (maxDd <= 0) return 0;
  return annualReturnValue / maxDd;
}

export function annualReturn(totalReturn: number, years: number): number {
  if (years <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

export function winRate(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.filter((p) => p > 0).length / pnls.length;
}

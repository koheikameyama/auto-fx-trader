import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import type { ExitConfig } from "../types/strategy.js";

export type ExitOutcome = "sl" | "trailing" | "time" | "session-end" | "none";

export interface PositionState {
  pair: PairSymbol;
  side: "long" | "short";
  entryDate: Date;
  entryPrice: number;
  entryAtr: number;
  units: number;
  currentSl: number;
  highSinceEntry: number;
  lowSinceEntry: number;
  hasBreakEven: boolean;
}

export interface ExitResult {
  exited: boolean;
  exitPrice?: number;
  exitReason?: Exclude<ExitOutcome, "none">;
}

export interface EvaluateResult {
  newState: PositionState;
  exit: ExitResult;
}

/**
 * Evaluate exit conditions for an open position on the current bar.
 *
 * Order of checks (within the bar):
 *   1. Update intra-bar high/low tracking from bar.high / bar.low
 *   2. SL touch check (long: bar.low <= currentSl; short: bar.high >= currentSl) — exit at currentSl price
 *   3. If not exited and !hasBreakEven: BE promotion check — move SL to entryPrice if highSinceEntry ≥ entry + ATR×beMul (long) / lowSinceEntry ≤ entry - ATR×beMul (short)
 *   4. If not exited and useTrailing: trailing SL update — long: newSl = highSinceEntry - ATR×trailMul (only raise, never lower); short: newSl = lowSinceEntry + ATR×trailMul (only lower, never raise)
 *   5. Session-end check — if cfg.sessionEndUtcHour is set and bar.date.getUTCHours() >= cutoff, exit at bar.close (intraday strategies)
 *   6. Time stop check — if daysHeld >= timeStopDays, exit at bar.close
 *
 * IMPORTANT: BE/trail promotion uses the *updated* highSinceEntry/lowSinceEntry for this bar.
 * SL touch uses the OLD currentSl (so a trail updated on the same bar does NOT retroactively cause exit).
 */
export function evaluateExit(
  state: PositionState,
  bar: DailyBar,
  daysHeld: number,
  cfg: ExitConfig,
): EvaluateResult {
  // 1. Update intra-bar high/low tracking
  const highSinceEntry = Math.max(state.highSinceEntry, bar.high);
  const lowSinceEntry = Math.min(state.lowSinceEntry, bar.low);

  // 2. SL touch check — use OLD currentSl to avoid retroactive exits from same-bar trail
  const oldSl = state.currentSl;
  if (state.side === "long" && bar.low <= oldSl) {
    return {
      newState: { ...state, highSinceEntry, lowSinceEntry },
      exit: {
        exited: true,
        exitPrice: oldSl,
        exitReason: state.hasBreakEven ? "trailing" : "sl",
      },
    };
  }
  if (state.side === "short" && bar.high >= oldSl) {
    return {
      newState: { ...state, highSinceEntry, lowSinceEntry },
      exit: {
        exited: true,
        exitPrice: oldSl,
        exitReason: state.hasBreakEven ? "trailing" : "sl",
      },
    };
  }

  // 3. BE promotion
  let currentSl = state.currentSl;
  let hasBreakEven = state.hasBreakEven;
  if (!hasBreakEven) {
    const beOffset = state.entryAtr * cfg.beAtrMultiplier;
    if (state.side === "long" && highSinceEntry >= state.entryPrice + beOffset) {
      currentSl = state.entryPrice;
      hasBreakEven = true;
    } else if (state.side === "short" && lowSinceEntry <= state.entryPrice - beOffset) {
      currentSl = state.entryPrice;
      hasBreakEven = true;
    }
  }

  // 4. Trailing stop (only active after BE promotion)
  if (cfg.useTrailing && hasBreakEven) {
    const trailOffset = state.entryAtr * cfg.trailAtrMultiplier;
    if (state.side === "long") {
      const newSl = highSinceEntry - trailOffset;
      if (newSl > currentSl) currentSl = newSl;
    } else {
      const newSl = lowSinceEntry + trailOffset;
      if (newSl < currentSl) currentSl = newSl;
    }
  }

  // 5. Session-end exit (intraday strategies) — force-close when bar UTC hour reaches the cutoff
  if (cfg.sessionEndUtcHour != null && bar.date.getUTCHours() >= cfg.sessionEndUtcHour) {
    return {
      newState: { ...state, highSinceEntry, lowSinceEntry, currentSl, hasBreakEven },
      exit: {
        exited: true,
        exitPrice: bar.close,
        exitReason: "session-end",
      },
    };
  }

  // 6. Time stop
  if (daysHeld >= cfg.timeStopDays) {
    return {
      newState: { ...state, highSinceEntry, lowSinceEntry, currentSl, hasBreakEven },
      exit: {
        exited: true,
        exitPrice: bar.close,
        exitReason: "time",
      },
    };
  }

  return {
    newState: { ...state, highSinceEntry, lowSinceEntry, currentSl, hasBreakEven },
    exit: { exited: false },
  };
}

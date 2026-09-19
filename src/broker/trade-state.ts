import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import { evaluateExit, type PositionState } from "../backtest/exit-manager.js";
import type { ExitConfig } from "../types/strategy.js";

/**
 * Immutable state we attach to an OANDA Trade at entry time, via
 * `tradeClientExtensions`. We deliberately do NOT persist mutable fields
 * (highSinceEntry, lowSinceEntry, hasBreakEven, currentSl) — they are
 * replayed deterministically from candles on every run instead. This keeps
 * the payload tiny (comment-length limits on OANDA client extensions are not
 * documented) and makes the runner self-healing after a failed write.
 */
export interface DemoTradeAnchor {
  pair: PairSymbol;
  side: "long" | "short";
  /** Date of the signal bar (the bar whose close triggered entry), UTC midnight. */
  signalBarDate: Date;
  /** ATR frozen at entry (backtest semantics: entryAtr never recomputed). */
  entryAtr: number;
  /** Theoretical entry price: signal bar close + spread (see cost-model.applySpread). */
  theoreticalEntryPrice: number;
}

const ID_PREFIX = "donchian";

/** Idempotency key: one entry per (strategy, pair, signal bar). */
export function buildTradeId(pair: PairSymbol, signalBarDate: Date): string {
  const dateStr = signalBarDate.toISOString().slice(0, 10);
  return `${ID_PREFIX}-${pair.toLowerCase()}-${dateStr}`;
}

/** Encodes the anchor into a compact "atr|price" comment string. */
export function encodeAnchorComment(anchor: Pick<DemoTradeAnchor, "entryAtr" | "theoreticalEntryPrice">): string {
  return `${anchor.entryAtr}|${anchor.theoreticalEntryPrice}`;
}

/**
 * Decodes a trade id + comment (as read back from OANDA) into a full anchor.
 * Returns null if either field is malformed (e.g. hand-placed trade with no
 * extensions, or a comment from a future format we don't recognize).
 */
export function decodeAnchor(
  pair: PairSymbol,
  side: "long" | "short",
  tradeId: string | undefined,
  comment: string | undefined,
): DemoTradeAnchor | null {
  if (!tradeId || !comment) return null;
  const idMatch = /^donchian-[a-z]+-(\d{4}-\d{2}-\d{2})$/.exec(tradeId);
  if (!idMatch) return null;
  const signalBarDate = new Date(`${idMatch[1]}T00:00:00Z`);
  if (Number.isNaN(signalBarDate.getTime())) return null;

  const parts = comment.split("|");
  if (parts.length !== 2) return null;
  const entryAtr = Number(parts[0]);
  const theoreticalEntryPrice = Number(parts[1]);
  if (!Number.isFinite(entryAtr) || !Number.isFinite(theoreticalEntryPrice)) return null;

  return { pair, side, signalBarDate, entryAtr, theoreticalEntryPrice };
}

export interface ReplayResult {
  /** Current stop-loss level after replaying every bar since entry. */
  currentSl: number;
  hasBreakEven: boolean;
  /** Set when the replay determines the position should already be closed. */
  exit?: { exitPrice: number; exitReason: "sl" | "trailing" | "time" | "session-end" };
}

/**
 * Replays `evaluateExit` over every closed bar since the signal bar to
 * reconstruct today's stop-loss / break-even state, without persisting any
 * mutable fields. `bars` must be sorted ascending and include the signal bar
 * itself plus every bar after it (the signal bar is used only to seed
 * high/low — it is never exit-evaluated, matching backtest semantics).
 */
export function replayPositionState(
  anchor: DemoTradeAnchor,
  bars: DailyBar[],
  cfg: ExitConfig,
): ReplayResult {
  const signalIdx = bars.findIndex((b) => b.date.getTime() === anchor.signalBarDate.getTime());
  if (signalIdx === -1) {
    throw new Error(
      `replayPositionState: signal bar ${anchor.signalBarDate.toISOString()} not found in supplied bars`,
    );
  }
  const signalBar = bars[signalIdx];
  const slDistance = cfg.slAtrMultiplier * anchor.entryAtr;
  const initialSl =
    anchor.side === "long"
      ? anchor.theoreticalEntryPrice - slDistance
      : anchor.theoreticalEntryPrice + slDistance;

  let state: PositionState = {
    pair: anchor.pair,
    side: anchor.side,
    entryDate: signalBar.date,
    entryPrice: anchor.theoreticalEntryPrice,
    entryAtr: anchor.entryAtr,
    units: 0, // not used by evaluateExit's decision logic
    currentSl: initialSl,
    highSinceEntry: signalBar.high,
    lowSinceEntry: signalBar.low,
    hasBreakEven: false,
  };

  for (let i = signalIdx + 1; i < bars.length; i++) {
    const bar = bars[i];
    const daysHeld = Math.round((bar.date.getTime() - state.entryDate.getTime()) / 86_400_000);
    const { newState, exit } = evaluateExit(state, bar, daysHeld, cfg);
    state = newState;
    if (exit.exited && exit.exitPrice !== undefined && exit.exitReason) {
      return {
        currentSl: state.currentSl,
        hasBreakEven: state.hasBreakEven,
        exit: { exitPrice: exit.exitPrice, exitReason: exit.exitReason },
      };
    }
  }

  return { currentSl: state.currentSl, hasBreakEven: state.hasBreakEven };
}

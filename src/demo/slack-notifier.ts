// Ported from auto-us-stock-trader/src/paper-trading/slack-notifier.ts.
// With no DB in this runner, Slack is the durable trade log — every entry,
// exit, and divergence-from-backtest observation is sent here.
import type { PairSymbol } from "../types/pair.js";

export type Level = "info" | "warn" | "error" | "critical";

export interface SlackMessage {
  text: string;
  level: Level;
}

const COLOR: Record<Level, string> = {
  info: "good",
  warn: "warning",
  error: "danger",
  critical: "danger",
};

export async function sendSlack(msg: SlackMessage): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const prefix =
    msg.level === "critical"
      ? "<!channel> 🚨 "
      : msg.level === "error"
        ? "❌ "
        : msg.level === "warn"
          ? "⚠️ "
          : "✅ ";
  // Top-level text is for notification-center / mobile push previews only.
  // Full multi-line body lives in attachments[].text (Slack double-renders
  // if both are the full text).
  const previewLine = msg.text.split("\n")[0].replace(/\*/g, "");
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: prefix + previewLine,
        attachments: [{ color: COLOR[msg.level], text: msg.text, mrkdwn_in: ["text"] }],
      }),
    });
  } catch {
    // best-effort: a notification failure must never crash the runner
  }
}

function fmtPips(n: number, opts: { signed?: boolean } = {}): string {
  const s = n.toFixed(1);
  if (opts.signed && n >= 0) return `+${s}`;
  return s;
}

function fmtJpy(n: number): string {
  return `${n >= 0 ? "+" : "-"}¥${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function formatEntry(p: {
  dryRun: boolean;
  pair: PairSymbol;
  side: "long" | "short";
  units: number;
  filledPrice: number;
  theoreticalPrice: number;
  stopLoss: number;
  /** Pip size for `pair` (e.g. 0.01 for JPY quotes, 0.0001 otherwise). Caller supplies it so this module has no pair-format knowledge of its own. */
  pipSize: number;
}): string {
  const tag = p.dryRun ? "[DRY RUN] " : "";
  const divergencePips = ((p.filledPrice - p.theoreticalPrice) / p.pipSize) * (p.side === "long" ? 1 : -1);
  return (
    `${tag}*ENTRY* ${p.pair} ${p.side.toUpperCase()} ${p.units} units @ ${p.filledPrice}\n` +
    `理論値: ${p.theoreticalPrice} (乖離: ${fmtPips(divergencePips, { signed: true })} pips) · SL: ${p.stopLoss}`
  );
}

export function formatExit(p: {
  dryRun: boolean;
  pair: PairSymbol;
  reason: "sl" | "trailing" | "time" | "session-end";
  exitPrice: number;
  pnlPips: number;
  pnlJpy: number | null;
  holdingDays: number;
}): string {
  const tag = p.dryRun ? "[DRY RUN] " : "";
  const pnlLine = p.pnlJpy != null ? ` · ${fmtJpy(p.pnlJpy)}` : "";
  return (
    `${tag}*EXIT* ${p.pair} (${p.reason}) @ ${p.exitPrice}\n` +
    `${fmtPips(p.pnlPips, { signed: true })} pips${pnlLine} · 保有 ${p.holdingDays}日`
  );
}

export function formatStopUpdate(p: {
  dryRun: boolean;
  pair: PairSymbol;
  oldSl: number;
  newSl: number;
}): string {
  const tag = p.dryRun ? "[DRY RUN] " : "";
  return `${tag}*STOP UPDATE* ${p.pair}: ${p.oldSl} → ${p.newSl}`;
}

export function formatBrokerClosedTrade(p: { pair: PairSymbol; realizedPL: number; closeTime: string }): string {
  return (
    `*決済検出（OANDA側）* ${p.pair} @ ${p.closeTime}\n` +
    `${fmtJpy(p.realizedPL)}（前回実行の合間に約定していました）`
  );
}

export function formatNoSignal(p: { pair: PairSymbol; close: number }): string {
  return `${p.pair}: シグナルなし（終値 ${p.close}）`;
}

export function formatStateRestoreMismatch(p: { pair: PairSymbol; tradeId: string }): string {
  return `*状態復元エラー* ${p.pair} trade ${p.tradeId}: tradeClientExtensions から state を復元できません`;
}

export function formatErrorAlert(category: string, message: string): string {
  return `*${category}*\n${message}`;
}

export function formatKillSwitch(reason: string): string {
  return `⏸ Kill switch active: ${reason}`;
}

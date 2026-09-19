// src/broker/oanda-client.ts
//
// OANDA v20 REST API client, practice environment ONLY. Used by the demo
// trading runner (src/demo/donchian-runner.ts) to observe a frozen strategy
// on a real (but non-live) account. No production/live host is ever
// accepted — see the constructor guard below.
//
// State (highSinceEntry / hasBreakEven / currentSl) is intentionally not
// stored via this client. We keep only an immutable anchor in
// tradeClientExtensions (see src/broker/trade-state.ts) and replay exits
// from candles on every run.

import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";

export interface OandaClientConfig {
  apiToken: string;
  accountId: string;
  /** Must contain "fxpractice" — practice environment only. */
  baseUrl: string;
  fetchTimeoutMs?: number;
}

export interface OandaAccountSummary {
  balance: number;
  nav: number;
  currency: string;
  marginAvailable: number;
}

export interface OandaTrade {
  id: string;
  instrument: string;
  currentUnits: number;
  price: number;
  openTime: string;
  clientExtensions?: { id?: string; tag?: string; comment?: string };
  stopLossOrderPrice: number | null;
}

export interface OandaClosedTrade {
  id: string;
  instrument: string;
  realizedPL: number;
  closeTime: string;
}

export interface PlaceMarketOrderRequest {
  instrument: string;
  /** Positive = long, negative = short. */
  units: number;
  stopLossPrice: number;
  tradeClientExtensions: { id: string; tag: string; comment: string };
}

export interface OandaOrderResult {
  status: "FILLED" | "REJECTED";
  tradeId?: string;
  filledPrice?: number;
  message?: string;
}

const PAIR_TO_INSTRUMENT: Record<PairSymbol, string> = {
  USDJPY: "USD_JPY",
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  EURJPY: "EUR_JPY",
};

export function pairToInstrument(pair: PairSymbol): string {
  return PAIR_TO_INSTRUMENT[pair];
}

/**
 * OANDA rejects prices with excess decimal precision (PRICE_PRECISION_EXCEEDED).
 * JPY-quote instruments (X_JPY) trade at 3 decimals; everything else at 5.
 * This is a display/precision concern only — pip *size* semantics (0.01 vs
 * 0.0001) are unrelated and live in cost-model.ts / pip-value.ts.
 */
export function pricePrecisionDigits(instrument: string): number {
  return instrument.endsWith("_JPY") ? 3 : 5;
}

export function roundPrice(instrument: string, price: number): number {
  const digits = pricePrecisionDigits(instrument);
  return Number(price.toFixed(digits));
}

function formatPrice(instrument: string, price: number): string {
  return price.toFixed(pricePrecisionDigits(instrument));
}

interface FetchOpts {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}

export class OandaClient {
  private readonly config: Required<OandaClientConfig>;

  constructor(config: OandaClientConfig) {
    if (!config.apiToken || !config.accountId || !config.baseUrl) {
      throw new Error("OandaClient requires apiToken, accountId, and baseUrl in config");
    }
    if (!config.baseUrl.includes("fxpractice")) {
      throw new Error(
        `OandaClient: only the practice environment is permitted (baseUrl must contain "fxpractice"), got: ${config.baseUrl}`,
      );
    }
    this.config = {
      apiToken: config.apiToken,
      accountId: config.accountId,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      fetchTimeoutMs: config.fetchTimeoutMs ?? 10_000,
    };
  }

  async getAccountSummary(): Promise<OandaAccountSummary> {
    const r = await this.request<RawAccountSummaryResponse>(
      `/v3/accounts/${this.config.accountId}/summary`,
    );
    return {
      balance: Number(r.account.balance),
      nav: Number(r.account.NAV),
      currency: r.account.currency,
      marginAvailable: Number(r.account.marginAvailable),
    };
  }

  /**
   * Fetches the most recent `count` candles for `instrument` at the given
   * granularity, using mid prices. Only complete (closed) candles are
   * returned — the current in-progress candle is filtered out, since a
   * strategy must never act on an unclosed bar.
   */
  async getCandles(instrument: string, granularity: "D" | "H1", count: number): Promise<DailyBar[]> {
    const params = new URLSearchParams({
      granularity,
      count: String(count),
      price: "M",
    });
    const r = await this.request<RawCandlesResponse>(
      `/v3/instruments/${instrument}/candles?${params.toString()}`,
    );
    return r.candles
      .filter((c) => c.complete)
      .map((c) => ({
        // OANDA daily candle `time` is stamped at the broker's daily
        // alignment (17:00 NY by default, e.g. "...T21:00:00.000000000Z" /
        // 22:00Z in winter) — not UTC midnight. Normalize to UTC midnight so
        // `date` matches the convention used everywhere else in this repo
        // (src/data/price-loader.ts) and so daysHeld / signal-bar lookups
        // stay exact-integer, collision-free calendar dates.
        date: new Date(`${c.time.slice(0, 10)}T00:00:00Z`),
        open: Number(c.mid.o),
        high: Number(c.mid.h),
        low: Number(c.mid.l),
        close: Number(c.mid.c),
        volume: c.volume ?? null,
      }));
  }

  /** Currently open trades for `instrument`, including client extensions and stop-loss price. */
  async getOpenTrades(instrument: string): Promise<OandaTrade[]> {
    const params = new URLSearchParams({ instrument });
    const r = await this.request<RawTradesResponse>(
      `/v3/accounts/${this.config.accountId}/openTrades?${params.toString()}`,
    );
    return r.trades.map((t) => ({
      id: t.id,
      instrument: t.instrument,
      currentUnits: Number(t.currentUnits),
      price: Number(t.price),
      openTime: t.openTime,
      clientExtensions: t.clientExtensions,
      stopLossOrderPrice: t.stopLossOrder?.price != null ? Number(t.stopLossOrder.price) : null,
    }));
  }

  /** Trades for `instrument` closed within the last `sinceHours` hours. */
  async getRecentlyClosedTrades(instrument: string, sinceHours: number): Promise<OandaClosedTrade[]> {
    const params = new URLSearchParams({ instrument, state: "CLOSED", count: "50" });
    const r = await this.request<RawTradesResponse>(
      `/v3/accounts/${this.config.accountId}/trades?${params.toString()}`,
    );
    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
    return r.trades
      .filter((t) => t.closeTime && new Date(t.closeTime).getTime() >= cutoff)
      .map((t) => ({
        id: t.id,
        instrument: t.instrument,
        realizedPL: Number(t.realizedPL ?? 0),
        closeTime: t.closeTime as string,
      }));
  }

  /** Places a market order with a stop-loss and trade-level client extensions attached at fill. */
  async placeMarketOrder(req: PlaceMarketOrderRequest): Promise<OandaOrderResult> {
    const body = {
      order: {
        type: "MARKET",
        instrument: req.instrument,
        units: String(req.units),
        timeInForce: "FOK",
        positionFill: "DEFAULT",
        stopLossOnFill: { price: formatPrice(req.instrument, req.stopLossPrice) },
        tradeClientExtensions: req.tradeClientExtensions,
      },
    };
    let placed: RawOrderCreateResponse;
    try {
      placed = await this.request<RawOrderCreateResponse>(
        `/v3/accounts/${this.config.accountId}/orders`,
        { method: "POST", body },
      );
    } catch (e) {
      return { status: "REJECTED", message: e instanceof Error ? e.message : String(e) };
    }
    const fill = placed.orderFillTransaction;
    if (!fill) {
      return {
        status: "REJECTED",
        message: placed.orderRejectTransaction?.rejectReason ?? "no fill transaction in response",
      };
    }
    return {
      status: "FILLED",
      tradeId: fill.tradeOpened?.tradeID,
      filledPrice: Number(fill.price),
    };
  }

  /** Updates a trade's stop-loss order (used for break-even / trailing promotion). */
  async modifyTradeStopLoss(tradeId: string, instrument: string, price: number): Promise<void> {
    await this.request<unknown>(
      `/v3/accounts/${this.config.accountId}/trades/${tradeId}/orders`,
      { method: "PUT", body: { stopLoss: { price: formatPrice(instrument, price) } } },
    );
  }

  /** Closes a trade at market. */
  async closeTrade(tradeId: string): Promise<OandaOrderResult> {
    let r: RawTradeCloseResponse;
    try {
      r = await this.request<RawTradeCloseResponse>(
        `/v3/accounts/${this.config.accountId}/trades/${tradeId}/close`,
        { method: "PUT" },
      );
    } catch (e) {
      return { status: "REJECTED", message: e instanceof Error ? e.message : String(e) };
    }
    return {
      status: "FILLED",
      filledPrice: r.orderFillTransaction ? Number(r.orderFillTransaction.price) : undefined,
    };
  }

  private async request<T>(path: string, opts: FetchOpts = {}): Promise<T> {
    const url = `${this.config.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`oanda error: ${res.status} ${text}`);
      }
      return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- Internal raw response shapes --------------------------------------

interface RawAccountSummaryResponse {
  account: { balance: string; NAV: string; currency: string; marginAvailable: string };
}

interface RawCandlesResponse {
  candles: Array<{
    time: string;
    complete: boolean;
    volume?: number | null;
    mid: { o: string; h: string; l: string; c: string };
  }>;
}

interface RawTradesResponse {
  trades: Array<{
    id: string;
    instrument: string;
    currentUnits: string;
    price: string;
    openTime: string;
    closeTime?: string;
    realizedPL?: string;
    clientExtensions?: { id?: string; tag?: string; comment?: string };
    stopLossOrder?: { price?: string };
  }>;
}

interface RawOrderCreateResponse {
  orderFillTransaction?: {
    price: string;
    tradeOpened?: { tradeID: string };
  };
  orderRejectTransaction?: { rejectReason?: string };
}

interface RawTradeCloseResponse {
  orderFillTransaction?: { price: string };
}

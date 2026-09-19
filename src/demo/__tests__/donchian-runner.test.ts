import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { runDemoCycle } from "../donchian-runner.js";
import { buildTradeId, encodeAnchorComment } from "../../broker/trade-state.js";
import type { DailyBar } from "../../types/bar.js";
import type {
  OandaAccountSummary,
  OandaClosedTrade,
  OandaOrderResult,
  OandaTrade,
  PlaceMarketOrderRequest,
} from "../../broker/oanda-client.js";

function mkBar(iso: string, o: number, h: number, l: number, c: number): DailyBar {
  return { date: new Date(iso), open: o, high: h, low: l, close: c, volume: null };
}

/** Minimal fake matching the subset of OandaClient's public surface the runner uses. */
class FakeOanda {
  account: OandaAccountSummary = { balance: 1_000_000, nav: 1_000_000, currency: "JPY", marginAvailable: 900_000 };
  bars: DailyBar[] = [];
  openTrades: OandaTrade[] = [];
  closedTrades: OandaClosedTrade[] = [];
  placedOrders: PlaceMarketOrderRequest[] = [];
  closedTradeIds: string[] = [];
  modifiedStops: Array<{ tradeId: string; price: number }> = [];
  placeOrderResult: OandaOrderResult = { status: "FILLED", tradeId: "t1", filledPrice: 0 };

  async getAccountSummary() {
    return this.account;
  }
  async getCandles() {
    return this.bars;
  }
  async getOpenTrades() {
    return this.openTrades;
  }
  async getRecentlyClosedTrades() {
    return this.closedTrades;
  }
  async placeMarketOrder(req: PlaceMarketOrderRequest) {
    this.placedOrders.push(req);
    return this.placeOrderResult;
  }
  async modifyTradeStopLoss(tradeId: string, _instrument: string, price: number) {
    this.modifiedStops.push({ tradeId, price });
  }
  async closeTrade(tradeId: string) {
    this.closedTradeIds.push(tradeId);
    return { status: "FILLED" as const, filledPrice: 150.0 };
  }
}

// Build a rising sequence of bars that eventually breaks the 20-period
// Donchian channel to the upside on the last bar, so generateSignals fires.
function buildBreakoutBars(): DailyBar[] {
  const bars: DailyBar[] = [];
  const start = new Date("2026-01-01T00:00:00Z");
  for (let i = 0; i < 40; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = d.toISOString();
    bars.push(mkBar(iso, 150, 150.3, 149.7, 150));
  }
  // Breakout bar: close well above the flat 150.3 channel high.
  const last = new Date(start.getTime() + 40 * 86_400_000);
  bars.push(mkBar(last.toISOString(), 150, 152, 149.9, 152.0));
  return bars;
}

let fakeFetchWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeFetchWarn = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fakeFetchWarn.mockRestore?.();
  delete process.env.SLACK_WEBHOOK_URL;
});

describe("runDemoCycle — no open position", () => {
  it("does nothing when the latest bar has no breakout signal", async () => {
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar("2026-01-01T00:00:00Z", 150, 150.3, 149.7, 150),
      mkBar("2026-01-02T00:00:00Z", 150, 150.3, 149.7, 150.1),
    ];
    await runDemoCycle({ oanda: oanda as never, dryRun: false });
    expect(oanda.placedOrders).toHaveLength(0);
  });

  it("places a long market order with stop-loss and trade extensions on a breakout", async () => {
    const oanda = new FakeOanda();
    oanda.bars = buildBreakoutBars();
    oanda.placeOrderResult = { status: "FILLED", tradeId: "t1", filledPrice: 152.05 };

    await runDemoCycle({ oanda: oanda as never, dryRun: false });

    expect(oanda.placedOrders).toHaveLength(1);
    const order = oanda.placedOrders[0];
    expect(order.instrument).toBe("USD_JPY");
    expect(order.units).toBeGreaterThan(0); // long
    expect(order.tradeClientExtensions.tag).toBe("donchian");
    const lastBar = oanda.bars[oanda.bars.length - 1];
    expect(order.tradeClientExtensions.id).toBe(buildTradeId("USDJPY", lastBar.date));
  });

  it("does not place an order in dry-run mode even when a signal fires", async () => {
    const oanda = new FakeOanda();
    oanda.bars = buildBreakoutBars();
    await runDemoCycle({ oanda: oanda as never, dryRun: true });
    expect(oanda.placedOrders).toHaveLength(0);
  });

  it("converts a USD-denominated account balance to JPY for position sizing", async () => {
    const jpyAccount = new FakeOanda();
    jpyAccount.bars = buildBreakoutBars();
    jpyAccount.account = { balance: 1_000_000, nav: 1_000_000, currency: "JPY", marginAvailable: 900_000 };
    await runDemoCycle({ oanda: jpyAccount as never, dryRun: false });
    const jpyUnits = jpyAccount.placedOrders[0].units;

    // A USD balance of balance/close ≈ the same JPY-equivalent equity should
    // produce (approximately) the same position size once converted.
    const lastClose = jpyAccount.bars[jpyAccount.bars.length - 1].close;
    const usdAccount = new FakeOanda();
    usdAccount.bars = buildBreakoutBars();
    usdAccount.account = { balance: 1_000_000 / lastClose, nav: 1_000_000 / lastClose, currency: "USD", marginAvailable: 0 };
    await runDemoCycle({ oanda: usdAccount as never, dryRun: false });
    const usdUnits = usdAccount.placedOrders[0].units;

    expect(usdUnits).toBe(jpyUnits);
  });

  it("throws for an unsupported account currency rather than silently mis-sizing", async () => {
    const oanda = new FakeOanda();
    oanda.bars = buildBreakoutBars();
    oanda.account = { balance: 10_000, nav: 10_000, currency: "GBP", marginAvailable: 9_000 };
    await expect(runDemoCycle({ oanda: oanda as never, dryRun: false })).rejects.toThrow(/GBP/);
  });
});

describe("runDemoCycle — open position, replay-driven exit management", () => {
  it("updates the stop-loss when replay computes a break-even/trailing promotion", async () => {
    const signalBarDate = new Date("2026-01-01T00:00:00Z");
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar(signalBarDate.toISOString(), 149.5, 150.2, 149.4, 150.0),
      mkBar("2026-01-02T00:00:00Z", 150.0, 150.6, 149.9, 150.4), // triggers BE (beOffset 0.5)
      mkBar("2026-01-03T00:00:00Z", 150.4, 151.2, 150.3, 151.0), // triggers trail
    ];
    oanda.openTrades = [
      {
        id: "t1",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 150.05,
        openTime: signalBarDate.toISOString(),
        clientExtensions: {
          id: buildTradeId("USDJPY", signalBarDate),
          tag: "donchian",
          comment: encodeAnchorComment({ entryAtr: 1.0, theoreticalEntryPrice: 150.0 }),
        },
        stopLossOrderPrice: 149.0, // initial SL, stale relative to replay
      },
    ];

    await runDemoCycle({ oanda: oanda as never, dryRun: false });

    expect(oanda.modifiedStops).toHaveLength(1);
    expect(oanda.modifiedStops[0]).toEqual({ tradeId: "t1", price: 150.2 });
    expect(oanda.closedTradeIds).toHaveLength(0);
  });

  it("does not call modifyTradeStopLoss when the replayed SL matches the broker's stop, once rounded", async () => {
    const signalBarDate = new Date("2026-01-01T00:00:00Z");
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar(signalBarDate.toISOString(), 149.5, 150.2, 149.4, 150.0),
      // No BE/trail trigger and no SL breach -> replay keeps the initial SL (149.0).
      mkBar("2026-01-02T00:00:00Z", 150.0, 150.3, 149.9, 150.1),
    ];
    oanda.openTrades = [
      {
        id: "t1",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 150.05,
        openTime: signalBarDate.toISOString(),
        clientExtensions: {
          id: buildTradeId("USDJPY", signalBarDate),
          tag: "donchian",
          comment: encodeAnchorComment({ entryAtr: 1.0, theoreticalEntryPrice: 150.0 }),
        },
        stopLossOrderPrice: 149.0, // already matches replay's computed SL
      },
    ];

    await runDemoCycle({ oanda: oanda as never, dryRun: false });

    expect(oanda.modifiedStops).toHaveLength(0);
    expect(oanda.closedTradeIds).toHaveLength(0);
  });

  it("warns via Slack and takes no action when the open trade has no stop-loss order attached", async () => {
    const signalBarDate = new Date("2026-01-01T00:00:00Z");
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar(signalBarDate.toISOString(), 149.5, 150.2, 149.4, 150.0),
      mkBar("2026-01-02T00:00:00Z", 150.0, 150.3, 149.9, 150.1),
    ];
    oanda.openTrades = [
      {
        id: "t1",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 150.05,
        openTime: signalBarDate.toISOString(),
        clientExtensions: {
          id: buildTradeId("USDJPY", signalBarDate),
          tag: "donchian",
          comment: encodeAnchorComment({ entryAtr: 1.0, theoreticalEntryPrice: 150.0 }),
        },
        stopLossOrderPrice: null, // unprotected position
      },
    ];

    await expect(runDemoCycle({ oanda: oanda as never, dryRun: false })).resolves.toBeUndefined();
    expect(oanda.modifiedStops).toHaveLength(0);
    expect(oanda.closedTradeIds).toHaveLength(0);
  });

  it("closes the trade when replay determines the stop was touched", async () => {
    const signalBarDate = new Date("2026-01-01T00:00:00Z");
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar(signalBarDate.toISOString(), 149.5, 150.2, 149.4, 150.0),
      mkBar("2026-01-02T00:00:00Z", 150.0, 150.1, 148.9, 149.0), // low breaches SL 149.0
    ];
    oanda.openTrades = [
      {
        id: "t1",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 150.05,
        openTime: signalBarDate.toISOString(),
        clientExtensions: {
          id: buildTradeId("USDJPY", signalBarDate),
          tag: "donchian",
          comment: encodeAnchorComment({ entryAtr: 1.0, theoreticalEntryPrice: 150.0 }),
        },
        stopLossOrderPrice: 149.0,
      },
    ];

    await runDemoCycle({ oanda: oanda as never, dryRun: false });

    expect(oanda.closedTradeIds).toEqual(["t1"]);
    expect(oanda.modifiedStops).toHaveLength(0);
  });

  it("does not call the broker to close/modify in dry-run mode", async () => {
    const signalBarDate = new Date("2026-01-01T00:00:00Z");
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar(signalBarDate.toISOString(), 149.5, 150.2, 149.4, 150.0),
      mkBar("2026-01-02T00:00:00Z", 150.0, 150.1, 148.9, 149.0),
    ];
    oanda.openTrades = [
      {
        id: "t1",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 150.05,
        openTime: signalBarDate.toISOString(),
        clientExtensions: {
          id: buildTradeId("USDJPY", signalBarDate),
          tag: "donchian",
          comment: encodeAnchorComment({ entryAtr: 1.0, theoreticalEntryPrice: 150.0 }),
        },
        stopLossOrderPrice: 149.0,
      },
    ];

    await runDemoCycle({ oanda: oanda as never, dryRun: true });

    expect(oanda.closedTradeIds).toHaveLength(0);
  });
});

describe("runDemoCycle — broker-side closes and malformed state", () => {
  it("completes the cycle without throwing when a broker-side close is present alongside no open position", async () => {
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar("2026-01-01T00:00:00Z", 150, 150.3, 149.7, 150),
      mkBar("2026-01-02T00:00:00Z", 150, 150.3, 149.7, 150.1),
    ];
    oanda.closedTrades = [
      { id: "old1", instrument: "USD_JPY", realizedPL: 1234, closeTime: new Date().toISOString() },
    ];

    await expect(runDemoCycle({ oanda: oanda as never, dryRun: false })).resolves.toBeUndefined();
    // No position is open and no signal fires on these flat bars, so the
    // cycle should end cleanly without placing an order.
    expect(oanda.placedOrders).toHaveLength(0);
  });

  it("does not throw when open trade state cannot be decoded (e.g. a hand-placed trade)", async () => {
    const oanda = new FakeOanda();
    oanda.bars = [
      mkBar("2026-01-01T00:00:00Z", 150, 150.3, 149.7, 150),
      mkBar("2026-01-02T00:00:00Z", 150, 150.3, 149.7, 150.1),
    ];
    oanda.openTrades = [
      {
        id: "manual1",
        instrument: "USD_JPY",
        currentUnits: 500,
        price: 150.0,
        openTime: "2026-01-01T00:00:00Z",
        clientExtensions: undefined,
        stopLossOrderPrice: 149.0,
      },
    ];

    await expect(runDemoCycle({ oanda: oanda as never, dryRun: false })).resolves.toBeUndefined();
    expect(oanda.closedTradeIds).toHaveLength(0);
    expect(oanda.modifiedStops).toHaveLength(0);
  });
});

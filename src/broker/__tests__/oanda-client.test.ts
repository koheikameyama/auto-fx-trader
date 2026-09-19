import { describe, it, expect, vi, afterEach } from "vitest";
import { OandaClient, pairToInstrument } from "../oanda-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkConfig(overrides: Partial<{ baseUrl: string }> = {}) {
  return {
    apiToken: "test-token",
    accountId: "001-001-0000000-001",
    baseUrl: overrides.baseUrl ?? "https://api-fxpractice.oanda.com",
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("OandaClient constructor", () => {
  it("throws if baseUrl is not the practice environment", () => {
    expect(() => new OandaClient(mkConfig({ baseUrl: "https://api-fxtrade.oanda.com" }))).toThrow(
      /practice/,
    );
  });

  it("throws if required config is missing", () => {
    expect(() => new OandaClient({ apiToken: "", accountId: "a", baseUrl: "https://api-fxpractice.oanda.com" })).toThrow();
  });

  it("accepts a practice baseUrl", () => {
    expect(() => new OandaClient(mkConfig())).not.toThrow();
  });
});

describe("pairToInstrument", () => {
  it("maps PairSymbol to OANDA instrument names", () => {
    expect(pairToInstrument("USDJPY")).toBe("USD_JPY");
    expect(pairToInstrument("EURUSD")).toBe("EUR_USD");
  });
});

describe("OandaClient.getAccountSummary", () => {
  it("parses balance, NAV, currency, marginAvailable", async () => {
    mockFetchOnce(200, {
      account: { balance: "100000.00", NAV: "100250.50", currency: "USD", marginAvailable: "98000.00" },
    });
    const client = new OandaClient(mkConfig());
    const summary = await client.getAccountSummary();
    expect(summary).toEqual({ balance: 100000, nav: 100250.5, currency: "USD", marginAvailable: 98000 });
  });

  it("throws with status and body on a non-ok response", async () => {
    mockFetchOnce(401, { errorMessage: "Invalid token" });
    const client = new OandaClient(mkConfig());
    await expect(client.getAccountSummary()).rejects.toThrow(/oanda error: 401/);
  });
});

describe("OandaClient.getCandles", () => {
  it("filters out incomplete candles and maps mid OHLC to DailyBar", async () => {
    // Real OANDA daily candles are stamped at the broker's daily alignment
    // (17:00 NY -> 21:00Z or 22:00Z depending on DST), not UTC midnight.
    mockFetchOnce(200, {
      candles: [
        { time: "2026-04-20T21:00:00.000000000Z", complete: true, volume: 1200, mid: { o: "154.00", h: "154.50", l: "153.80", c: "154.30" } },
        { time: "2026-04-21T21:00:00.000000000Z", complete: false, volume: 300, mid: { o: "154.30", h: "154.40", l: "154.10", c: "154.20" } },
      ],
    });
    const client = new OandaClient(mkConfig());
    const bars = await client.getCandles("USD_JPY", "D", 2);
    expect(bars).toHaveLength(1);
    expect(bars[0].open).toBe(154.0);
    expect(bars[0].close).toBe(154.3);
    expect(bars[0].volume).toBe(1200);
  });

  it("normalizes the candle's daily-alignment timestamp to UTC midnight", async () => {
    // This is the exact convention used by src/data/price-loader.ts, and it
    // is what makes trade-state.ts's signal-bar-date lookup and daysHeld
    // integer-exact — without it, replayPositionState's findIndex would
    // never match and the runner would throw on the very next run.
    mockFetchOnce(200, {
      candles: [
        { time: "2026-04-20T21:00:00.000000000Z", complete: true, mid: { o: "154.00", h: "154.50", l: "153.80", c: "154.30" } },
      ],
    });
    const client = new OandaClient(mkConfig());
    const bars = await client.getCandles("USD_JPY", "D", 1);
    expect(bars[0].date.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });
});

describe("OandaClient.getOpenTrades", () => {
  it("maps trade fields and extracts stopLossOrder price", async () => {
    mockFetchOnce(200, {
      trades: [
        {
          id: "123",
          instrument: "USD_JPY",
          currentUnits: "1000",
          price: "154.30",
          openTime: "2026-04-20T00:00:00Z",
          clientExtensions: { id: "donchian-usdjpy-2026-04-20", tag: "donchian", comment: "0.85|154.35" },
          stopLossOrder: { price: "153.50" },
        },
      ],
    });
    const client = new OandaClient(mkConfig());
    const trades = await client.getOpenTrades("USD_JPY");
    expect(trades).toEqual([
      {
        id: "123",
        instrument: "USD_JPY",
        currentUnits: 1000,
        price: 154.3,
        openTime: "2026-04-20T00:00:00Z",
        clientExtensions: { id: "donchian-usdjpy-2026-04-20", tag: "donchian", comment: "0.85|154.35" },
        stopLossOrderPrice: 153.5,
      },
    ]);
  });

  it("returns null stopLossOrderPrice when no stop-loss order is attached", async () => {
    mockFetchOnce(200, {
      trades: [
        { id: "1", instrument: "USD_JPY", currentUnits: "1000", price: "154.3", openTime: "2026-04-20T00:00:00Z" },
      ],
    });
    const client = new OandaClient(mkConfig());
    const trades = await client.getOpenTrades("USD_JPY");
    expect(trades[0].stopLossOrderPrice).toBeNull();
  });
});

describe("OandaClient.getRecentlyClosedTrades", () => {
  it("filters trades closed within the lookback window", async () => {
    const now = Date.now();
    const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const old = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    mockFetchOnce(200, {
      trades: [
        { id: "1", instrument: "USD_JPY", currentUnits: "0", price: "154.3", openTime: "2026-04-18T00:00:00Z", closeTime: recent, realizedPL: "1250.5" },
        { id: "2", instrument: "USD_JPY", currentUnits: "0", price: "153.0", openTime: "2026-04-10T00:00:00Z", closeTime: old, realizedPL: "-300" },
      ],
    });
    const client = new OandaClient(mkConfig());
    const closed = await client.getRecentlyClosedTrades("USD_JPY", 24);
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe("1");
    expect(closed[0].realizedPL).toBe(1250.5);
  });
});

describe("OandaClient.placeMarketOrder", () => {
  it("sends tradeClientExtensions and stopLossOnFill, returns FILLED on success", async () => {
    const fetchMock = mockFetchOnce(201, {
      orderFillTransaction: { price: "154.32", tradeOpened: { tradeID: "456" } },
    });
    const client = new OandaClient(mkConfig());
    const result = await client.placeMarketOrder({
      instrument: "USD_JPY",
      units: 1000,
      stopLossPrice: 153.5,
      tradeClientExtensions: { id: "donchian-usdjpy-2026-04-20", tag: "donchian", comment: "0.85|154.35" },
    });
    expect(result).toEqual({ status: "FILLED", tradeId: "456", filledPrice: 154.32 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.order.type).toBe("MARKET");
    expect(body.order.units).toBe("1000");
    expect(body.order.stopLossOnFill.price).toBe("153.500"); // JPY quote: 3 decimals
    expect(body.order.tradeClientExtensions.id).toBe("donchian-usdjpy-2026-04-20");
  });

  it("returns REJECTED with the reject reason when the order is rejected", async () => {
    mockFetchOnce(201, { orderRejectTransaction: { rejectReason: "INSUFFICIENT_MARGIN" } });
    const client = new OandaClient(mkConfig());
    const result = await client.placeMarketOrder({
      instrument: "USD_JPY",
      units: 1000,
      stopLossPrice: 153.5,
      tradeClientExtensions: { id: "x", tag: "donchian", comment: "1|150" },
    });
    expect(result.status).toBe("REJECTED");
    expect(result.message).toBe("INSUFFICIENT_MARGIN");
  });

  it("returns REJECTED (not a throw) when the HTTP request itself fails", async () => {
    mockFetchOnce(400, { errorMessage: "bad request" });
    const client = new OandaClient(mkConfig());
    const result = await client.placeMarketOrder({
      instrument: "USD_JPY",
      units: 1000,
      stopLossPrice: 153.5,
      tradeClientExtensions: { id: "x", tag: "donchian", comment: "1|150" },
    });
    expect(result.status).toBe("REJECTED");
    expect(result.message).toMatch(/oanda error: 400/);
  });
});

describe("OandaClient.modifyTradeStopLoss", () => {
  it("PUTs the new stop-loss price to the trade orders endpoint, rounded to instrument precision", async () => {
    const fetchMock = mockFetchOnce(200, {});
    const client = new OandaClient(mkConfig());
    await client.modifyTradeStopLoss("456", "USD_JPY", 154.0);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/trades/456/orders");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.stopLoss.price).toBe("154.000"); // JPY quote: 3 decimals
  });

  it("formats a non-JPY instrument at 5 decimals", async () => {
    const fetchMock = mockFetchOnce(200, {});
    const client = new OandaClient(mkConfig());
    await client.modifyTradeStopLoss("456", "EUR_USD", 1.085);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.stopLoss.price).toBe("1.08500");
  });
});

describe("OandaClient.closeTrade", () => {
  it("PUTs to the close endpoint and returns the fill price", async () => {
    mockFetchOnce(200, { orderFillTransaction: { price: "153.48" } });
    const client = new OandaClient(mkConfig());
    const result = await client.closeTrade("456");
    expect(result).toEqual({ status: "FILLED", filledPrice: 153.48 });
  });

  it("returns REJECTED (not a throw) on failure", async () => {
    mockFetchOnce(404, { errorMessage: "trade not found" });
    const client = new OandaClient(mkConfig());
    const result = await client.closeTrade("999");
    expect(result.status).toBe("REJECTED");
  });
});

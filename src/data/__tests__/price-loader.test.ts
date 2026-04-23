import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchFxDaily, fetchFxIntraday } from "../price-loader.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SIDECAR_SECRET;
  delete process.env.YFINANCE_SERVICE_URL;
});

describe("fetchFxDaily", () => {
  it("parses yfinance-service response into DailyBar[]", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticker: "USDJPY=X",
        bars: [
          { date: "2024-01-02", open: 141.5, high: 142, low: 141, close: 141.8, volume: 0 },
          { date: "2024-01-03", open: 141.8, high: 142.5, low: 141.6, close: 142.3, volume: null },
        ],
      }),
    }) as unknown as typeof fetch;

    const bars = await fetchFxDaily("USDJPY", "2024-01-01", "2024-02-01");

    expect(bars.length).toBe(2);
    expect(bars[0].date).toBeInstanceOf(Date);
    expect(bars[0].date.toISOString().slice(0, 10)).toBe("2024-01-02");
    expect(bars[0].open).toBe(141.5);
    expect(bars[0].close).toBe(141.8);
    expect(bars[0].volume).toBe(0);
    expect(bars[1].volume).toBeNull();
  });

  it("returns empty array when service returns empty bars", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "EURUSD=X", bars: [] }),
    }) as unknown as typeof fetch;

    const bars = await fetchFxDaily("EURUSD", "2024-01-01", "2024-02-01");
    expect(bars).toEqual([]);
  });

  it("throws when service returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    }) as unknown as typeof fetch;

    await expect(fetchFxDaily("GBPUSD", "2024-01-01", "2024-02-01")).rejects.toThrow(/429/);
  });

  it("uses correct yfinance ticker for each pair", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "EURUSD=X", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxDaily("EURUSD", "2024-01-01", "2024-02-01");

    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? "") as string;
    expect(calledUrl).toContain("ticker=EURUSD%3DX");
    expect(calledUrl).toContain("start=2024-01-01");
    expect(calledUrl).toContain("end=2024-02-01");
  });

  it("uses YFINANCE_SERVICE_URL env var when set", async () => {
    process.env.YFINANCE_SERVICE_URL = "http://custom-host:9999";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "USDJPY=X", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxDaily("USDJPY", "2024-01-01", "2024-02-01");

    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? "") as string;
    expect(calledUrl.startsWith("http://custom-host:9999/")).toBe(true);
  });

  it("sends x-api-key header when SIDECAR_SECRET is set", async () => {
    process.env.SIDECAR_SECRET = "s3cr3t";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "USDJPY=X", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxDaily("USDJPY", "2024-01-01", "2024-02-01");

    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("s3cr3t");
  });

  it("omits x-api-key when SIDECAR_SECRET is not set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "USDJPY=X", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxDaily("USDJPY", "2024-01-01", "2024-02-01");

    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBeUndefined();
  });
});

describe("fetchFxIntraday", () => {
  it("parses intraday response into IntradayBar[] with timeframe='1h'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticker: "USDJPY=X",
        interval: "1h",
        bars: [
          { datetime: "2024-06-03T00:00:00Z", open: 155.0, high: 155.2, low: 154.9, close: 155.1, volume: 0 },
          { datetime: "2024-06-03T01:00:00Z", open: 155.1, high: 155.3, low: 155.0, close: 155.25, volume: null },
        ],
      }),
    }) as unknown as typeof fetch;

    const bars = await fetchFxIntraday("USDJPY", "1h", "2024-06-01", "2024-06-10");

    expect(bars.length).toBe(2);
    expect(bars[0].datetime).toBeInstanceOf(Date);
    expect(bars[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(bars[0].timeframe).toBe("1h");
    expect(bars[0].close).toBe(155.1);
    expect(bars[0].volume).toBe(0);
    expect(bars[1].volume).toBeNull();
  });

  it("URL contains interval and date params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticker: "USDJPY=X", interval: "1h", bars: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchFxIntraday("USDJPY", "1h", "2024-06-01", "2024-06-10");

    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? "") as string;
    expect(calledUrl).toContain("ticker=USDJPY%3DX");
    expect(calledUrl).toContain("interval=1h");
    expect(calledUrl).toContain("start=2024-06-01");
    expect(calledUrl).toContain("end=2024-06-10");
  });

  it("throws when service returns non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Unsupported interval",
    }) as unknown as typeof fetch;

    await expect(fetchFxIntraday("USDJPY", "1h", "2024-06-01", "2024-06-10")).rejects.toThrow(/400/);
  });
});

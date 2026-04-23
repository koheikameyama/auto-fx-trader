import { describe, it, expect } from "vitest";
import { getPairConfig, PAIRS } from "../pair-config.js";

describe("pair-config", () => {
  it("returns all 3 pairs in order USDJPY, EURUSD, GBPUSD", () => {
    expect(PAIRS).toEqual(["USDJPY", "EURUSD", "GBPUSD"]);
  });

  it("returns config for USDJPY", () => {
    const cfg = getPairConfig("USDJPY");
    expect(cfg.symbol).toBe("USDJPY");
    expect(cfg.yfinanceTicker).toBe("USDJPY=X");
    expect(cfg.spreadPips).toBe(0.3);
    expect(cfg.buySwapJpy).toBeGreaterThan(0);
    expect(cfg.sellSwapJpy).toBeLessThan(0);
    expect(cfg.pipDecimals).toBe(2);
  });

  it("returns config for EURUSD with 4-digit pip decimals", () => {
    const cfg = getPairConfig("EURUSD");
    expect(cfg.pipDecimals).toBe(4);
    expect(cfg.yfinanceTicker).toBe("EURUSD=X");
  });

  it("returns config for GBPUSD", () => {
    const cfg = getPairConfig("GBPUSD");
    expect(cfg.spreadPips).toBe(0.8);
    expect(cfg.pipDecimals).toBe(4);
  });
});

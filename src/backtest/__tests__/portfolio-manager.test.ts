import { describe, it, expect } from "vitest";
import {
  PortfolioManager,
  type OpenPosition,
} from "../portfolio-manager.js";

describe("PortfolioManager.canOpen", () => {
  it("allows first position", () => {
    const pm = new PortfolioManager();
    const res = pm.canOpen(
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      [],
    );
    expect(res.allowed).toBe(true);
  });

  it("rejects when total limit reached", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      { pair: "USDJPY", strategy: "ma-crossover", side: "short" },
      { pair: "EURUSD", strategy: "donchian", side: "long" },
      { pair: "EURUSD", strategy: "rsi-reversion", side: "short" },
      { pair: "GBPUSD", strategy: "nr7-breakout", side: "long" },
      { pair: "GBPUSD", strategy: "ma-crossover", side: "short" },
    ];
    const res = pm.canOpen(
      { pair: "USDJPY", strategy: "nr7-breakout", side: "long" },
      open,
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("total_limit");
  });

  it("rejects when per-strategy limit reached", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      { pair: "EURUSD", strategy: "donchian", side: "short" },
    ];
    const res = pm.canOpen(
      { pair: "GBPUSD", strategy: "donchian", side: "long" },
      open,
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("strategy_limit");
  });

  it("rejects when per-pair limit reached", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      { pair: "USDJPY", strategy: "ma-crossover", side: "short" },
    ];
    const res = pm.canOpen(
      { pair: "USDJPY", strategy: "nr7-breakout", side: "long" },
      open,
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("pair_limit");
  });

  it("rejects correlated: EURUSD long + GBPUSD long", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "EURUSD", strategy: "donchian", side: "long" },
    ];
    const res = pm.canOpen(
      { pair: "GBPUSD", strategy: "ma-crossover", side: "long" },
      open,
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("correlation_limit");
  });

  it("allows opposite-sided same-corr-group (EURUSD long + GBPUSD short)", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "EURUSD", strategy: "donchian", side: "long" },
    ];
    const res = pm.canOpen(
      { pair: "GBPUSD", strategy: "ma-crossover", side: "short" },
      open,
    );
    expect(res.allowed).toBe(true);
  });

  it("allows USDJPY alongside EURUSD (independent pairs)", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "EURUSD", strategy: "donchian", side: "long" },
    ];
    const res = pm.canOpen(
      { pair: "USDJPY", strategy: "ma-crossover", side: "long" },
      open,
    );
    expect(res.allowed).toBe(true);
  });

  it("respects custom limits", () => {
    const pm = new PortfolioManager({
      totalMax: 2,
      perStrategyMax: 10,
      perPairMax: 10,
    });
    const open: OpenPosition[] = [
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      { pair: "EURUSD", strategy: "ma-crossover", side: "short" },
    ];
    const res = pm.canOpen(
      { pair: "GBPUSD", strategy: "nr7-breakout", side: "long" },
      open,
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("total_limit");
  });

  it("enforcement order: total > strategy > pair > correlation", () => {
    const pm = new PortfolioManager();
    const open: OpenPosition[] = [
      { pair: "USDJPY", strategy: "donchian", side: "long" },
      { pair: "USDJPY", strategy: "ma-crossover", side: "long" },
      { pair: "EURUSD", strategy: "nr7-breakout", side: "long" },
      { pair: "EURUSD", strategy: "rsi-reversion", side: "long" },
      { pair: "GBPUSD", strategy: "donchian", side: "short" },
      { pair: "GBPUSD", strategy: "ma-crossover", side: "short" },
    ];
    const res = pm.canOpen(
      { pair: "USDJPY", strategy: "nr7-breakout", side: "long" },
      open,
    );
    expect(res.reason).toBe("total_limit");
  });
});

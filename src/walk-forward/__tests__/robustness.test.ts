import { describe, it, expect } from "vitest";
import {
  checkRobustness,
  checkCrossPairRobustness,
  defaultRobustness,
} from "../robustness.js";
import type { WfAggregate } from "../engine.js";
import type { PairSymbol } from "../../types/pair.js";

function mkAgg(
  overrides: Partial<WfAggregate<Record<string, number>>> = {},
): WfAggregate<Record<string, number>> {
  return {
    windows: [],
    oosAvgSharpe: 1.2,
    oosAvgMar: 0.8,
    oosAvgPf: 1.5,
    oosMaxDd: 0.1,
    oosAvgTotalReturn: 0.15,
    isOosSharpeDrop: 0.2,
    ...overrides,
  };
}

describe("checkRobustness", () => {
  it("passes when all criteria are met", () => {
    const agg = mkAgg();
    const r = checkRobustness(agg);
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it("fails when oosAvgSharpe < minSharpe", () => {
    const agg = mkAgg({ oosAvgSharpe: 0.5 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((msg) => msg.toLowerCase().includes("sharpe"))).toBe(
      true,
    );
  });

  it("fails when oosAvgMar < minMar", () => {
    const agg = mkAgg({ oosAvgMar: 0.1 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("mar"))).toBe(true);
  });

  it("fails when oosAvgPf < minPf", () => {
    const agg = mkAgg({ oosAvgPf: 1.1 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("pf"))).toBe(true);
  });

  it("fails when oosMaxDd > maxDd", () => {
    const agg = mkAgg({ oosMaxDd: 0.3 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("dd"))).toBe(true);
  });

  it("fails when isOosSharpeDrop > maxSharpeDrop", () => {
    const agg = mkAgg({ isOosSharpeDrop: 0.5 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("drop"))).toBe(true);
  });

  it("lists multiple reasons when multiple criteria fail", () => {
    const agg = mkAgg({
      oosAvgSharpe: 0.5,
      oosAvgPf: 1.0,
      oosMaxDd: 0.4,
    });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("respects custom criteria", () => {
    const agg = mkAgg({ oosAvgSharpe: 1.2 });
    const r = checkRobustness(agg, { ...defaultRobustness, minSharpe: 2.0 });
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("sharpe"))).toBe(
      true,
    );
  });
});

describe("checkCrossPairRobustness", () => {
  it("passes when 2 of 3 pairs pass (default minPassingPairs=2)", () => {
    const perPair: Record<PairSymbol, WfAggregate<Record<string, number>>> = {
      USDJPY: mkAgg(), // pass
      EURUSD: mkAgg(), // pass
      GBPUSD: mkAgg({ oosAvgSharpe: 0.3 }), // fail
    };
    const r = checkCrossPairRobustness(perPair);
    expect(r.passed).toBe(true);
    expect(r.passingPairs.sort()).toEqual(["EURUSD", "USDJPY"]);
    expect(r.details.USDJPY.passed).toBe(true);
    expect(r.details.GBPUSD.passed).toBe(false);
  });

  it("fails when only 1 of 3 pairs passes", () => {
    const perPair: Record<PairSymbol, WfAggregate<Record<string, number>>> = {
      USDJPY: mkAgg(), // pass
      EURUSD: mkAgg({ oosAvgSharpe: 0.3 }), // fail
      GBPUSD: mkAgg({ oosMaxDd: 0.5 }), // fail
    };
    const r = checkCrossPairRobustness(perPair);
    expect(r.passed).toBe(false);
    expect(r.passingPairs).toEqual(["USDJPY"]);
  });

  it("fails when 0 of 3 pairs pass", () => {
    const perPair: Record<PairSymbol, WfAggregate<Record<string, number>>> = {
      USDJPY: mkAgg({ oosAvgSharpe: 0.3 }),
      EURUSD: mkAgg({ oosAvgSharpe: 0.3 }),
      GBPUSD: mkAgg({ oosAvgSharpe: 0.3 }),
    };
    const r = checkCrossPairRobustness(perPair);
    expect(r.passed).toBe(false);
    expect(r.passingPairs).toHaveLength(0);
  });

  it("passes when all 3 pairs pass", () => {
    const perPair: Record<PairSymbol, WfAggregate<Record<string, number>>> = {
      USDJPY: mkAgg(),
      EURUSD: mkAgg(),
      GBPUSD: mkAgg(),
    };
    const r = checkCrossPairRobustness(perPair);
    expect(r.passed).toBe(true);
    expect(r.passingPairs).toHaveLength(3);
  });

  it("respects custom minPassingPairs", () => {
    const perPair: Record<PairSymbol, WfAggregate<Record<string, number>>> = {
      USDJPY: mkAgg(),
      EURUSD: mkAgg(),
      GBPUSD: mkAgg({ oosAvgSharpe: 0.3 }),
    };
    // 2 pairs pass but require 3
    const r = checkCrossPairRobustness(perPair, defaultRobustness, 3);
    expect(r.passed).toBe(false);
    expect(r.passingPairs).toHaveLength(2);
  });
});

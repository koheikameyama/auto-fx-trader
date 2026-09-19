import { describe, it, expect } from "vitest";
import {
  buildTradeId,
  encodeAnchorComment,
  decodeAnchor,
  replayPositionState,
  type DemoTradeAnchor,
} from "../trade-state.js";
import type { DailyBar } from "../../types/bar.js";
import type { ExitConfig } from "../../types/strategy.js";

function mkBar(iso: string, o: number, h: number, l: number, c: number): DailyBar {
  return { date: new Date(iso), open: o, high: h, low: l, close: c, volume: null };
}

const donchianExitConfig: ExitConfig = {
  useTrailing: true,
  timeStopDays: 10,
  timeStopMaxDays: 20,
  slAtrMultiplier: 1.0,
  beAtrMultiplier: 0.5,
  trailAtrMultiplier: 1.0,
};

describe("buildTradeId", () => {
  it("builds a stable idempotency key from pair and signal bar date", () => {
    expect(buildTradeId("USDJPY", new Date("2026-04-20T00:00:00Z"))).toBe(
      "donchian-usdjpy-2026-04-20",
    );
  });
});

describe("encodeAnchorComment / decodeAnchor", () => {
  it("round-trips entryAtr and theoreticalEntryPrice through id + comment", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 0.85,
      theoreticalEntryPrice: 154.32,
    };
    const id = buildTradeId(anchor.pair, anchor.signalBarDate);
    const comment = encodeAnchorComment(anchor);

    const decoded = decodeAnchor(anchor.pair, anchor.side, id, comment);

    expect(decoded).toEqual(anchor);
  });

  it("returns null when tradeId or comment is missing", () => {
    expect(decodeAnchor("USDJPY", "long", undefined, "1|150")).toBeNull();
    expect(decodeAnchor("USDJPY", "long", "donchian-usdjpy-2026-04-20", undefined)).toBeNull();
  });

  it("returns null for a malformed trade id (e.g. a hand-placed trade)", () => {
    expect(decodeAnchor("USDJPY", "long", "manual-trade-1", "1|150")).toBeNull();
  });

  it("returns null for a malformed comment", () => {
    expect(decodeAnchor("USDJPY", "long", "donchian-usdjpy-2026-04-20", "not-a-number")).toBeNull();
  });
});

describe("replayPositionState", () => {
  it("throws if the signal bar is not present in the supplied bars", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    expect(() =>
      replayPositionState(anchor, [mkBar("2026-04-21T00:00:00Z", 150, 151, 149, 150.5)], donchianExitConfig),
    ).toThrow(/signal bar/);
  });

  it("returns the initial SL with no exit when no bar since entry has touched it", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    const bars = [
      mkBar("2026-04-20T00:00:00Z", 149.5, 150.2, 149.4, 150.0), // signal bar
      mkBar("2026-04-21T00:00:00Z", 150.0, 150.3, 149.9, 150.1),
    ];
    const result = replayPositionState(anchor, bars, donchianExitConfig);
    // slAtrMultiplier=1.0 * entryAtr=1.0 => initial SL = 150.0 - 1.0 = 149.0
    expect(result.currentSl).toBe(149.0);
    expect(result.hasBreakEven).toBe(false);
    expect(result.exit).toBeUndefined();
  });

  it("promotes to break-even once price moves beAtrMultiplier*ATR in favor, then trails", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    const bars = [
      mkBar("2026-04-20T00:00:00Z", 149.5, 150.2, 149.4, 150.0), // signal bar
      // beOffset = 0.5 * 1.0 = 0.5 -> BE triggers once high >= 150.5
      mkBar("2026-04-21T00:00:00Z", 150.0, 150.6, 149.9, 150.4),
      // trailOffset = 1.0 * 1.0 = 1.0 -> newSl = high(151.2) - 1.0 = 150.2, above entry(150.0)
      mkBar("2026-04-22T00:00:00Z", 150.4, 151.2, 150.3, 151.0),
    ];
    const result = replayPositionState(anchor, bars, donchianExitConfig);
    expect(result.hasBreakEven).toBe(true);
    expect(result.currentSl).toBeCloseTo(150.2, 8);
    expect(result.exit).toBeUndefined();
  });

  it("reports an sl exit when a later bar touches the initial stop", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    const bars = [
      mkBar("2026-04-20T00:00:00Z", 149.5, 150.2, 149.4, 150.0), // signal bar
      mkBar("2026-04-21T00:00:00Z", 150.0, 150.1, 148.9, 149.0), // low 148.9 <= SL 149.0
    ];
    const result = replayPositionState(anchor, bars, donchianExitConfig);
    expect(result.exit).toEqual({ exitPrice: 149.0, exitReason: "sl" });
  });

  it("reports a time-stop exit once daysHeld reaches timeStopDays", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "long",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    const bars: DailyBar[] = [mkBar("2026-04-20T00:00:00Z", 150, 150.2, 149.9, 150.0)];
    for (let d = 1; d <= 10; d++) {
      const date = new Date(Date.UTC(2026, 3, 20 + d));
      bars.push(mkBar(date.toISOString(), 150, 150.2, 149.9, 150.0));
    }
    const result = replayPositionState(anchor, bars, donchianExitConfig);
    expect(result.exit?.exitReason).toBe("time");
  });

  it("works symmetrically for short positions", () => {
    const anchor: DemoTradeAnchor = {
      pair: "USDJPY",
      side: "short",
      signalBarDate: new Date("2026-04-20T00:00:00Z"),
      entryAtr: 1.0,
      theoreticalEntryPrice: 150.0,
    };
    const bars = [
      mkBar("2026-04-20T00:00:00Z", 150.5, 150.6, 149.8, 150.0), // signal bar
      mkBar("2026-04-21T00:00:00Z", 150.0, 151.1, 149.9, 151.0), // high 151.1 >= SL 151.0
    ];
    const result = replayPositionState(anchor, bars, donchianExitConfig);
    expect(result.exit).toEqual({ exitPrice: 151.0, exitReason: "sl" });
  });
});

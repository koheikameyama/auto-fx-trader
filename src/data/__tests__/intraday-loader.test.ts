import { describe, it, expect } from "vitest";
import { aggregate1hTo4h } from "../intraday-loader.js";
import type { IntradayBar } from "../../types/intraday-bar.js";

function mkBar(iso: string, o: number, h: number, l: number, c: number, v: number | null = null): IntradayBar {
  return {
    datetime: new Date(iso),
    timeframe: "1h",
    open: o, high: h, low: l, close: c, volume: v,
  };
}

describe("aggregate1hTo4h", () => {
  it("aggregates 4 consecutive 1h bars into one 4h bar at UTC 00:00 boundary", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155.0, 155.2, 154.9, 155.1),
      mkBar("2024-06-03T01:00:00Z", 155.1, 155.3, 155.0, 155.25),
      mkBar("2024-06-03T02:00:00Z", 155.25, 155.5, 155.2, 155.4),
      mkBar("2024-06-03T03:00:00Z", 155.4, 155.6, 155.3, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(1);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(result[0].timeframe).toBe("4h");
    expect(result[0].open).toBe(155.0);
    expect(result[0].high).toBe(155.6);
    expect(result[0].low).toBe(154.9);
    expect(result[0].close).toBe(155.5);
  });

  it("splits bars into groups at UTC 00/04/08/12/16/20 boundaries", () => {
    const bars: IntradayBar[] = [];
    for (let h = 0; h < 8; h++) {
      bars.push(mkBar(`2024-06-03T${String(h).padStart(2, "0")}:00:00Z`, 155, 156, 154, 155.5));
    }
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(2);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T00:00:00.000Z");
    expect(result[1].datetime.toISOString()).toBe("2024-06-03T04:00:00.000Z");
  });

  it("discards incomplete final group (fewer than 4 bars)", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(0);
  });

  it("sums volumes, ignoring nulls", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155, 100),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155, 200),
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155, 150),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result[0].volume).toBe(450);
  });

  it("returns null volume when all source volumes are null", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155, null),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155, null),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result[0].volume).toBeNull();
  });

  it("skips bars until first 00/04/08/12/16/20 boundary", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T02:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T04:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T05:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T06:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T07:00:00Z", 155, 156, 154, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    expect(result.length).toBe(1);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T04:00:00.000Z");
  });

  it("skips non-consecutive hours (gap in middle of group)", () => {
    const bars: IntradayBar[] = [
      mkBar("2024-06-03T00:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T01:00:00Z", 155, 156, 154, 155.5),
      // missing 02:00
      mkBar("2024-06-03T03:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T04:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T05:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T06:00:00Z", 155, 156, 154, 155.5),
      mkBar("2024-06-03T07:00:00Z", 155, 156, 154, 155.5),
    ];
    const result = aggregate1hTo4h(bars);
    // First group (00-03) has gap, should NOT produce a bar.
    // Then 04-07 is valid.
    expect(result.length).toBe(1);
    expect(result[0].datetime.toISOString()).toBe("2024-06-03T04:00:00.000Z");
  });
});

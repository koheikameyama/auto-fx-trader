import type { IntradayBar } from "../types/intraday-bar.js";

const FOUR_HOUR_BOUNDARIES = new Set([0, 4, 8, 12, 16, 20]);

export function aggregate1hTo4h(bars1h: IntradayBar[]): IntradayBar[] {
  if (bars1h.length === 0) return [];
  const sorted = [...bars1h].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

  const result: IntradayBar[] = [];
  let i = 0;
  while (i < sorted.length) {
    // Skip to next boundary bar
    while (i < sorted.length && !FOUR_HOUR_BOUNDARIES.has(sorted[i].datetime.getUTCHours())) {
      i++;
    }
    if (i + 3 >= sorted.length) break;

    const group = sorted.slice(i, i + 4);
    // Verify hours are consecutive
    const startMs = group[0].datetime.getTime();
    let consecutive = true;
    for (let j = 1; j < 4; j++) {
      if (group[j].datetime.getTime() !== startMs + j * 3600_000) {
        consecutive = false;
        break;
      }
    }

    if (!consecutive) {
      i++; // advance past the broken group start and retry from next bar
      continue;
    }

    const volumes = group.map((b) => b.volume).filter((v): v is number => v != null);
    const volume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null;

    result.push({
      datetime: group[0].datetime,
      timeframe: "4h",
      open: group[0].open,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      close: group[3].close,
      volume,
    });
    i += 4;
  }

  return result;
}

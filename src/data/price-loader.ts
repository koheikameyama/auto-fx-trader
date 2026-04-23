import type { DailyBar } from "../types/bar.js";
import type { PairSymbol } from "../types/pair.js";
import { getPairConfig } from "./pair-config.js";

interface ServiceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface ServiceResponse {
  ticker: string;
  bars: ServiceBar[];
}

function getServiceUrl(): string {
  return process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8765";
}

export async function fetchFxDaily(
  pair: PairSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const { yfinanceTicker } = getPairConfig(pair);
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    ticker: yfinanceTicker,
    start: startIso,
    end: endIso,
  });
  const url = `${base}/fx/daily?${params.toString()}`;

  const headers: Record<string, string> = {};
  const secret = process.env.SIDECAR_SECRET;
  if (secret) {
    headers["x-api-key"] = secret;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`yfinance-service error: ${res.status} ${body}`);
  }

  const body = (await res.json()) as ServiceResponse;
  return body.bars.map((b) => ({
    date: new Date(`${b.date}T00:00:00Z`),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

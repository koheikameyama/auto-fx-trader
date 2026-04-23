export type Timeframe = "1h" | "4h";

export interface IntradayBar {
  datetime: Date;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

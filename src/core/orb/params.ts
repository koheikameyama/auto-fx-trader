export interface OrbParams {
  rangeHours: number;
  atrMultStop: number;
  atrPeriod: number;
  sessionStartUtcHour: number;
  sessionEndUtcHour: number;
}

export const orbDefaults: OrbParams = {
  rangeHours: 3,
  atrMultStop: 1.5,
  atrPeriod: 14,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 15,
};

export interface OrbParams {
  rangeHours: number;
  atrPeriod: number;
  sessionStartUtcHour: number;
  sessionEndUtcHour: number;
}

export const orbDefaults: OrbParams = {
  rangeHours: 3,
  atrPeriod: 14,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 15,
};

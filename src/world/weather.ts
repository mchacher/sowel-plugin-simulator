/**
 * Weather (spec 001, FR5).
 *
 * One source for the sky, so the sky, the temperature and the production always
 * agree. A demo showing full production under reported rain is worse than no
 * demo, so `cloudFactor` is computed here and everything else multiplies by it.
 */

import { dayNumber, localMidnight, localParts } from "./clock.js";
import { rngFor, smoothNoise } from "./random.js";

/** The catalogue's closed vocabulary. */
export type Condition =
  "sunny" | "partly_cloudy" | "cloudy" | "foggy" | "rainy" | "snowy" | "stormy";

/** How much of the clear-sky beam survives, per condition. */
const CLEARNESS: Record<Condition, number> = {
  sunny: 0.97,
  partly_cloudy: 0.72,
  cloudy: 0.34,
  foggy: 0.28,
  rainy: 0.2,
  snowy: 0.24,
  stormy: 0.14,
};

/** Rain probability the forecast reports, per condition — the catalogue's bands. */
const RAIN_PROBABILITY: Record<Condition, [number, number]> = {
  sunny: [0, 5],
  partly_cloudy: [5, 25],
  cloudy: [15, 45],
  foggy: [10, 30],
  rainy: [60, 95],
  snowy: [55, 90],
  stormy: [70, 95],
};

/**
 * How much colder or warmer than the season's mean a day of each kind runs.
 * Snow arrives with the cold air mass that makes it snow rather than rain, which
 * is why a snowy day is never a mild one.
 */
const TEMPERATURE_ANOMALY_C: Record<Condition, number> = {
  sunny: 1.2,
  partly_cloudy: 0.4,
  cloudy: -0.6,
  foggy: -1.5,
  rainy: -1,
  snowy: -5.5,
  stormy: 0.5,
};

/** Millimetres in the last hour, per condition. */
const RAIN_MM_PER_HOUR: Record<Condition, number> = {
  sunny: 0,
  partly_cloudy: 0,
  cloudy: 0,
  foggy: 0.1,
  rainy: 2.4,
  snowy: 1.1,
  stormy: 7.5,
};

type Season = "winter" | "spring" | "summer" | "autumn";

export function seasonOf(dayOfYear: number): Season {
  if (dayOfYear < 60 || dayOfYear >= 335) return "winter";
  if (dayOfYear < 152) return "spring";
  if (dayOfYear < 244) return "summer";
  return "autumn";
}

const SEASON_WEIGHTS: Record<Season, { value: Condition; weight: number }[]> = {
  winter: [
    { value: "sunny", weight: 12 },
    { value: "partly_cloudy", weight: 22 },
    { value: "cloudy", weight: 30 },
    { value: "foggy", weight: 12 },
    { value: "rainy", weight: 20 },
    { value: "snowy", weight: 4 },
  ],
  spring: [
    { value: "sunny", weight: 25 },
    { value: "partly_cloudy", weight: 32 },
    { value: "cloudy", weight: 20 },
    { value: "rainy", weight: 20 },
    { value: "stormy", weight: 3 },
  ],
  summer: [
    { value: "sunny", weight: 45 },
    { value: "partly_cloudy", weight: 30 },
    { value: "cloudy", weight: 12 },
    { value: "rainy", weight: 9 },
    { value: "stormy", weight: 4 },
  ],
  autumn: [
    { value: "sunny", weight: 18 },
    { value: "partly_cloudy", weight: 28 },
    { value: "cloudy", weight: 26 },
    { value: "foggy", weight: 8 },
    { value: "rainy", weight: 20 },
  ],
};

export interface WeatherState {
  condition: Condition;
  /** Fraction of the clear-sky beam that reaches the ground, in [0, 1]. */
  cloudFactor: number;
  rainMmPerHour: number;
  /** Millimetres since local midnight; monotonic within a day. */
  rainMmToday: number;
  windKmh: number;
  gustKmh: number;
  windDeg: number;
  gustDeg: number;
  pressureHpa: number;
  /** Kelvin above or below the season's mean, from the condition. */
  temperatureAnomalyC: number;
}

/** The condition drawn for a whole local day. */
export function conditionForDay(ts: number, tz: string, seed: number): Condition {
  const { dayOfYear } = localParts(ts, tz);
  const drawn = rngFor(seed, dayNumber(ts, tz), "weather").weighted(
    SEASON_WEIGHTS[seasonOf(dayOfYear)],
  );
  // Snow on a mild day is the kind of small incoherence a visitor notices, and
  // then stops trusting the rest of the page. Snow needs a cold season as well
  // as its own cold anomaly; outside deep winter the same draw falls as rain.
  if (drawn === "snowy" && dayOfYear > 60 && dayOfYear < 330) return "rainy";
  return drawn;
}

export function weatherAt(ts: number, tz: string, seed: number): WeatherState {
  const condition = conditionForDay(ts, tz, seed);
  const day = dayNumber(ts, tz);
  const rng = rngFor(seed, day, "weather-detail");

  // The day's condition sets the level; the noise makes a cloudy morning able to
  // brighten into a clear afternoon without the condition itself changing.
  const base = CLEARNESS[condition];
  const wander = smoothNoise(seed, `clouds:${day}`, ts / 1000, 5400) * 0.18;
  const cloudFactor = Math.max(0.05, Math.min(1, base + wander));

  const hoursSinceMidnight = (ts - localMidnight(ts, tz)) / 3_600_000;
  const rainMmPerHour = Math.max(
    0,
    RAIN_MM_PER_HOUR[condition] * (1 + smoothNoise(seed, `rain:${day}`, ts / 1000, 3600) * 0.5),
  );

  const windBase = rng.range(4, 22) + (condition === "stormy" ? 22 : 0);
  const windKmh = Math.max(0, windBase + smoothNoise(seed, `wind:${day}`, ts / 1000, 1800) * 8);
  const windDeg =
    (rng.range(0, 360) + smoothNoise(seed, `winddir:${day}`, ts / 1000, 7200) * 25 + 360) % 360;

  // Low pressure comes with the weather that needs it: a storm sits near 985,
  // a settled clear day near 1025.
  const pressureBase =
    condition === "stormy"
      ? 986
      : condition === "rainy"
        ? 998
        : condition === "sunny"
          ? 1024
          : 1012;

  return {
    condition,
    temperatureAnomalyC: TEMPERATURE_ANOMALY_C[condition],
    pressureHpa: pressureBase + smoothNoise(seed, `pressure:${day}`, ts / 1000, 21_600) * 6,
    cloudFactor,
    rainMmPerHour,
    rainMmToday: RAIN_MM_PER_HOUR[condition] * hoursSinceMidnight * 0.6,
    windKmh,
    gustKmh: windKmh * rng.range(1.5, 2),
    windDeg,
    gustDeg: (windDeg + rng.range(-20, 20) + 360) % 360,
  };
}

export interface ForecastDay {
  /** 1 = tomorrow. There is no day 0 (spec 001, FR5). */
  index: number;
  condition: Condition;
  tempMinC: number;
  tempMaxC: number;
  rainProbabilityPct: number;
  windGustsKmh: number;
}

/** Five days, starting tomorrow. */
export function forecast(
  ts: number,
  tz: string,
  seed: number,
  outdoorRange: (dayTs: number) => { minC: number; maxC: number },
): ForecastDay[] {
  const days: ForecastDay[] = [];
  for (let i = 1; i <= 5; i++) {
    const dayTs = localMidnight(ts, tz) + i * 86_400_000 + 12 * 3_600_000;
    const condition = conditionForDay(dayTs, tz, seed);
    const rng = rngFor(seed, dayNumber(dayTs, tz), "forecast");
    const [lo, hi] = RAIN_PROBABILITY[condition];
    const range = outdoorRange(dayTs);
    days.push({
      index: i,
      condition,
      tempMinC: Math.round(range.minC * 10) / 10,
      tempMaxC: Math.round(range.maxC * 10) / 10,
      rainProbabilityPct: Math.round(rng.range(lo, hi)),
      windGustsKmh: Math.round(rng.range(12, 55)),
    });
  }
  return days;
}

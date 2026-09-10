/**
 * Outdoor temperature and humidity (spec 001, FR5).
 *
 * A seasonal baseline, a diurnal cycle whose minimum sits at sunrise and whose
 * maximum sits around three in the afternoon, and an amplitude the weather
 * flattens: an overcast day swings less than a clear one, which is both true and
 * the reason the same model can serve the PV story.
 */

import { localMidnight, localParts } from "./clock.js";
import { smoothNoise } from "./random.js";
import { sunTimes } from "./sun.js";
import type { WeatherState } from "./weather.js";

export interface ClimateProfile {
  /** Yearly mean, °C. */
  annualMeanC: number;
  /** Half the difference between the warmest and coldest monthly mean. */
  annualAmplitudeC: number;
  /** Day of year of the warmest mean — late July in the northern hemisphere. */
  warmestDayOfYear: number;
  /** Peak-to-trough swing on a clear day. */
  diurnalAmplitudeC: number;
}

/** A temperate oceanic climate, which is what the reference installation sits in. */
export const TEMPERATE_OCEANIC: ClimateProfile = {
  annualMeanC: 12.5,
  annualAmplitudeC: 8.5,
  warmestDayOfYear: 205,
  diurnalAmplitudeC: 11,
};

export function seasonalBaselineC(ts: number, tz: string, climate: ClimateProfile): number {
  const { dayOfYear } = localParts(ts, tz);
  const phase = ((dayOfYear - climate.warmestDayOfYear) / 365) * 2 * Math.PI;
  return climate.annualMeanC + climate.annualAmplitudeC * Math.cos(phase);
}

/**
 * The diurnal shape in [-1, 1]: −1 at sunrise, +1 at 15:00, continuous across
 * midnight. A cosine stretched over two unequal half-days rather than one
 * symmetric one, because dawn and mid-afternoon are not twelve hours apart.
 */
function diurnalShape(minutes: number, sunriseMinutes: number): number {
  const peak = 15 * 60;
  const dayLength = peak - sunriseMinutes;
  const nightLength = 24 * 60 - dayLength;
  if (minutes >= sunriseMinutes && minutes <= peak) {
    return -Math.cos((Math.PI * (minutes - sunriseMinutes)) / dayLength);
  }
  const since = minutes > peak ? minutes - peak : minutes + 24 * 60 - peak;
  return Math.cos((Math.PI * since) / nightLength);
}

export interface OutdoorState {
  temperatureC: number;
  humidityPct: number;
}

export function outdoorAt(
  ts: number,
  tz: string,
  lat: number,
  lon: number,
  weather: WeatherState,
  seed: number,
  climate: ClimateProfile = TEMPERATE_OCEANIC,
): OutdoorState {
  const { minutes } = localParts(ts, tz);
  const { sunrise } = sunTimes(ts, lat, lon, tz);
  const sunriseMinutes = sunrise === null ? 7 * 60 : (sunrise - localMidnight(ts, tz)) / 60_000;

  const baseline = seasonalBaselineC(ts, tz, climate) + weather.temperatureAnomalyC;
  // Cloud cover flattens the swing: the ground neither heats nor radiates freely.
  const amplitude = (climate.diurnalAmplitudeC / 2) * (0.55 + 0.45 * weather.cloudFactor);
  const drift = smoothNoise(seed, "outdoor", ts / 1000, 10_800);
  const temperatureC = baseline + amplitude * diurnalShape(minutes, sunriseMinutes) + drift;

  // Warm air holds more water: humidity runs opposite to the diurnal swing, and
  // rain pins it high.
  const humidityBase = weather.rainMmPerHour > 0 ? 92 : 68;
  const humidityPct = Math.max(
    30,
    Math.min(100, humidityBase - 14 * diurnalShape(minutes, sunriseMinutes)),
  );

  return {
    temperatureC: Math.round(temperatureC * 10) / 10,
    humidityPct: Math.round(humidityPct),
  };
}

/**
 * Soil temperature a couple of metres down, which is what a cellar loses heat to.
 *
 * The ground is a low-pass filter on the year: it keeps the annual mean, holds a
 * quarter of the swing, and runs about two months behind the air. That is why a
 * cellar sits near 12 °C in both January and July, and why coupling one to the
 * outdoor air — as this model did at first — gave a cellar at 3 °C in winter,
 * which no cellar has ever been.
 */
export function groundTemperatureC(
  ts: number,
  tz: string,
  climate: ClimateProfile = TEMPERATE_OCEANIC,
): number {
  const { dayOfYear } = localParts(ts, tz);
  const lagDays = 60;
  const phase = ((dayOfYear - climate.warmestDayOfYear - lagDays) / 365) * 2 * Math.PI;
  return climate.annualMeanC + climate.annualAmplitudeC * 0.25 * Math.cos(phase);
}

/** The day's minimum and maximum, for the forecast. */
export function outdoorRangeForDay(
  ts: number,
  tz: string,
  lat: number,
  lon: number,
  weather: WeatherState,
  seed: number,
  climate: ClimateProfile = TEMPERATE_OCEANIC,
): { minC: number; maxC: number } {
  const midnight = localMidnight(ts, tz);
  let minC = Infinity;
  let maxC = -Infinity;
  for (let h = 0; h < 24; h++) {
    const t = outdoorAt(
      midnight + h * 3_600_000,
      tz,
      lat,
      lon,
      weather,
      seed,
      climate,
    ).temperatureC;
    minC = Math.min(minC, t);
    maxC = Math.max(maxC, t);
  }
  return { minC, maxC };
}

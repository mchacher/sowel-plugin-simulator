import { describe, expect, it } from "vitest";
import { localMidnight, localParts } from "./clock.js";
import { outdoorAt, outdoorRangeForDay, seasonalBaselineC, TEMPERATE_OCEANIC } from "./outdoor.js";
import { weatherAt, type WeatherState } from "./weather.js";

const TZ = "Europe/Paris";
const LAT = 48.8566;
const LON = 2.3522;
const SEED = 1789;

function sky(cloudFactor: number): WeatherState {
  return {
    condition: cloudFactor > 0.8 ? "sunny" : "cloudy",
    cloudFactor,
    rainMmPerHour: 0,
    rainMmToday: 0,
    windKmh: 8,
    gustKmh: 12,
    windDeg: 200,
    gustDeg: 205,
    pressureHpa: 1015,
    temperatureAnomalyC: 0,
  };
}

describe("outdoor temperature", () => {
  it("follows the seasons", () => {
    const july = seasonalBaselineC(Date.parse("2026-07-24T12:00:00Z"), TZ, TEMPERATE_OCEANIC);
    const january = seasonalBaselineC(Date.parse("2026-01-24T12:00:00Z"), TZ, TEMPERATE_OCEANIC);
    expect(july).toBeGreaterThan(19);
    expect(january).toBeLessThan(6);
  });

  it("puts the minimum near sunrise and the maximum in mid-afternoon", () => {
    const midnight = localMidnight(Date.parse("2026-05-15T12:00:00Z"), TZ);
    let coldest = { minutes: 0, temperature: Infinity };
    let warmest = { minutes: 0, temperature: -Infinity };
    for (let minutes = 0; minutes < 1440; minutes += 15) {
      const ts = midnight + minutes * 60_000;
      const temperature = outdoorAt(ts, TZ, LAT, LON, sky(0.95), SEED).temperatureC;
      if (temperature < coldest.temperature) coldest = { minutes, temperature };
      if (temperature > warmest.temperature) warmest = { minutes, temperature };
    }
    // Sunrise in mid-May in Paris is around 06:15 local.
    expect(coldest.minutes).toBeGreaterThan(4 * 60);
    expect(coldest.minutes).toBeLessThan(8 * 60);
    expect(warmest.minutes).toBeGreaterThan(13 * 60);
    expect(warmest.minutes).toBeLessThan(17 * 60);
  });

  it("swings less under cloud than under a clear sky", () => {
    const ts = Date.parse("2026-05-15T12:00:00Z");
    const clear = outdoorRangeForDay(ts, TZ, LAT, LON, sky(0.95), SEED);
    const overcast = outdoorRangeForDay(ts, TZ, LAT, LON, sky(0.2), SEED);
    expect(clear.maxC - clear.minC).toBeGreaterThan(overcast.maxC - overcast.minC);
  });

  it("stays in a habitable band all year", () => {
    for (let day = 0; day < 365; day += 3) {
      const ts = Date.parse("2026-01-01T12:00:00Z") + day * 86_400_000;
      const { minC, maxC } = outdoorRangeForDay(ts, TZ, LAT, LON, weatherAt(ts, TZ, SEED), SEED);
      expect(minC).toBeGreaterThan(-15);
      expect(maxC).toBeLessThan(42);
    }
  });

  it("keeps humidity inside its physical bounds and high when it rains", () => {
    const ts = Date.parse("2026-11-15T09:00:00Z");
    const dry = outdoorAt(ts, TZ, LAT, LON, sky(0.95), SEED);
    const wet = outdoorAt(ts, TZ, LAT, LON, { ...sky(0.2), rainMmPerHour: 3 }, SEED);
    expect(dry.humidityPct).toBeGreaterThanOrEqual(30);
    expect(wet.humidityPct).toBeLessThanOrEqual(100);
    expect(wet.humidityPct).toBeGreaterThan(dry.humidityPct);
    expect(localParts(ts, TZ).hour).toBe(10);
  });
});

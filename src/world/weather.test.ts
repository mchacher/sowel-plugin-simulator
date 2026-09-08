import { describe, expect, it } from "vitest";
import { conditionForDay, forecast, seasonOf, weatherAt } from "./weather.js";
import { outdoorRangeForDay } from "./outdoor.js";

const TZ = "Europe/Paris";
const SEED = 1789;
const range = (dayTs: number) =>
  outdoorRangeForDay(dayTs, TZ, 48.8566, 2.3522, weatherAt(dayTs, TZ, SEED), SEED);

describe("weather", () => {
  it("gives the same day the same sky twice", () => {
    const ts = Date.parse("2026-07-15T12:00:00Z");
    expect(weatherAt(ts, TZ, SEED)).toEqual(weatherAt(ts, TZ, SEED));
    expect(conditionForDay(Date.parse("2026-07-15T06:00:00Z"), TZ, SEED)).toBe(
      conditionForDay(Date.parse("2026-07-15T21:00:00Z"), TZ, SEED),
    );
  });

  it("draws from the season", () => {
    expect(seasonOf(15)).toBe("winter");
    expect(seasonOf(100)).toBe("spring");
    expect(seasonOf(200)).toBe("summer");
    expect(seasonOf(300)).toBe("autumn");

    const summer = Array.from({ length: 90 }, (_, i) =>
      conditionForDay(Date.parse("2026-06-05T12:00:00Z") + i * 86_400_000, TZ, SEED),
    );
    const winter = Array.from({ length: 90 }, (_, i) =>
      conditionForDay(Date.parse("2025-12-05T12:00:00Z") + i * 86_400_000, TZ, SEED),
    );
    const sunnyDays = (days: string[]) => days.filter((d) => d === "sunny").length;
    expect(sunnyDays(summer)).toBeGreaterThan(sunnyDays(winter));
  });

  it("never reports snow on a mild day", () => {
    for (let i = 0; i < 365; i++) {
      const ts = Date.parse("2026-01-01T12:00:00Z") + i * 86_400_000;
      if (conditionForDay(ts, TZ, SEED) !== "snowy") continue;
      expect(range(ts).maxC).toBeLessThan(8);
    }
  });

  it("keeps the cloud factor between nothing and a clear sky", () => {
    for (let hour = 0; hour < 24 * 7; hour++) {
      const w = weatherAt(Date.parse("2026-03-01T00:00:00Z") + hour * 3_600_000, TZ, SEED);
      expect(w.cloudFactor).toBeGreaterThan(0);
      expect(w.cloudFactor).toBeLessThanOrEqual(1);
      expect(w.gustKmh).toBeGreaterThanOrEqual(w.windKmh);
      expect(w.rainMmPerHour).toBeGreaterThanOrEqual(0);
    }
  });

  it("agrees with itself: rain only when the sky says so", () => {
    for (let i = 0; i < 120; i++) {
      const ts = Date.parse("2026-01-01T12:00:00Z") + i * 86_400_000;
      const w = weatherAt(ts, TZ, SEED);
      if (w.condition === "sunny" || w.condition === "partly_cloudy") {
        expect(w.rainMmPerHour).toBe(0);
      }
    }
  });
});

describe("forecast", () => {
  it("starts tomorrow and runs five days — there is no day 0", () => {
    const days = forecast(Date.parse("2026-07-15T12:00:00Z"), TZ, SEED, range);
    expect(days.map((d) => d.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it("agrees with the condition it reports", () => {
    for (let i = 0; i < 40; i++) {
      const days = forecast(Date.parse("2026-01-01T12:00:00Z") + i * 86_400_000, TZ, SEED, range);
      for (const day of days) {
        expect(day.tempMaxC).toBeGreaterThanOrEqual(day.tempMinC);
        if (day.condition === "sunny") expect(day.rainProbabilityPct).toBeLessThanOrEqual(5);
        if (day.condition === "rainy") {
          expect(day.rainProbabilityPct).toBeGreaterThanOrEqual(60);
          expect(day.rainProbabilityPct).toBeLessThanOrEqual(95);
        }
      }
    }
  });

  it("says tomorrow what it will say today tomorrow", () => {
    const ts = Date.parse("2026-07-15T12:00:00Z");
    const tomorrowFromToday = forecast(ts, TZ, SEED, range)[0];
    expect(tomorrowFromToday.condition).toBe(conditionForDay(ts + 86_400_000, TZ, SEED));
  });
});

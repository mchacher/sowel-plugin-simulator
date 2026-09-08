import { describe, expect, it } from "vitest";
import { clearSkyIrradiance, incidenceFactor, sunPosition, sunTimes } from "./sun.js";

const PARIS = { lat: 48.8566, lon: 2.3522, tz: "Europe/Paris" };

describe("solar position", () => {
  it("matches the almanac at the summer solstice in Paris", () => {
    // Solar noon: elevation is 90 − latitude + declination = 64.6°.
    const noon = sunPosition(Date.parse("2026-06-21T11:52:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    expect(noon.elevationDeg).toBeGreaterThan(63.5);
    expect(noon.elevationDeg).toBeLessThan(65.5);
    expect(noon.azimuthDeg).toBeGreaterThan(175);
    expect(noon.azimuthDeg).toBeLessThan(185);
  });

  it("matches the almanac at the winter solstice", () => {
    const noon = sunPosition(Date.parse("2026-12-21T11:52:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    expect(noon.elevationDeg).toBeGreaterThan(16.7);
    expect(noon.elevationDeg).toBeLessThan(18.7);
  });

  it("rises in the north-east and sets in the north-west in June", () => {
    const morning = sunPosition(Date.parse("2026-06-21T06:00:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    const evening = sunPosition(Date.parse("2026-06-21T18:00:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    expect(morning.azimuthDeg).toBeLessThan(120);
    expect(evening.azimuthDeg).toBeGreaterThan(240);
  });

  it("puts sunrise and sunset within a couple of minutes of the almanac", () => {
    const times = sunTimes(Date.parse("2026-06-21T12:00:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    expect(times.sunrise).not.toBeNull();
    const sunrise = new Date(times.sunrise as number);
    const sunset = new Date(times.sunset as number);
    // 05:46 and 21:58 local, which is 03:46 and 19:58 UTC.
    expect(sunrise.getUTCHours()).toBe(3);
    expect(Math.abs(sunrise.getUTCMinutes() - 46)).toBeLessThanOrEqual(3);
    expect(sunset.getUTCHours()).toBe(19);
    expect(Math.abs(sunset.getUTCMinutes() - 57)).toBeLessThanOrEqual(3);
  });

  it("reports no sunrise inside the polar night, without a NaN", () => {
    const times = sunTimes(Date.parse("2026-12-21T12:00:00Z"), 78, 15, "UTC");
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
    for (let hour = 0; hour < 24; hour++) {
      const position = sunPosition(
        Date.parse("2026-12-21T00:00:00Z") + hour * 3_600_000,
        78,
        15,
        "UTC",
      );
      expect(Number.isFinite(position.elevationDeg)).toBe(true);
      expect(position.elevationDeg).toBeLessThan(0);
      expect(clearSkyIrradiance(position.elevationDeg)).toBe(0);
    }
  });

  it("gives a window nothing when the sun is behind it", () => {
    const afternoon = sunPosition(
      Date.parse("2026-06-21T15:00:00Z"),
      PARIS.lat,
      PARIS.lon,
      PARIS.tz,
    );
    // The sun is in the south-west; a north-facing window sees no beam.
    expect(incidenceFactor(0, afternoon)).toBe(0);
    expect(incidenceFactor(270, afternoon)).toBeGreaterThan(0.2);
  });

  it("attenuates a low sun more than a high one", () => {
    expect(clearSkyIrradiance(60)).toBeGreaterThan(clearSkyIrradiance(15));
    expect(clearSkyIrradiance(0)).toBe(0);
    expect(clearSkyIrradiance(-5)).toBe(0);
  });
});

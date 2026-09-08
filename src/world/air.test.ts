import { describe, expect, it } from "vitest";
import { roomById } from "../house/house.js";
import { CO2_OUTDOOR_PPM, daylightLux, initialAir, stepAir, type AirState } from "./air.js";

const SEJOUR = roomById("sejour");
const SDB = roomById("salle-de-bain");

function run(
  room = SEJOUR,
  state: AirState,
  inputs: Parameters<typeof stepAir>[2],
  minutes: number,
) {
  let current = state;
  for (let i = 0; i < minutes; i++) current = stepAir(room, current, inputs, 60);
  return current;
}

describe("indoor air", () => {
  it("climbs into the range an occupied closed room actually reaches", () => {
    const empty = initialAir(SEJOUR, 70);
    const occupied = run(
      SEJOUR,
      empty,
      { occupants: 2, outdoorHumidityPct: 70, moistureBoostPct: 0 },
      180,
    );
    expect(occupied.co2Ppm).toBeGreaterThan(700);
    expect(occupied.co2Ppm).toBeLessThan(1400);
  });

  it("decays back to outdoor level over about half an hour once the room empties", () => {
    const loaded: AirState = { co2Ppm: 1200, humidityPct: 50, noiseDb: 45 };
    const after30 = run(
      SEJOUR,
      loaded,
      { occupants: 0, outdoorHumidityPct: 70, moistureBoostPct: 0 },
      30,
    );
    const after120 = run(
      SEJOUR,
      loaded,
      { occupants: 0, outdoorHumidityPct: 70, moistureBoostPct: 0 },
      120,
    );
    // Most of the way down in half an hour, all of the way down in two.
    expect(after30.co2Ppm).toBeLessThan(1200 - 0.5 * (1200 - CO2_OUTDOOR_PPM));
    expect(after30.co2Ppm).toBeGreaterThan(CO2_OUTDOOR_PPM);
    expect(after120.co2Ppm).toBeLessThan(CO2_OUTDOOR_PPM + 30);
  });

  it("loads a small room faster than a big one with the same person in it", () => {
    const inputs = { occupants: 1, outdoorHumidityPct: 70, moistureBoostPct: 0 };
    const small = run(SDB, initialAir(SDB, 70), inputs, 60);
    const large = run(SEJOUR, initialAir(SEJOUR, 70), inputs, 60);
    expect(small.co2Ppm).toBeGreaterThan(large.co2Ppm);
  });

  it("spikes the bathroom after a shower and lets it fade", () => {
    const start = initialAir(SDB, 65);
    const showering = run(
      SDB,
      start,
      { occupants: 1, outdoorHumidityPct: 65, moistureBoostPct: 38 },
      15,
    );
    expect(showering.humidityPct).toBeGreaterThan(start.humidityPct + 10);
    const later = run(
      SDB,
      showering,
      { occupants: 0, outdoorHumidityPct: 65, moistureBoostPct: 0 },
      90,
    );
    expect(later.humidityPct).toBeLessThan(showering.humidityPct - 5);
  });

  it("keeps humidity physical", () => {
    const soaked = run(
      SDB,
      initialAir(SDB, 100),
      { occupants: 2, outdoorHumidityPct: 100, moistureBoostPct: 80 },
      240,
    );
    expect(soaked.humidityPct).toBeLessThanOrEqual(95);
    const dry = run(
      SEJOUR,
      initialAir(SEJOUR, 20),
      { occupants: 0, outdoorHumidityPct: 20, moistureBoostPct: 0 },
      240,
    );
    expect(dry.humidityPct).toBeGreaterThanOrEqual(28);
  });

  it("gets louder with people in the room", () => {
    const quiet = stepAir(
      SEJOUR,
      initialAir(SEJOUR, 60),
      { occupants: 0, outdoorHumidityPct: 60, moistureBoostPct: 0 },
      60,
    );
    const busy = stepAir(
      SEJOUR,
      initialAir(SEJOUR, 60),
      { occupants: 3, outdoorHumidityPct: 60, moistureBoostPct: 0 },
      60,
    );
    expect(quiet.noiseDb).toBeGreaterThan(29);
    expect(quiet.noiseDb).toBeLessThan(35);
    expect(busy.noiseDb).toBeGreaterThan(quiet.noiseDb);
    expect(busy.noiseDb).toBeLessThan(60);
  });

  it("reports darkness when no beam reaches the windows", () => {
    expect(daylightLux(SEJOUR, 0)).toBe(0);
    expect(daylightLux(SEJOUR, 2000)).toBeGreaterThan(daylightLux(SEJOUR, 500));
  });
});

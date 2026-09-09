import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import { localMidnight } from "./clock.js";
import {
  accumulate,
  baseLoadW,
  emptyCounters,
  gridVoltageV,
  planeOfArrayW,
  pvProductionW,
} from "./energy.js";
import { sunPosition } from "./sun.js";
import { inOffPeak, poolPumpScheduled } from "./appliances.js";
import {
  boostStorageWh,
  initialWaterHeaterState,
  stepWaterHeater,
  thermalOutputW,
  WATER_HEATER,
  type WaterHeaterState,
} from "./water-heater.js";

const PARIS = { lat: 48.8566, lon: 2.3522, tz: "Europe/Paris" };
const at = (iso: string) => sunPosition(Date.parse(iso), PARIS.lat, PARIS.lon, PARIS.tz);

describe("production", () => {
  it("is zero at night, whatever the sky says", () => {
    expect(pvProductionW(HOUSE, at("2026-07-15T23:30:00Z"), 1)).toBe(0);
    expect(planeOfArrayW(at("2026-07-15T23:30:00Z"), 1)).toBe(0);
  });

  it("peaks well below the nameplate on the best day of the year", () => {
    const peak = pvProductionW(HOUSE, at("2026-06-21T11:52:00Z"), 0.97);
    expect(peak).toBeGreaterThan(0.6 * HOUSE.pv.peakW);
    expect(peak).toBeLessThanOrEqual(HOUSE.pv.peakW);
  });

  it("produces far less on an overcast winter noon than a clear summer one", () => {
    const summer = pvProductionW(HOUSE, at("2026-06-21T11:52:00Z"), 0.97);
    const winter = pvProductionW(HOUSE, at("2026-12-21T11:52:00Z"), 0.25);
    expect(winter).toBeGreaterThan(0);
    expect(winter).toBeLessThan(summer * 0.2);
  });

  it("leaves a surplus larger than the biggest flexible load at midday", () => {
    const production = pvProductionW(HOUSE, at("2026-06-21T11:52:00Z"), 0.97);
    const largestFlexible = Math.max(
      ...HOUSE.loads.filter((l) => l.arbiterClass === "deferrable").map((l) => l.nominalW),
    );
    // Otherwise the energy arbiter has nothing to allocate and the demo has no
    // arbitration to show (core spec 140).
    expect(production - HOUSE.baseLoadW.day).toBeGreaterThan(largestFlexible);
  });
});

describe("the meter", () => {
  it("counts import and export separately and never runs backwards", () => {
    let counters = emptyCounters(HOUSE);
    const loads = { "water-heater": 2400 } as never;
    for (let i = 0; i < 60; i++) counters = accumulate(counters, 0, 1000, loads, 60);
    const midday = counters;
    for (let i = 0; i < 60; i++) counters = accumulate(counters, 4000, -2500, loads, 60);
    expect(counters.importedWh).toBe(midday.importedWh);
    expect(counters.exportedWh).toBeGreaterThan(0);
    expect(counters.producedWh).toBeGreaterThan(0);
    expect(counters.importedWh).toBeGreaterThanOrEqual(midday.importedWh);
  });

  it("integrates watts into watt-hours", () => {
    let counters = emptyCounters(HOUSE);
    counters = accumulate(counters, 0, 3600, {} as never, 3600);
    expect(counters.importedWh).toBeCloseTo(3600, 5);
  });

  it("breathes rather than reading the same watt for ever", () => {
    // A perfectly flat live power is the clearest tell that a demo is a mock.
    const midnight = localMidnight(Date.parse("2026-07-15T12:00:00Z"), PARIS.tz);
    const samples = Array.from({ length: 40 }, (_, i) =>
      baseLoadW(HOUSE, midnight + (2 * 3600 + i * 60) * 1000, PARIS.tz, 1789),
    );
    expect(new Set(samples).size).toBeGreaterThan(20);
    for (const watts of samples) {
      expect(watts).toBeGreaterThan(HOUSE.baseLoadW.night * 0.8);
      expect(watts).toBeLessThan(HOUSE.baseLoadW.night * 1.2 + 100);
    }
  });

  it("sags a little under load, like a real clamp", () => {
    expect(gridVoltageV(0)).toBeGreaterThan(gridVoltageV(6000));
    expect(gridVoltageV(6000)).toBeGreaterThan(220);
  });

  it("shapes the household floor by the hour", () => {
    const midnight = localMidnight(Date.parse("2026-07-15T12:00:00Z"), PARIS.tz);
    const night = baseLoadW(HOUSE, midnight + 3 * 3_600_000, PARIS.tz, 1789);
    const evening = baseLoadW(HOUSE, midnight + 20 * 3_600_000, PARIS.tz, 1789);
    expect(evening).toBeGreaterThan(night);
  });
});

describe("the thermodynamic tank", () => {
  const run = (
    state: WaterHeaterState,
    inputs: Parameters<typeof stepWaterHeater>[2],
    minutes: number,
  ): WaterHeaterState => {
    let current = state;
    for (let i = 0; i < minutes; i++) current = stepWaterHeater(WATER_HEATER, current, inputs, 60);
    return current;
  };
  const idle = { ambientC: 16, drawLitresPerMinute: 0, suppliedByMains: true, solarForced: false };

  it("is a heat pump, not a resistance", () => {
    // A resistive 2 400 W element would make the arbitration look more dramatic
    // than it is, and teach a visitor the wrong thing about what this costs.
    expect(WATER_HEATER.compressorW).toBeLessThan(1000);
    expect(WATER_HEATER.cop).toBeGreaterThan(2);
    expect(thermalOutputW(WATER_HEATER)).toBeGreaterThan(WATER_HEATER.compressorW * 2);
  });

  it("knows its off-peak window", () => {
    expect(inOffPeak(23 * 60)).toBe(true);
    expect(inOffPeak(3 * 60)).toBe(true);
    expect(inOffPeak(14 * 60)).toBe(false);
  });

  it("reheats to 55 off-peak and is left alone the rest of the time", () => {
    const cold: WaterHeaterState = { temperatureC: 40, heating: false };
    const night = run(cold, { ...idle, offPeak: true }, 240);
    expect(night.temperatureC).toBeGreaterThan(WATER_HEATER.targetC - 2);
    expect(night.temperatureC).toBeLessThan(WATER_HEATER.targetC + 0.5);

    const day = run(cold, { ...idle, offPeak: false }, 240);
    expect(day.heating).toBe(false);
    expect(day.temperatureC).toBeLessThan(cold.temperatureC);
  });

  it("recovers the morning's showers inside the off-peak window", () => {
    // Four showers take the tank down by about twenty kelvin; the compressor has
    // eight hours of night rate to put them back.
    const showered = run(
      { temperatureC: WATER_HEATER.targetC, heating: false },
      { ...idle, offPeak: false, drawLitresPerMinute: 2 },
      4 * 16,
    );
    expect(showered.temperatureC).toBeLessThan(WATER_HEATER.targetC - 15);

    // It settles just under its target rather than on it: standby loss pulls the
    // tank down between compressor cycles, like every real one.
    const recovered = run(showered, { ...idle, offPeak: true }, 8 * 60);
    expect(recovered.temperatureC).toBeGreaterThan(WATER_HEATER.targetC - 2);
  });

  it("draws nothing at all when its supply relay is open", () => {
    const off = run(
      { temperatureC: 40, heating: false },
      { ...idle, suppliedByMains: false, offPeak: true },
      60,
    );
    expect(off.heating).toBe(false);
  });

  it("takes the target to 62 on the surplus contact, and stores the difference", () => {
    // The 230 V contact raises the target rather than switching the tank on —
    // those seven kelvin are where the surplus goes (core spec 152).
    const full: WaterHeaterState = { temperatureC: WATER_HEATER.targetC, heating: false };
    const boosted = run(full, { ...idle, offPeak: false, solarForced: true }, 180);
    expect(boosted.temperatureC).toBeGreaterThan(WATER_HEATER.targetC + 5);
    expect(boosted.temperatureC).toBeLessThan(WATER_HEATER.boostTargetC + 0.5);

    // Roughly two kilowatt-hours of heat, which is the whole idea.
    expect(boostStorageWh(WATER_HEATER)).toBeGreaterThan(1800);
    expect(boostStorageWh(WATER_HEATER)).toBeLessThan(2300);
  });

  it("runs at noon on the contact, which the off-peak window alone would forbid", () => {
    const depleted: WaterHeaterState = { temperatureC: 42, heating: false };
    expect(run(depleted, { ...idle, offPeak: false }, 30).heating).toBe(false);
    expect(run(depleted, { ...idle, offPeak: false, solarForced: true }, 30).heating).toBe(true);
  });

  it("stops at its target rather than heating for ever", () => {
    const full = run(
      { temperatureC: WATER_HEATER.targetC, heating: false },
      { ...idle, offPeak: true },
      600,
    );
    expect(full.temperatureC).toBeLessThan(WATER_HEATER.targetC + 1);
    const boosted = run(
      { temperatureC: WATER_HEATER.boostTargetC, heating: false },
      { ...idle, offPeak: true, solarForced: true },
      600,
    );
    expect(boosted.temperatureC).toBeLessThan(WATER_HEATER.boostTargetC + 1);
  });

  it("is emptied by the morning showers, which is what leaves the day something to do", () => {
    const morning = run(
      initialWaterHeaterState(WATER_HEATER),
      { ...idle, offPeak: false, drawLitresPerMinute: 2 },
      64,
    );
    expect(morning.temperatureC).toBeLessThan(WATER_HEATER.targetC - WATER_HEATER.hysteresisK);
  });

  it("runs the pool pump on its built-in timer", () => {
    expect(poolPumpScheduled(12 * 60)).toBe(true);
    expect(poolPumpScheduled(6 * 60)).toBe(false);
    expect(poolPumpScheduled(20 * 60)).toBe(false);
  });
});

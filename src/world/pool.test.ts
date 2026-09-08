import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import {
  poolCapacityJPerK,
  poolEvaporationW,
  poolSolarGainW,
  stepPool,
  type PoolState,
} from "./pool.js";
import { sunPosition } from "./sun.js";

const POOL = HOUSE.pool;
const PARIS = { lat: 48.8566, lon: 2.3522, tz: "Europe/Paris" };

function run(state: PoolState, inputs: Parameters<typeof stepPool>[2], minutes: number): PoolState {
  let current = state;
  for (let i = 0; i < minutes; i++) current = stepPool(POOL, current, inputs, 60);
  return current;
}

describe("the pool", () => {
  it("has a time constant measured in days, not minutes", () => {
    const tauHours = poolCapacityJPerK(POOL) / POOL.lossWPerK / 3600;
    expect(tauHours).toBeGreaterThan(24);
  });

  it("moves a fraction of a degree in an hour of heat pump, never a degree", () => {
    const start: PoolState = { waterTemperatureC: 24, heatPumpOn: false };
    const after = run(
      start,
      { outdoorC: 24, windKmh: 5, solarGainW: 0, pumpRunning: true, setpointC: 28 },
      60,
    );
    const gained = after.waterTemperatureC - start.waterTemperatureC;
    expect(after.heatPumpOn).toBe(true);
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(0.5);
  });

  it("does nothing without its pump: no flow, no heating", () => {
    const start: PoolState = { waterTemperatureC: 22, heatPumpOn: false };
    const after = run(
      start,
      { outdoorC: 16, windKmh: 5, solarGainW: 0, pumpRunning: false, setpointC: 28 },
      60,
    );
    expect(after.heatPumpOn).toBe(false);
    expect(after.waterTemperatureC).toBeLessThan(start.waterTemperatureC);
  });

  it("stops when the air is too cold to take anything from", () => {
    const after = run(
      { waterTemperatureC: 10, heatPumpOn: false },
      { outdoorC: 4, windKmh: 5, solarGainW: 0, pumpRunning: true, setpointC: 27 },
      60,
    );
    expect(after.heatPumpOn).toBe(false);
  });

  it("warms on a clear summer week from the sun alone", () => {
    const noon = sunPosition(Date.parse("2026-07-01T11:52:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    const solar = poolSolarGainW(POOL, noon, 0.95);
    expect(solar).toBeGreaterThan(3000);
    const after = run(
      { waterTemperatureC: 20, heatPumpOn: false },
      { outdoorC: 26, windKmh: 6, solarGainW: solar, pumpRunning: false, setpointC: 27 },
      6 * 60,
    );
    expect(after.waterTemperatureC).toBeGreaterThan(20);
  });

  it("takes nothing from the sun at night", () => {
    const night = sunPosition(Date.parse("2026-07-01T23:00:00Z"), PARIS.lat, PARIS.lon, PARIS.tz);
    expect(poolSolarGainW(POOL, night, 0.95)).toBe(0);
  });

  it("loses to a cold night, slowly", () => {
    const start: PoolState = { waterTemperatureC: 26, heatPumpOn: false };
    const after = run(
      start,
      { outdoorC: 12, windKmh: 10, solarGainW: 0, pumpRunning: false, setpointC: 27 },
      10 * 60,
    );
    expect(after.waterTemperatureC).toBeLessThan(26);
    expect(after.waterTemperatureC).toBeGreaterThan(23);
  });

  it("evaporates more into a dry wind than into still air", () => {
    expect(poolEvaporationW(POOL, 26, 18, 30)).toBeGreaterThan(poolEvaporationW(POOL, 26, 18, 0));
    expect(poolEvaporationW(POOL, 12, 26, 5)).toBe(0);
  });

  it("holds around the setpoint rather than boiling past it", () => {
    let state: PoolState = { waterTemperatureC: 27, heatPumpOn: false };
    for (let day = 0; day < 5 * 24 * 60; day++) {
      state = stepPool(
        POOL,
        state,
        { outdoorC: 25, windKmh: 5, solarGainW: 0, pumpRunning: true, setpointC: 27 },
        60,
      );
    }
    expect(state.waterTemperatureC).toBeGreaterThan(25.5);
    expect(state.waterTemperatureC).toBeLessThan(28);
  });
});

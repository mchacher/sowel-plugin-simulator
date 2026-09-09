import { describe, expect, it } from "vitest";
import { roomById } from "../house/house.js";
import type { Room } from "../house/types.js";
import { sunPosition } from "./sun.js";
import {
  emitterMaxW,
  heatPumpCop,
  initialTemperatureC,
  solarGainW,
  stepRoom,
  type RoomThermalState,
} from "./thermal.js";

const SEJOUR = roomById("sejour");
const CHAMBRE = roomById("chambre-enfant-1");

function run(
  room: Room,
  start: RoomThermalState,
  inputs: Parameters<typeof stepRoom>[2],
  minutes: number,
): RoomThermalState {
  let state = start;
  for (let i = 0; i < minutes; i++) state = stepRoom(room, state, inputs, 60);
  return state;
}

describe("a room integrates", () => {
  it("follows a step change in outdoor temperature gradually, on its own time constant", () => {
    const start: RoomThermalState = { temperatureC: 20, heatingOn: false, emittedW: 0 };
    const inputs = {
      outdoorC: 0,
      solarGainW: 0,
      occupants: 0,
      setpointC: 20,
      heatingEnabled: false,
    };

    const afterOneMinute = stepRoom(CHAMBRE, start, inputs, 60);
    expect(20 - afterOneMinute.temperatureC).toBeLessThan(0.05);

    const afterAnHour = run(CHAMBRE, start, inputs, 60);
    expect(afterAnHour.temperatureC).toBeLessThan(20);
    expect(afterAnHour.temperatureC).toBeGreaterThan(17);

    // A first-order model covers about 63 % of the gap in one time constant.
    const tauMinutes = CHAMBRE.capacityJPerK / CHAMBRE.lossWPerK / 60;
    const afterTau = run(CHAMBRE, start, inputs, Math.round(tauMinutes));
    expect(afterTau.temperatureC).toBeGreaterThan(20 * (1 - 0.68));
    expect(afterTau.temperatureC).toBeLessThan(20 * (1 - 0.58));
  });

  it("never moves instantly, whatever the step", () => {
    const state = { temperatureC: 20, heatingOn: false, emittedW: 0 };
    const cold = stepRoom(
      CHAMBRE,
      state,
      { outdoorC: -30, solarGainW: 0, occupants: 0, setpointC: 20, heatingEnabled: false },
      60,
    );
    expect(20 - cold.temperatureC).toBeLessThan(0.2);
  });

  it("chases a setpoint and overshoots it rather than snapping to it", () => {
    let state: RoomThermalState = { temperatureC: 17, heatingOn: true, emittedW: 0 };
    const inputs = {
      outdoorC: 5,
      solarGainW: 0,
      occupants: 0,
      setpointC: 20.5,
      heatingEnabled: true,
    };
    let peak = -Infinity;
    let reachedAt = -1;
    for (let minute = 0; minute < 900; minute++) {
      state = stepRoom(SEJOUR, state, inputs, 60);
      if (reachedAt < 0 && state.temperatureC >= 20.5) reachedAt = minute;
      if (reachedAt >= 0) peak = Math.max(peak, state.temperatureC);
    }
    // It takes real time to get there, and the emitter's own lag carries it past.
    expect(reachedAt).toBeGreaterThan(20);
    expect(peak).toBeGreaterThan(20.5);
    expect(peak).toBeLessThan(22.5);
  });

  it("settles around the setpoint rather than drifting away from it", () => {
    let state: RoomThermalState = { temperatureC: 20.5, heatingOn: false, emittedW: 0 };
    const inputs = {
      outdoorC: 4,
      solarGainW: 0,
      occupants: 0,
      setpointC: 20.5,
      heatingEnabled: true,
    };
    for (let minute = 0; minute < 3 * 24 * 60; minute++)
      state = stepRoom(SEJOUR, state, inputs, 60);
    expect(Math.abs(state.temperatureC - 20.5)).toBeLessThan(1.5);
  });

  it("drifts towards outdoors when its heating is switched off", () => {
    let state: RoomThermalState = { temperatureC: 20.5, heatingOn: true, emittedW: 0 };
    const inputs = {
      outdoorC: 2,
      solarGainW: 0,
      occupants: 0,
      setpointC: 20.5,
      heatingEnabled: false,
    };
    for (let minute = 0; minute < 24 * 60; minute++) state = stepRoom(SEJOUR, state, inputs, 60);
    expect(state.temperatureC).toBeLessThan(15);
    expect(state.temperatureC).toBeGreaterThan(2);
  });

  it("airs a room that gets too hot instead of climbing forever", () => {
    let state: RoomThermalState = { temperatureC: 24, heatingOn: false, emittedW: 0 };
    const inputs = {
      outdoorC: 26,
      solarGainW: 1200,
      occupants: 2,
      setpointC: 20.5,
      heatingEnabled: false,
    };
    for (let minute = 0; minute < 8 * 60; minute++) state = stepRoom(SEJOUR, state, inputs, 60);
    expect(state.temperatureC).toBeLessThan(34);
  });

  it("takes the sun through an open shutter and nothing through a closed one", () => {
    const noon = sunPosition(Date.parse("2026-06-21T11:52:00Z"), 48.8566, 2.3522, "Europe/Paris");
    const open = solarGainW(SEJOUR, noon, 1, () => 1);
    const closed = solarGainW(SEJOUR, noon, 1, () => 0);
    const cloudy = solarGainW(SEJOUR, noon, 0.2, () => 1);
    expect(open).toBeGreaterThan(500);
    expect(closed).toBe(0);
    expect(cloudy).toBeLessThan(open);

    const night = sunPosition(Date.parse("2026-06-21T23:00:00Z"), 48.8566, 2.3522, "Europe/Paris");
    expect(solarGainW(SEJOUR, night, 1, () => 1)).toBe(0);
  });

  it("holds an outdoor room at the outdoor temperature", () => {
    const terrasse = roomById("terrasse");
    const state = stepRoom(
      terrasse,
      { temperatureC: 5, heatingOn: false, emittedW: 0 },
      { outdoorC: 18, solarGainW: 0, occupants: 0, setpointC: 0, heatingEnabled: false },
      60,
    );
    expect(state.temperatureC).toBe(18);
  });

  it("sizes an emitter on the room's own losses and costs more when it is cold", () => {
    expect(emitterMaxW(SEJOUR)).toBeGreaterThan(emitterMaxW(CHAMBRE));
    expect(heatPumpCop(12)).toBeGreaterThan(heatPumpCop(-5));
    expect(heatPumpCop(-20)).toBeGreaterThanOrEqual(1.8);
    expect(heatPumpCop(40)).toBeLessThanOrEqual(4.8);
  });

  it("starts from a plausible guess it will forget anyway", () => {
    expect(initialTemperatureC(SEJOUR, 3)).toBeGreaterThan(18);
    expect(initialTemperatureC(roomById("garage"), 3)).toBeLessThan(10);
  });
});

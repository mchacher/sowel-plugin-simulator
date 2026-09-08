/**
 * The thermal model (spec 001, FR6).
 *
 * A first-order model per room. What matters is that a room's temperature is a
 * **state that integrates**, not a number drawn from a curve: a step change
 * outdoors moves it over hours, and a thermostat's own measurement chases its
 * setpoint and overshoots it rather than snapping to it.
 *
 * The overshoot is not faked on top. It falls out of two ordinary facts: a
 * thermostat switches on hysteresis, and an emitter does not go cold the instant
 * it is told to stop.
 */

import { ORIENTATION_AZIMUTH, type Room } from "../house/types.js";
import { clearSkyIrradiance, incidenceFactor, type SunPosition } from "./sun.js";

/** Watts a person adds to the room they are in. */
export const OCCUPANT_GAIN_W = 90;

/** Fraction of the beam that gets through glazing. */
const GLAZING_TRANSMITTANCE = 0.62;

/** How fast an emitter's output follows what it was told, seconds. */
const EMITTER_TAU_S = 900;

/** Hysteresis band around the setpoint, kelvin. */
const HYSTERESIS_K = 0.25;

/** Above this, the occupants open a window. */
const VENTILATION_THRESHOLD_C = 25;
/** How much airing multiplies a room's losses. */
const VENTILATION_MULTIPLIER = 3.5;

export interface RoomThermalState {
  temperatureC: number;
  /** Whether the room's heating is calling for heat. */
  heatingOn: boolean;
  /** Thermal watts the emitter is actually putting out. */
  emittedW: number;
}

/** Peak thermal output of a room's emitter, sized on its own losses. */
export function emitterMaxW(room: Room): number {
  return room.lossWPerK * 32;
}

/**
 * Solar gain through a room's windows, watts. A shutter in front of a window
 * blocks it, which is what makes closing the shutters at dusk a thermal decision
 * and not only a privacy one.
 */
export function solarGainW(
  room: Room,
  sun: SunPosition,
  cloudFactor: number,
  shutterOpenFraction: (deviceId: string) => number,
): number {
  if (!sun.isDay) return 0;
  const beam = clearSkyIrradiance(sun.elevationDeg) * cloudFactor;
  let total = 0;
  for (const window of room.windows) {
    const open = window.shutterDeviceId ? shutterOpenFraction(window.shutterDeviceId) : 1;
    if (open <= 0) continue;
    const factor = incidenceFactor(ORIENTATION_AZIMUTH[window.orientation], sun);
    total += beam * factor * window.areaM2 * GLAZING_TRANSMITTANCE * open;
  }
  return total;
}

export interface ThermalInputs {
  outdoorC: number;
  solarGainW: number;
  occupants: number;
  /** Target the room's heating is aiming for. */
  setpointC: number;
  /** False when the room's heating is switched off entirely. */
  heatingEnabled: boolean;
}

/** One integration step. Pure: same inputs, same output. */
export function stepRoom(
  room: Room,
  state: RoomThermalState,
  inputs: ThermalInputs,
  dtS: number,
): RoomThermalState {
  if (room.outdoor) {
    return { temperatureC: inputs.outdoorC, heatingOn: false, emittedW: 0 };
  }

  // A thermostat switches on hysteresis, like every real one.
  let heatingOn = state.heatingOn;
  if (!inputs.heatingEnabled || room.heating === "none") {
    heatingOn = false;
  } else if (state.temperatureC < inputs.setpointC - HYSTERESIS_K) {
    heatingOn = true;
  } else if (state.temperatureC > inputs.setpointC + HYSTERESIS_K) {
    heatingOn = false;
  }

  // The emitter lags its command, so heat keeps arriving after the call stops.
  // This is where the overshoot of FR6 comes from.
  const commandedW = heatingOn ? emitterMaxW(room) : 0;
  const alpha = 1 - Math.exp(-dtS / EMITTER_TAU_S);
  const emittedW = state.emittedW + (commandedW - state.emittedW) * alpha;

  // Above a comfortable ceiling, and only while outdoors is cooler, the room
  // gets aired: someone opens a window. Without it a south-facing living room
  // climbs past any temperature a person would sit in, which no house does.
  const overheating = state.temperatureC > VENTILATION_THRESHOLD_C;
  const canCool = inputs.outdoorC < state.temperatureC;
  const lossCoefficient =
    overheating && canCool ? room.lossWPerK * VENTILATION_MULTIPLIER : room.lossWPerK;
  const lossW = lossCoefficient * (state.temperatureC - inputs.outdoorC);
  const netW = inputs.solarGainW + inputs.occupants * OCCUPANT_GAIN_W + emittedW - lossW;
  const temperatureC = state.temperatureC + (netW * dtS) / room.capacityJPerK;

  return { temperatureC, heatingOn, emittedW };
}

/**
 * A plausible temperature to start integrating from at plugin start. It does not
 * need to be right: a first-order model forgets its initial condition, and the
 * warm-up from local midnight is long enough that it has.
 */
export function initialTemperatureC(room: Room, outdoorC: number): number {
  if (room.outdoor) return outdoorC;
  if (room.heating === "none") return (outdoorC * 2 + room.setpointC) / 3;
  return room.setpointC - 0.5;
}

/**
 * Coefficient of performance of an air-source heat pump against outdoor
 * temperature. Cold air is expensive, which is exactly when the house wants heat.
 */
export function heatPumpCop(outdoorC: number): number {
  return Math.max(1.8, Math.min(4.8, 2.2 + 0.09 * outdoorC));
}

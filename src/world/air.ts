/**
 * Indoor air (spec 001, FR8).
 *
 * CO₂ climbs while a room is occupied and decays over roughly half an hour once
 * it empties. Humidity spikes in the bathroom after the shower. Noise follows
 * occupation. All three are states that relax towards a target, so they are
 * continuous across a tick and legible on a chart.
 */

import type { Room } from "../house/types.js";

export const CO2_OUTDOOR_PPM = 420;

/** How fast CO₂ approaches its target, seconds. */
const CO2_TAU_S = 1500;
/** How fast a humidity or noise spike fades, seconds. */
const HUMIDITY_TAU_S = 900;

export interface AirState {
  co2Ppm: number;
  humidityPct: number;
  noiseDb: number;
}

export interface AirInputs {
  occupants: number;
  outdoorHumidityPct: number;
  /** Extra relative humidity being added right now — a shower, a pan boiling. */
  moistureBoostPct: number;
}

function relax(current: number, target: number, tauS: number, dtS: number): number {
  return current + (target - current) * (1 - Math.exp(-dtS / tauS));
}

export function stepAir(room: Room, state: AirState, inputs: AirInputs, dtS: number): AirState {
  // A bigger room dilutes the same person more.
  const perOccupantPpm = (380 * 20) / Math.max(6, room.floorAreaM2);
  const co2Target = CO2_OUTDOOR_PPM + inputs.occupants * perOccupantPpm;
  const co2Ppm = relax(state.co2Ppm, co2Target, CO2_TAU_S, dtS);

  const humidityTarget = Math.max(
    28,
    Math.min(95, 25 + inputs.outdoorHumidityPct * 0.35 + inputs.moistureBoostPct),
  );
  const humidityPct = relax(state.humidityPct, humidityTarget, HUMIDITY_TAU_S, dtS);

  // Noise has no inertia worth modelling: a room with people in it is loud now.
  const noiseDb = 31 + inputs.occupants * 7.5;

  return { co2Ppm, humidityPct, noiseDb };
}

export function initialAir(room: Room, outdoorHumidityPct: number): AirState {
  return {
    co2Ppm: CO2_OUTDOOR_PPM + 60,
    humidityPct: Math.max(30, 25 + outdoorHumidityPct * 0.35),
    noiseDb: 31,
  };
}

/**
 * Daylight reaching a room, in lux. Rough but monotonic in the things that
 * matter: the sun's height, the cloud, the glazed area and whether the shutter
 * is open.
 */
export function daylightLux(room: Room, beamOnWindowsW: number): number {
  if (room.floorAreaM2 <= 0) return 0;
  // ~110 lux per W/m² of daylight, spread over the floor.
  return Math.max(0, (beamOnWindowsW * 110) / room.floorAreaM2);
}

/**
 * Energy (spec 001, FR9 and FR9b).
 *
 * ```
 * production = pvPeak · poa(sun, tilt) · cloudFactor
 * load       = base + lighting + Σ appliances + heatPump + Σ flexibleLoads
 * grid       = load − production            (signed; negative is export)
 * ```
 *
 * The grid is computed from the model every tick rather than smoothed here,
 * because the energy arbiter (core spec 140) is the only component allowed to
 * smooth it, and it does its own reservation accounting on top. Switching a load
 * on has to move this number immediately or the arbiter has nothing to read.
 */

import type { House, LoadId } from "../house/types.js";
import { localParts } from "./clock.js";
import { smoothNoise } from "./random.js";
import { clearSkyIrradiance, incidenceFactor, type SunPosition } from "./sun.js";

/** Tilt and orientation of the array. */
const ARRAY_TILT_DEG = 30;
const ARRAY_AZIMUTH_DEG = 180;

/** Plane-of-array irradiance, W/m². */
export function planeOfArrayW(sun: SunPosition, cloudFactor: number): number {
  if (!sun.isDay) return 0;
  const beam = clearSkyIrradiance(sun.elevationDeg) * cloudFactor;
  return beam * incidenceFactor(ARRAY_AZIMUTH_DEG, sun, ARRAY_TILT_DEG);
}

export function pvProductionW(house: House, sun: SunPosition, cloudFactor: number): number {
  const poa = planeOfArrayW(sun, cloudFactor);
  const raw = house.pv.peakW * (poa / 1000) * (1 - house.pv.systemLoss);
  return Math.max(0, Math.min(house.pv.peakW, raw));
}

/** A fridge is on for about twenty minutes in every hour, all year round. */
const FRIDGE_W = 90;
const FRIDGE_CYCLE_S = 1200;

/**
 * The household floor.
 *
 * It wanders, and that is not decoration. A house whose live power reads exactly
 * the same watt minute after minute is the single clearest tell that a demo is a
 * mock — real standby load breathes, because a fridge cycles, a boiler pump
 * starts, a laptop charges. It also matters downstream: the energy arbiter
 * smooths the meter over sixty seconds, and a signal with no texture at all is
 * not what it was tuned against.
 */
export function baseLoadW(house: House, ts: number, tz: string, seed: number): number {
  const { hour } = localParts(ts, tz);
  const floor =
    hour < 6 || hour >= 23
      ? house.baseLoadW.night
      : hour >= 18
        ? house.baseLoadW.evening
        : house.baseLoadW.day;

  const wander = 1 + smoothNoise(seed, "base-load", ts / 1000, 420) * 0.12;
  const fridgeOn = Math.floor(ts / 1000 / FRIDGE_CYCLE_S) % 3 === 0;
  return floor * wander + (fridgeOn ? FRIDGE_W : 0);
}

export type LoadPowers = Record<LoadId, number>;

export interface EnergyCounters {
  /** Cumulative Wh since local midnight. Monotonic within the day (FR3). */
  importedWh: number;
  exportedWh: number;
  producedWh: number;
  perLoadWh: Record<string, number>;
}

export function emptyCounters(house: House): EnergyCounters {
  const perLoadWh: Record<string, number> = {};
  for (const load of house.loads) perLoadWh[load.id] = 0;
  return { importedWh: 0, exportedWh: 0, producedWh: 0, perLoadWh };
}

export interface EnergyState {
  productionW: number;
  loadW: number;
  gridW: number;
  loads: LoadPowers;
  counters: EnergyCounters;
}

/** Integrate the counters over one step. Mutates nothing; returns the new set. */
export function accumulate(
  counters: EnergyCounters,
  productionW: number,
  gridW: number,
  loads: LoadPowers,
  dtS: number,
): EnergyCounters {
  const hours = dtS / 3600;
  const perLoadWh = { ...counters.perLoadWh };
  for (const [id, watts] of Object.entries(loads)) {
    perLoadWh[id] = (perLoadWh[id] ?? 0) + watts * hours;
  }
  return {
    importedWh: counters.importedWh + Math.max(0, gridW) * hours,
    exportedWh: counters.exportedWh + Math.max(0, -gridW) * hours,
    producedWh: counters.producedWh + productionW * hours,
    perLoadWh,
  };
}

/** Nominal mains voltage with the small sag a real clamp reports under load. */
export function gridVoltageV(gridW: number): number {
  return 232 - Math.min(6, Math.abs(gridW) / 900);
}

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

export function baseLoadW(house: House, ts: number, tz: string): number {
  const { hour } = localParts(ts, tz);
  if (hour < 6 || hour >= 23) return house.baseLoadW.night;
  if (hour >= 18 && hour < 23) return house.baseLoadW.evening;
  return house.baseLoadW.day;
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

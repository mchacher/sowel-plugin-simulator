/**
 * The pool (spec 001, FR9c).
 *
 * Fifty cubic metres of water is a thermal mass with a time constant of days.
 * That is the whole point of putting it in the demo: an hour of heat pump on
 * surplus moves the water by roughly a tenth of a degree, and an afternoon of it
 * is visible on a chart. A pool that warmed a degree an hour would quietly teach
 * a visitor the wrong thing about what an energy arbiter does.
 */

import type { PoolSpec } from "../house/types.js";
import { clearSkyIrradiance, incidenceFactor, type SunPosition } from "./sun.js";

/** Specific heat of water, J per kg per kelvin. */
const WATER_C = 4186;
/** Fraction of incident sun the water keeps. */
const ABSORPTANCE = 0.85;
/** Evaporation and convection from the surface, W per m² per kelvin of excess. */
const EVAPORATION_W_PER_M2_K = 8;

export interface PoolState {
  waterTemperatureC: number;
  heatPumpOn: boolean;
}

export function poolCapacityJPerK(pool: PoolSpec): number {
  return pool.volumeM3 * 1000 * WATER_C;
}

export function poolSolarGainW(pool: PoolSpec, sun: SunPosition, cloudFactor: number): number {
  if (!sun.isDay) return 0;
  // A pool is a horizontal surface: tilt 0, so orientation does not matter.
  const beam = clearSkyIrradiance(sun.elevationDeg) * cloudFactor;
  return beam * incidenceFactor(180, sun, 0) * pool.surfaceM2 * ABSORPTANCE;
}

export function poolEvaporationW(
  pool: PoolSpec,
  waterC: number,
  outdoorC: number,
  windKmh: number,
): number {
  const excess = Math.max(0, waterC - outdoorC + 2);
  return pool.surfaceM2 * EVAPORATION_W_PER_M2_K * excess * (1 + windKmh / 45);
}

export interface PoolInputs {
  outdoorC: number;
  windKmh: number;
  solarGainW: number;
  /** The pool pump has to be running for the heat pump to do anything. */
  pumpRunning: boolean;
  setpointC: number;
}

export function stepPool(
  pool: PoolSpec,
  state: PoolState,
  inputs: PoolInputs,
  dtS: number,
): PoolState {
  // A pool heat pump is interlocked on its pump: no flow, no heating. And it
  // stops when the air is too cold to extract anything useful from.
  const heatPumpOn =
    inputs.pumpRunning &&
    inputs.outdoorC > 10 &&
    (state.heatPumpOn
      ? state.waterTemperatureC < inputs.setpointC + 0.2
      : state.waterTemperatureC < inputs.setpointC - 0.5);

  const lossW = pool.lossWPerK * (state.waterTemperatureC - inputs.outdoorC);
  const evaporationW = poolEvaporationW(
    pool,
    state.waterTemperatureC,
    inputs.outdoorC,
    inputs.windKmh,
  );
  const heatingW = heatPumpOn ? pool.heatPumpThermalW : 0;
  const netW = inputs.solarGainW + heatingW - lossW - evaporationW;

  return {
    waterTemperatureC: state.waterTemperatureC + (netW * dtS) / poolCapacityJPerK(pool),
    heatPumpOn,
  };
}

export function initialPoolTemperatureC(pool: PoolSpec, outdoorC: number): number {
  // Water lags the air by a lot, and never far below it in a heated pool.
  return Math.max(outdoorC, Math.min(pool.setpointC, outdoorC + 4));
}

/**
 * Loads that run on their own (spec 001, FR9).
 *
 * Two different things live here and the difference matters.
 *
 * **Agenda-driven appliances** — cooking, the dishwasher, the laundry — are
 * background load in the arbiter's sense: never arbitrated, only ever seen
 * through the meter. They follow the household.
 *
 * **A flexible load's own programme** — the water heater heating off-peak, the
 * pool pump on its built-in timer — is part of the appliance, not home
 * automation. A water heater has had a night-rate clock in it for fifty years.
 * What a recipe adds on top, in spec 002, is the surplus charge.
 */

import type { House, LoadId } from "../house/types.js";
import { localParts } from "./clock.js";
import { isCooking } from "./occupants.js";
import type { ActuatorStates } from "./actuators.js";

/** Minutes from midnight the off-peak window opens and closes. */
const OFF_PEAK_START = 22 * 60 + 30;
const OFF_PEAK_END = 6 * 60 + 30;

/** The pool pump's built-in timer. */
const POOL_PUMP_START = 11 * 60;
const POOL_PUMP_END = 15 * 60;

export interface ApplianceCycle {
  running: boolean;
  watts: number;
}

/** A wash cycle's power profile: heat, tumble, and for the dishwasher a dry. */
function washProfile(elapsedMin: number, durationMin: number, peakW: number): number {
  if (elapsedMin < durationMin * 0.28) return peakW;
  if (elapsedMin > durationMin * 0.82) return peakW * 0.75;
  return 180;
}

function cycleAt(
  minutes: number,
  startMin: number,
  durationMin: number,
  peakW: number,
): ApplianceCycle {
  if (minutes < startMin || minutes >= startMin + durationMin) return { running: false, watts: 0 };
  return { running: true, watts: washProfile(minutes - startMin, durationMin, peakW) };
}

export interface ApplianceInputs {
  ts: number;
  tz: string;
  house: House;
  actuators: ActuatorStates;
  /** Whether the pool heat pump is currently calling for heat. */
  poolHeatPumpOn: boolean;
  /** Whether the water heater's element is on — its tank decides, not a schedule. */
  waterHeaterHeating: boolean;
  /** Thermal watts the house's heat pump is delivering right now. */
  houseHeatingThermalW: number;
  /** Its coefficient of performance at the current outdoor temperature. */
  heatPumpCop: number;
}

export function inOffPeak(minutes: number): boolean {
  return minutes >= OFF_PEAK_START || minutes < OFF_PEAK_END;
}

export function poolPumpScheduled(minutes: number): boolean {
  return minutes >= POOL_PUMP_START && minutes < POOL_PUMP_END;
}

export function loadPowers(inputs: ApplianceInputs): Record<LoadId, number> {
  const { minutes, weekday } = localParts(inputs.ts, inputs.tz);
  const nominal = (id: LoadId): number =>
    inputs.house.loads.find((l) => l.id === id)?.nominalW ?? 0;

  const poolPumpRelay = inputs.actuators.relays["sim-relay-pool-pump"];

  // The pool pump runs on its timer unless something has switched its relay off.
  const poolPumpOn = (poolPumpRelay ?? true) && poolPumpScheduled(minutes);

  const dishwasher = cycleAt(minutes, 20 * 60 + 30, 95, nominal("dishwasher"));
  const laundry =
    weekday === 6
      ? cycleAt(minutes, 10 * 60, 100, nominal("washing-machine"))
      : { running: false, watts: 0 };

  return {
    "heat-pump": inputs.houseHeatingThermalW / Math.max(1, inputs.heatPumpCop),
    "water-heater": inputs.waterHeaterHeating ? nominal("water-heater") : 0,
    "pool-pump": poolPumpOn ? nominal("pool-pump") : 0,
    "pool-heat-pump": inputs.poolHeatPumpOn ? nominal("pool-heat-pump") : 0,
    cooking: isCooking(inputs.ts, inputs.tz) ? nominal("cooking") : 0,
    dishwasher: dishwasher.watts,
    "washing-machine": laundry.watts,
  };
}

/** Whether an appliance is mid-cycle, for `appliance_state`. */
export function applianceRunning(ts: number, tz: string, load: LoadId): boolean {
  const { minutes, weekday } = localParts(ts, tz);
  if (load === "dishwasher") return minutes >= 20 * 60 + 30 && minutes < 20 * 60 + 30 + 95;
  if (load === "washing-machine") {
    return weekday === 6 && minutes >= 10 * 60 && minutes < 10 * 60 + 100;
  }
  return false;
}

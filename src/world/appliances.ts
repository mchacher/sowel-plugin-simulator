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

/**
 * When the pool pump is **assumed** to have run, for reconstructing the pool's
 * past at start-up (spec 001, FR3). It is not a timer the plugin obeys.
 *
 * The pump has no built-in schedule here, unlike the water heater's off-peak
 * clock: in this house its hours are a Sowel recipe's (`pool-pump-schedule`), and
 * a simulator that scheduled it too would be doing automation. It would also
 * break the arbiter — a load running without a grant looks to spec 140 exactly
 * like a hand on a wall switch, and the arbiter correctly suspends itself on that
 * load. It did, on a real instance, with the reason `wall-switch-on`.
 *
 * The pool's twelve-day warm-up still needs to guess what happened before the
 * plugin existed, and this is that guess.
 */
const ASSUMED_PUMP_START = 11 * 60;
const ASSUMED_PUMP_END = 15 * 60;

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

export function poolPumpAssumedRunning(minutes: number): boolean {
  return minutes >= ASSUMED_PUMP_START && minutes < ASSUMED_PUMP_END;
}

export function loadPowers(inputs: ApplianceInputs): Record<LoadId, number> {
  const { minutes, weekday } = localParts(inputs.ts, inputs.tz);
  const nominal = (id: LoadId): number =>
    inputs.house.loads.find((l) => l.id === id)?.nominalW ?? 0;

  // The pump runs when its relay is closed, and nothing else. Whoever closed it —
  // a recipe on a schedule, the arbiter's claimant, a visitor — owns the decision.
  const poolPumpOn = inputs.actuators.relays["sim-relay-pool-pump"] ?? false;

  const dishwasher = cycleAt(minutes, 20 * 60 + 30, 95, nominal("dishwasher"));
  const laundry =
    weekday === 6
      ? cycleAt(minutes, 10 * 60, 100, nominal("washing-machine"))
      : { running: false, watts: 0 };

  return {
    "heat-pump": inputs.houseHeatingThermalW / Math.max(1, inputs.heatPumpCop),
    // The compressor's electrical draw. Its thermal output is three times this,
    // and it goes into the tank, not into the meter.
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

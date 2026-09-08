/**
 * The household (spec 001, FR7).
 *
 * A function of the clock, not a state machine: FR3 forbids state that cannot be
 * recomputed, so where someone is at 15:07 is derived, never remembered. The
 * transitions that matter — the front door opening — are detected by the world
 * as a change between two ticks.
 *
 * Presence reaches Sowel through the motion sensors, not through these. An
 * occupant is not in a zone, it moves between them, so it is not something a
 * person binds to an equipment. What a person binds is a PIR in a room.
 */

import type { House, Occupant } from "../house/types.js";
import { dayNumber, isWeekend, localParts } from "./clock.js";
import { rngFor } from "./random.js";

export const AWAY = "away" as const;

export interface OccupantState {
  id: string;
  /** A room id, or `away`. */
  place: string;
  present: boolean;
  asleep: boolean;
}

interface DaySchedule {
  wake: number;
  sleep: number;
  /** Null when the occupant does not leave that day. */
  leave: number | null;
  back: number | null;
  /** Minutes from midnight when this occupant takes their shower. */
  shower: number;
}

function scheduleFor(
  occupant: Occupant,
  index: number,
  ts: number,
  tz: string,
  seed: number,
): DaySchedule {
  const rng = rngFor(seed, dayNumber(ts, tz), `occupant:${occupant.id}`);
  const jitter = (): number => Math.round(rng.range(-12, 12));
  const { weekday } = localParts(ts, tz);
  const weekend = isWeekend(ts, tz);
  const staysHome = occupant.homeDays?.includes(weekday) ?? false;

  if (weekend) {
    const wake = occupant.weekend.wake + jitter();
    return {
      wake,
      sleep: occupant.weekend.sleep,
      leave: null,
      back: null,
      shower: wake + index * 18,
    };
  }
  const wake = occupant.weekday.wake + jitter();
  return {
    wake,
    sleep: occupant.weekday.sleep,
    leave: staysHome ? null : occupant.weekday.leave + jitter(),
    back: staysHome ? null : occupant.weekday.back + jitter(),
    shower: wake + index * 18,
  };
}

const DINNER_START = 19 * 60 + 40;
const DINNER_END = 20 * 60 + 20;
const COOKING_START = 18 * 60 + 50;

function placeFor(
  occupant: Occupant,
  index: number,
  minutes: number,
  schedule: DaySchedule,
  weekday: number,
): { place: string; asleep: boolean } {
  if (minutes < schedule.wake || minutes >= schedule.sleep) {
    return { place: occupant.bedroom, asleep: true };
  }
  if (schedule.leave !== null && schedule.back !== null) {
    if (minutes >= schedule.leave && minutes < schedule.back) return { place: AWAY, asleep: false };
    if (minutes >= schedule.leave - 4 && minutes < schedule.leave) {
      return { place: "entree", asleep: false };
    }
    if (minutes >= schedule.back && minutes < schedule.back + 3) {
      return { place: "entree", asleep: false };
    }
  }
  if (minutes >= schedule.shower && minutes < schedule.shower + 16) {
    return { place: "salle-de-bain", asleep: false };
  }
  if (minutes >= schedule.wake && minutes < schedule.wake + 45) {
    return { place: "cuisine", asleep: false };
  }
  if (
    occupant.homeWorkRoom &&
    (occupant.homeDays?.includes(weekday) ?? false) &&
    minutes >= 9 * 60 &&
    minutes < 18 * 60
  ) {
    return { place: occupant.homeWorkRoom, asleep: false };
  }
  // One adult cooks; everyone eats.
  if (index === 0 && minutes >= COOKING_START && minutes < DINNER_START) {
    return { place: "cuisine", asleep: false };
  }
  if (minutes >= DINNER_START && minutes < DINNER_END) return { place: "cuisine", asleep: false };
  return { place: "sejour", asleep: false };
}

export function occupantsAt(ts: number, tz: string, house: House, seed: number): OccupantState[] {
  const { minutes, weekday } = localParts(ts, tz);
  return house.occupants.map((occupant, index) => {
    const schedule = scheduleFor(occupant, index, ts, tz, seed);
    const { place, asleep } = placeFor(occupant, index, minutes, schedule, weekday);
    return { id: occupant.id, place, present: place !== AWAY, asleep };
  });
}

/** How many people are in each room. */
export function occupancyByRoom(states: OccupantState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    if (state.place === AWAY) continue;
    counts.set(state.place, (counts.get(state.place) ?? 0) + 1);
  }
  return counts;
}

/** True while someone is cooking, which is what the kitchen clamp sees. */
export function isCooking(ts: number, tz: string): boolean {
  const { minutes } = localParts(ts, tz);
  return minutes >= COOKING_START && minutes < DINNER_START;
}

/**
 * What the house's past assumes Sowel did (spec 004, FR2).
 *
 * Live, this plugin does no automation: a relay stays open until someone closes
 * it — a recipe, the arbiter, a visitor. A past computed that way would be a house
 * where nothing ever runs. So the replay applies habits: the simplest version of
 * what the fixture's own automation does, every one of them an assumption and all
 * of them here. Nothing live calls this module; the pool's warm-up reads the pump's
 * hours from it, because that too is a guess about a past the plugin was not there
 * for.
 */

import type { House } from "../house/types.js";
import { localParts } from "./clock.js";
import type { World, WorldState } from "./world.js";

/** The pool pump's hours, as its schedule recipe runs them. */
const POOL_PUMP_START_MIN = 11 * 60;
const POOL_PUMP_END_MIN = 15 * 60;
/** The heating's day, and how far it sets back outside it. */
const COMFORT_FROM_MIN = 6 * 60 + 30;
const COMFORT_TO_MIN = 22 * 60 + 30;
const NIGHT_SETBACK_K = 2;

/** Whether the pool pump is assumed to run at this local minute of the day. */
export function poolPumpHabit(minutes: number): boolean {
  return minutes >= POOL_PUMP_START_MIN && minutes < POOL_PUMP_END_MIN;
}

export class Habits {
  /** What was last applied, per actuator, so a travel is started once. */
  private readonly applied = new Map<string, number | boolean>();

  constructor(
    private readonly house: House,
    private readonly timezone: string,
  ) {}

  /** Set the actuators for the next step, from what the house looks like now. */
  apply(world: World, state: WorldState): void {
    const { minutes } = localParts(state.ts, this.timezone);
    const daylight =
      state.sunrise !== null &&
      state.sunset !== null &&
      state.ts >= state.sunrise &&
      state.ts < state.sunset;
    const awake = new Set(
      state.occupants.filter((o) => o.present && !o.asleep).map((o) => o.place),
    );
    const comfort = minutes >= COMFORT_FROM_MIN && minutes < COMFORT_TO_MIN;

    for (const device of this.house.devices) {
      const lit = !daylight && device.room !== undefined && awake.has(device.room);
      switch (device.archetype) {
        case "relay":
          if (device.load === "pool-pump") {
            this.once(device.id, poolPumpHabit(minutes), (on) => world.setRelay(device.id, on));
          } else if (device.load === undefined) {
            this.once(device.id, lit, (on) => world.setRelay(device.id, on));
          }
          break;
        case "relay_4ch":
          this.once(device.id, lit, (on) => {
            for (let i = 0; i < (device.channels ?? 4); i++)
              world.setRelayChannel(device.id, i, on);
          });
          break;
        case "dimmer":
          this.once(device.id, lit, (on) => world.setDimmerPower(device.id, on));
          break;
        case "shutter":
          this.once(device.id, daylight ? 100 : 0, (position) =>
            world.setShutterPosition(device.id, position),
          );
          break;
        case "thermostat": {
          const room = this.house.rooms.find((r) => r.id === device.room);
          if (!room) break;
          const setpoint = room.setpointC - (comfort ? 0 : NIGHT_SETBACK_K);
          this.once(device.id, setpoint, (c) => world.setThermostatSetpoint(device.id, c));
          break;
        }
        default:
          break;
      }
    }
  }

  private once<T extends number | boolean>(id: string, value: T, set: (value: T) => void): void {
    if (this.applied.get(id) === value) return;
    this.applied.set(id, value);
    set(value);
  }
}

/**
 * What a visitor changed (spec 002, FR3).
 *
 * The world model is a function of the clock (spec 001, FR3). A simulation order
 * is the one thing that is not, so overrides are held apart from the model, each
 * with an expiry, and folded in at the edges.
 *
 * They are deliberately short-lived. The house has to converge back on its
 * agenda, because the alternative is a demo that drifts further from itself with
 * every visitor and needs the nightly reset to mean something.
 */

import type { Condition } from "./weather.js";

/** How long a `sim.motion` pulse keeps a sensor reporting. */
export const MOTION_PULSE_MS = 45_000;
/** How long `sim.open` holds a door open. */
export const DOOR_PULSE_MS = 12_000;

export class Overrides {
  private readonly motionUntil = new Map<string, number>();
  private readonly doorUntil = new Map<string, number>();
  private forcedWeather: { condition: Condition; day: number } | undefined;
  private readonly occupants = new Map<string, { present: boolean; day: number }>();

  // — motion ————————————————————————————————————————————————

  /**
   * A pulse is keyed by **room**, not by sensor. A visitor clicking a room means
   * "there is someone in here", and the living room has three motion sensors —
   * pulsing only the one that was addressed would leave the other two insisting
   * the room is empty.
   */
  pulseMotion(roomId: string, now: number, durationMs = MOTION_PULSE_MS): void {
    this.motionUntil.set(roomId, now + durationMs);
  }

  motionForced(roomId: string, now: number): boolean {
    return (this.motionUntil.get(roomId) ?? 0) > now;
  }

  // — doors ——————————————————————————————————————————————————

  openDoor(deviceId: string, now: number, durationMs = DOOR_PULSE_MS): void {
    this.doorUntil.set(deviceId, now + durationMs);
  }

  /** `sim.close` is immediate: a door someone shuts is shut. */
  closeDoor(deviceId: string): void {
    this.doorUntil.delete(deviceId);
  }

  doorOpen(deviceId: string, now: number): boolean {
    return (this.doorUntil.get(deviceId) ?? 0) > now;
  }

  // — weather ————————————————————————————————————————————————

  forceWeather(condition: Condition, day: number): void {
    this.forcedWeather = { condition, day };
  }

  /** The forced sky for that local day, if a visitor asked for one. */
  weatherFor(day: number): Condition | undefined {
    return this.forcedWeather?.day === day ? this.forcedWeather.condition : undefined;
  }

  // — occupants ——————————————————————————————————————————————

  setOccupant(id: string, present: boolean, day: number): void {
    this.occupants.set(id, { present, day });
  }

  occupantForced(id: string, day: number): boolean | undefined {
    const entry = this.occupants.get(id);
    return entry?.day === day ? entry.present : undefined;
  }

  /** Everything scoped to a local day goes when the day does. */
  clearDayScoped(): void {
    this.forcedWeather = undefined;
    this.occupants.clear();
  }

  clear(): void {
    this.motionUntil.clear();
    this.doorUntil.clear();
    this.occupants.clear();
    this.forcedWeather = undefined;
  }
}

/**
 * Transitions in flight (spec 002, FR1 and FR2).
 *
 * No actuator is instant, and the ones that are not are the ones a visitor
 * watches: a shutter takes twenty-odd seconds to come down and a dimmer about a
 * second to reach a level. A model that snapped them to their target would
 * publish a value that was never true, and the interface would show a shutter
 * that is closed before it has moved.
 *
 * A transition is a target and a rate. The tick steps it; nothing here knows
 * about Sowel or about orders.
 */

/** Percent of travel per second — twenty-five seconds end to end. */
export const SHUTTER_RATE_PCT_PER_S = 4;
/** Brightness steps per second, on the 0–254 scale: about a second, visibly a ramp. */
export const DIMMER_RATE_PER_S = 254;
/** How long a gate contact stays closed. A gate order is momentary. */
export const GATE_PULSE_MS = 2000;

export interface Transition {
  /** Where the value is now. */
  current: number;
  target: number;
  ratePerSecond: number;
}

export function startTransition(
  existing: Transition | undefined,
  from: number,
  target: number,
  ratePerSecond: number,
): Transition {
  // Re-targeting mid-travel continues from where it is rather than jumping back
  // to where it started.
  return { current: existing?.current ?? from, target, ratePerSecond };
}

/** Advance one transition. Returns null once it has arrived. */
export function stepTransition(transition: Transition, dtS: number): Transition | null {
  const remaining = transition.target - transition.current;
  const move = transition.ratePerSecond * dtS;
  if (Math.abs(remaining) <= move) return null;
  return { ...transition, current: transition.current + Math.sign(remaining) * move };
}

/**
 * The transitions the house has in flight, keyed by device id.
 *
 * Stopping is not the same as arriving: `stop` freezes a shutter where it is,
 * which is what `STOP` means and why it must never be debounced.
 */
export class Transitions {
  private readonly inFlight = new Map<string, Transition>();

  start(deviceId: string, from: number, target: number, ratePerSecond: number): void {
    this.inFlight.set(
      deviceId,
      startTransition(this.inFlight.get(deviceId), from, target, ratePerSecond),
    );
  }

  /** Freeze where it is; returns the position it stopped at, or undefined. */
  stop(deviceId: string): number | undefined {
    const transition = this.inFlight.get(deviceId);
    if (!transition) return undefined;
    this.inFlight.delete(deviceId);
    return transition.current;
  }

  has(deviceId: string): boolean {
    return this.inFlight.has(deviceId);
  }

  clear(): void {
    this.inFlight.clear();
  }

  /**
   * Advance everything by `dtS` and report where each value now is. An entry
   * that has arrived is reported at its target and then forgotten.
   */
  step(dtS: number): Map<string, number> {
    const positions = new Map<string, number>();
    for (const [deviceId, transition] of [...this.inFlight]) {
      const next = stepTransition(transition, dtS);
      if (next === null) {
        positions.set(deviceId, transition.target);
        this.inFlight.delete(deviceId);
      } else {
        positions.set(deviceId, next.current);
        this.inFlight.set(deviceId, next);
      }
    }
    return positions;
  }
}

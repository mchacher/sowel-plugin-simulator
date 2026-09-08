import { describe, expect, it } from "vitest";
import {
  DIMMER_RATE_PER_S,
  SHUTTER_RATE_PCT_PER_S,
  startTransition,
  stepTransition,
  Transitions,
} from "./actuation.js";

describe("a transition travels", () => {
  it("takes a shutter about twenty-five seconds end to end", () => {
    const transitions = new Transitions();
    transitions.start("shutter", 100, 0, SHUTTER_RATE_PCT_PER_S);
    const positions: number[] = [];
    for (let second = 0; second < 30; second++) {
      const stepped = transitions.step(1);
      const position = stepped.get("shutter");
      if (position !== undefined) positions.push(position);
    }
    expect(positions[0]).toBeLessThan(100);
    expect(positions[0]).toBeGreaterThan(90);
    expect(positions.at(-1)).toBe(0);
    expect(positions.length).toBeGreaterThan(20);
    expect(positions.length).toBeLessThan(28);
    // Monotonic: a shutter does not go back up on its way down.
    for (let i = 1; i < positions.length; i++)
      expect(positions[i]).toBeLessThanOrEqual(positions[i - 1]);
  });

  it("stops where it is and stays there", () => {
    const transitions = new Transitions();
    transitions.start("shutter", 100, 0, SHUTTER_RATE_PCT_PER_S);
    transitions.step(5);
    const stoppedAt = transitions.stop("shutter");
    expect(stoppedAt).toBeGreaterThan(70);
    expect(stoppedAt).toBeLessThan(90);
    expect(transitions.has("shutter")).toBe(false);
    expect(transitions.step(10).size).toBe(0);
  });

  it("continues from where it is when re-targeted mid-travel", () => {
    const transitions = new Transitions();
    transitions.start("shutter", 100, 0, SHUTTER_RATE_PCT_PER_S);
    transitions.step(5);
    transitions.start("shutter", 100, 100, SHUTTER_RATE_PCT_PER_S);
    const next = transitions.step(1).get("shutter") as number;
    // Back up from 80, not a jump to 100 and not a restart from 100.
    expect(next).toBeGreaterThan(80);
    expect(next).toBeLessThan(90);
  });

  it("ramps a dimmer in about a second", () => {
    const transitions = new Transitions();
    transitions.start("dimmer", 0, 254, DIMMER_RATE_PER_S);
    expect(transitions.step(0.5).get("dimmer")).toBeCloseTo(127, 0);
    expect(transitions.step(0.6).get("dimmer")).toBe(254);
    expect(transitions.has("dimmer")).toBe(false);
  });

  it("reports its target once and then forgets it", () => {
    const transitions = new Transitions();
    transitions.start("x", 0, 10, 100);
    expect(transitions.step(1).get("x")).toBe(10);
    expect(transitions.step(1).size).toBe(0);
  });

  it("stopping something that is not moving is not an error", () => {
    expect(new Transitions().stop("nothing")).toBeUndefined();
  });

  it("arrives rather than overshooting", () => {
    expect(stepTransition({ current: 99, target: 100, ratePerSecond: 4 }, 1)).toBeNull();
    expect(startTransition(undefined, 40, 0, 4).current).toBe(40);
  });
});

import { describe, expect, it } from "vitest";
import { rngFor, rngFrom, smoothNoise } from "./random.js";

describe("seeded randomness", () => {
  it("replays the same sequence for the same seed and subject", () => {
    const a = Array.from({ length: 8 }, () => rngFor(1789, 20_000, "weather").next());
    const b = Array.from({ length: 8 }, () => rngFor(1789, 20_000, "weather").next());
    expect(a).toEqual(b);
  });

  it("gives independent streams to different subjects on the same day", () => {
    const weather = rngFor(1789, 20_000, "weather");
    const occupant = rngFor(1789, 20_000, "occupant:adulte-1");
    const a = Array.from({ length: 20 }, () => weather.next());
    const b = Array.from({ length: 20 }, () => occupant.next());
    expect(a).not.toEqual(b);
    // Not merely different: uncorrelated enough that neither predicts the other.
    const together = a.filter((value, index) => Math.abs(value - b[index]) < 0.02).length;
    expect(together).toBeLessThan(4);
  });

  it("gives a different day a different stream", () => {
    expect(rngFor(1789, 20_000, "weather").next()).not.toBe(rngFor(1789, 20_001, "weather").next());
  });

  it("stays inside its range", () => {
    const rng = rngFrom(42);
    for (let i = 0; i < 500; i++) {
      const value = rng.range(-3, 7);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(7);
    }
  });

  it("weights a choice", () => {
    const rng = rngFrom(7);
    const items = [
      { value: "common", weight: 95 },
      { value: "rare", weight: 5 },
    ];
    const draws = Array.from({ length: 400 }, () => rng.weighted(items));
    const rare = draws.filter((d) => d === "rare").length;
    expect(rare).toBeGreaterThan(0);
    expect(rare).toBeLessThan(60);
  });

  it("wanders smoothly rather than jumping", () => {
    let previous = smoothNoise(1789, "clouds", 0, 3600);
    for (let t = 60; t < 36_000; t += 60) {
      const value = smoothNoise(1789, "clouds", t, 3600);
      expect(Math.abs(value - previous)).toBeLessThan(0.2);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
});

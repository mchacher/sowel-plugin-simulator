/**
 * Seeded randomness (spec 001, FR2).
 *
 * `Math.random()` is banned here: the same day must replay identically. Seeds are
 * derived per subject rather than shared, so today's weather, today's occupant
 * jitter and today's cloud noise are three independent streams that each replay
 * on their own.
 */

/** FNV-1a over a string, mixed with a numeric seed. */
export function hashSeed(seed: number, subject: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < subject.length; i++) {
    h ^= subject.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Picks one entry, each equally likely. */
  pick<T>(items: readonly T[]): T;
  /** Picks one entry, weighted. Weights need not sum to one. */
  weighted<T>(items: readonly { value: T; weight: number }[]): T;
}

/** mulberry32 — small, fast, and good enough for a house that is not a casino. */
export function rngFrom(state: number): Rng {
  let s = state >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      const total = items.reduce((sum, i) => sum + i.weight, 0);
      let r = next() * total;
      for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item.value;
      }
      return items[items.length - 1].value;
    },
  };
  return rng;
}

/** The stream for one subject on one day. */
export function rngFor(seed: number, day: number, subject: string): Rng {
  return rngFrom(hashSeed(seed, `${day}:${subject}`));
}

/**
 * Smooth pseudo-noise in [-1, 1], continuous in `t`. Used where a value must
 * wander rather than jump — cloud cover, wind, the small drift on a probe.
 */
export function smoothNoise(seed: number, subject: string, t: number, periodS: number): number {
  const x = t / periodS;
  const i = Math.floor(x);
  const frac = x - i;
  const a = rngFrom(hashSeed(seed, `${subject}:${i}`)).next() * 2 - 1;
  const b = rngFrom(hashSeed(seed, `${subject}:${i + 1}`)).next() * 2 - 1;
  // Smoothstep between the two, so the derivative is continuous too.
  const s = frac * frac * (3 - 2 * frac);
  return a + (b - a) * s;
}

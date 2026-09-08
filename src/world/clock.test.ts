import { describe, expect, it, vi } from "vitest";
import { dayNumber, isWeekend, localMidnight, localParts, Ticker } from "./clock.js";

const PARIS = "Europe/Paris";

describe("local time", () => {
  it("reads local parts in the home timezone, not UTC", () => {
    const parts = localParts(Date.parse("2026-06-21T11:45:00Z"), PARIS);
    expect(parts.hour).toBe(13);
    expect(parts.minutes).toBe(13 * 60 + 45);
    expect(parts.dayOfYear).toBe(172);
    expect(parts.weekday).toBe(0);
  });

  it("finds local midnight in summer and in winter", () => {
    expect(new Date(localMidnight(Date.parse("2026-06-21T11:45:00Z"), PARIS)).toISOString()).toBe(
      "2026-06-20T22:00:00.000Z",
    );
    expect(new Date(localMidnight(Date.parse("2026-01-15T11:45:00Z"), PARIS)).toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });

  it("handles the 23-hour spring day and the 25-hour autumn one", () => {
    // Europe/Paris springs forward on 2026-03-29 and falls back on 2026-10-25.
    const spring = localMidnight(Date.parse("2026-03-29T14:00:00Z"), PARIS);
    expect(new Date(spring).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    const nextSpring = localMidnight(Date.parse("2026-03-30T14:00:00Z"), PARIS);
    expect((nextSpring - spring) / 3_600_000).toBe(23);

    const autumn = localMidnight(Date.parse("2026-10-25T14:00:00Z"), PARIS);
    const nextAutumn = localMidnight(Date.parse("2026-10-26T14:00:00Z"), PARIS);
    expect((nextAutumn - autumn) / 3_600_000).toBe(25);
  });

  it("gives one stable number per local day", () => {
    const morning = dayNumber(Date.parse("2026-06-21T05:00:00Z"), PARIS);
    const evening = dayNumber(Date.parse("2026-06-21T20:00:00Z"), PARIS);
    expect(morning).toBe(evening);
    expect(dayNumber(Date.parse("2026-06-22T05:00:00Z"), PARIS)).toBe(morning + 1);
  });

  it("knows a weekend from a weekday", () => {
    expect(isWeekend(Date.parse("2026-06-20T10:00:00Z"), PARIS)).toBe(true);
    expect(isWeekend(Date.parse("2026-06-22T10:00:00Z"), PARIS)).toBe(false);
  });
});

describe("Ticker", () => {
  it("skips a tick rather than queueing it when the previous one overruns", () => {
    vi.useFakeTimers();
    const overruns: number[] = [];
    let inside = 0;
    const ticker = new Ticker({
      intervalMs: 1000,
      now: () => Date.now(),
      onOverrun: (late) => overruns.push(late),
      onTick: () => {
        inside++;
        // Simulate an overrun by advancing time from inside the handler.
        if (inside === 1) vi.advanceTimersByTime(3000);
      },
    });
    ticker.start();
    vi.advanceTimersByTime(1000);
    ticker.stop();

    // The three intervals that elapsed inside the first handler were dropped,
    // not replayed: a backlog of ticks is a house in slow motion.
    expect(inside).toBe(1);
    expect(overruns.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("stops cleanly and stops calling back", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const ticker = new Ticker({ intervalMs: 100, onTick: () => ticks++ });
    ticker.start();
    vi.advanceTimersByTime(350);
    const seen = ticks;
    ticker.stop();
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(seen);
    expect(seen).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

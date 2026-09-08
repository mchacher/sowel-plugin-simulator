/**
 * Local time, local midnight, and the tick (spec 001, FR3 and FR10).
 *
 * Everything the model integrates is anchored on local midnight in the home's
 * timezone, so a restart at 15:00 reconstructs the day rather than starting a
 * new one. DST is handled by asking `Intl` rather than by assuming 86 400 000.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Constructing an `Intl.DateTimeFormat` costs far more than using one, and the
 * warm-up asks for local time a few thousand times in a row. One per timezone.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

/** Offset of `tz` from UTC at that instant, in milliseconds. */
export function timezoneOffsetMs(ts: number, tz: string): number {
  const parts = formatterFor(tz).formatToParts(new Date(ts));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(ts / 1000) * 1000;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** 1-based day of year. */
  dayOfYear: number;
}

const offsetCache = new Map<string, number>();

/** The offset for the hour containing `ts` — it only ever changes on the hour. */
function cachedOffsetMs(ts: number, tz: string): number {
  const key = `${tz}:${Math.floor(ts / 3_600_000)}`;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    offset = timezoneOffsetMs(ts, tz);
    if (offsetCache.size > 4096) offsetCache.clear();
    offsetCache.set(key, offset);
  }
  return offset;
}

export function localParts(ts: number, tz: string): LocalParts {
  const shifted = new Date(ts + cachedOffsetMs(ts, tz));
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const second = shifted.getUTCSeconds();
  const startOfYear = Date.UTC(year, 0, 1);
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: shifted.getUTCDay(),
    minutes: hour * 60 + minute,
    dayOfYear: Math.floor((Date.UTC(year, month - 1, day) - startOfYear) / MS_PER_DAY) + 1,
  };
}

/** The instant at which the local day containing `ts` began. */
export function localMidnight(ts: number, tz: string): number {
  const offset = cachedOffsetMs(ts, tz);
  const startOfLocalDay = Math.floor((ts + offset) / MS_PER_DAY) * MS_PER_DAY;
  const guess = startOfLocalDay - offset;
  // A DST transition between midnight and `ts` moves the offset: re-derive once
  // with the offset that actually applies at midnight.
  const midnightOffset = cachedOffsetMs(guess, tz);
  return midnightOffset === offset ? guess : startOfLocalDay - midnightOffset;
}

/** A stable integer per local day, used to seed the day's randomness. */
export function dayNumber(ts: number, tz: string): number {
  const { year, month, day } = localParts(ts, tz);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function isWeekend(ts: number, tz: string): boolean {
  const wd = localParts(ts, tz).weekday;
  return wd === 0 || wd === 6;
}

export interface TickerOptions {
  intervalMs: number;
  onTick: (now: number) => void;
  /** Called when a tick is skipped because the previous one overran. */
  onOverrun?: (lateByMs: number) => void;
  now?: () => number;
}

/**
 * The plugin's heartbeat. A tick that overruns its interval is **skipped**, never
 * queued: a backlog of ticks is a house in slow motion, which is worse than a
 * house that missed a second.
 */
export class Ticker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly options: TickerOptions) {}

  start(): void {
    if (this.timer) return;
    const now = this.options.now ?? Date.now;
    this.timer = setInterval(() => {
      if (this.running) {
        this.options.onOverrun?.(this.options.intervalMs);
        return;
      }
      this.running = true;
      try {
        this.options.onTick(now());
      } finally {
        this.running = false;
      }
    }, this.options.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

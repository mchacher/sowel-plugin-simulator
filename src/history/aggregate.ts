/**
 * The core's downsampling tasks, restated (spec 004, FR3).
 *
 * From the core's `influx-client.ts`: `sowel-downsample-hourly` and `-daily`
 * (mean, min and max, stamped at the window's end, as `aggregateWindow` does by
 * default) and `sowel-energy-sum-hourly` and `-daily` (sums of the `energy`
 * category, stamped at the window's start, `timeSrc: "_start"`). Windows are UTC,
 * as the tasks set no location. Only whole windows ending by `until` are written:
 * the one it cuts through is the core's own tasks' to finish, from the raw points.
 */

import type { HistoryPoint } from "./writers.js";

const HOUR_S = 3600;
const DAY_S = 86_400;

export interface Buckets {
  raw: HistoryPoint[];
  hourly: HistoryPoint[];
  daily: HistoryPoint[];
  energyHourly: HistoryPoint[];
  energyDaily: HistoryPoint[];
}

function seriesKey(tags: Record<string, string>): string {
  return Object.keys(tags)
    .sort()
    .map((k) => `${k}=${tags[k]}`)
    .join(",");
}

interface Acc {
  tags: Record<string, string>;
  window: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

function windows(
  points: HistoryPoint[],
  size: number,
  pick: (p: HistoryPoint) => boolean,
): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const p of points) {
    if (!pick(p)) continue;
    const window = Math.floor(p.ts / size) * size;
    const key = `${seriesKey(p.tags)}|${window}`;
    const acc = out.get(key);
    if (acc) {
      acc.count += 1;
      acc.sum += p.value;
      acc.min = Math.min(acc.min, p.value);
      acc.max = Math.max(acc.max, p.value);
    } else {
      out.set(key, { tags: p.tags, window, count: 1, sum: p.value, min: p.value, max: p.value });
    }
  }
  return out;
}

export function aggregate(raw: HistoryPoint[], untilS: number, rawSinceS: number): Buckets {
  const values = raw.filter((p) => p.field === "value_number");

  const hourly: HistoryPoint[] = [];
  for (const acc of windows(values, HOUR_S, () => true).values()) {
    const ts = acc.window + HOUR_S;
    if (ts > untilS) continue;
    hourly.push({ ts, tags: acc.tags, field: "mean", value: acc.sum / acc.count });
    hourly.push({ ts, tags: acc.tags, field: "min", value: acc.min });
    hourly.push({ ts, tags: acc.tags, field: "max", value: acc.max });
  }

  const daily: HistoryPoint[] = [];
  for (const field of ["mean", "min", "max"] as const) {
    for (const acc of windows(hourly, DAY_S, (p) => p.field === field).values()) {
      const ts = acc.window + DAY_S;
      if (ts > untilS) continue;
      const value = field === "mean" ? acc.sum / acc.count : field === "min" ? acc.min : acc.max;
      daily.push({ ts, tags: acc.tags, field, value });
    }
  }

  const energyHourly: HistoryPoint[] = [];
  for (const acc of windows(values, HOUR_S, (p) => p.tags.category === "energy").values()) {
    if (acc.window + HOUR_S > untilS) continue;
    energyHourly.push({ ts: acc.window, tags: acc.tags, field: "value_number", value: acc.sum });
  }

  const energyDaily: HistoryPoint[] = [];
  for (const acc of windows(energyHourly, DAY_S, () => true).values()) {
    if (acc.window + DAY_S > untilS) continue;
    energyDaily.push({ ts: acc.window, tags: acc.tags, field: "value_number", value: acc.sum });
  }

  const byTime = (a: HistoryPoint, b: HistoryPoint) => a.ts - b.ts;
  return {
    raw: raw.filter((p) => p.ts >= rawSinceS && p.ts < untilS).sort(byTime),
    hourly: hourly.sort(byTime),
    daily: daily.sort(byTime),
    energyHourly: energyHourly.sort(byTime),
    energyDaily: energyDaily.sort(byTime),
  };
}

function escapeTag(value: string): string {
  return value.replace(/[,= ]/g, (c) => `\\${c}`);
}

/** One point as the core's backup writes it: tags sorted, a float, nanoseconds. */
export function toLineProtocol(point: HistoryPoint, measurement = "equipment_data"): string {
  const tags = Object.keys(point.tags)
    .sort()
    .map((k) => `${escapeTag(k)}=${escapeTag(point.tags[k])}`)
    .join(",");
  return `${measurement},${tags} ${point.field}=${point.value} ${point.ts}000000000`;
}

/** The backup's file name for each bucket (the core's `INFLUX_BUCKETS`). */
export const BUCKET_FILES: Record<keyof Buckets, string> = {
  raw: "influx-raw.lp",
  hourly: "influx-hourly.lp",
  daily: "influx-daily.lp",
  energyHourly: "influx-energy-hourly.lp",
  energyDaily: "influx-energy-daily.lp",
};

/**
 * The house's past, as a Sowel backup's history files (spec 004).
 */

import { HOUSE } from "../house/house.js";
import type { House } from "../house/types.js";
import { localMidnight } from "../world/clock.js";
import { worldConfigFrom } from "../world/config.js";
import { aggregate, BUCKET_FILES, toLineProtocol, type Buckets } from "./aggregate.js";
import { historyBindings, type BackupTables } from "./bindings.js";
import { replay } from "./replay.js";
import { CoreWriters } from "./writers.js";

const DAY_MS = 86_400_000;
/** The core's raw bucket keeps seven days; older raw points would be refused. */
const RAW_RETENTION_MS = 7 * DAY_MS;

export interface GenerateOptions {
  /** Epoch ms, exclusive: the first real point, or now. Nothing at or after it. */
  until: number;
  days: number;
  /** Epoch ms: raw points before this are left out. Defaults to seven days before `now`. */
  rawSince?: number;
  now?: number;
  house?: House;
}

export function generateHistory(tables: BackupTables, options: GenerateOptions): Buckets {
  const bindings = historyBindings(tables);
  const { config } = worldConfigFrom((key) => bindings.settings.get(key));
  const now = options.now ?? Date.now();
  // From a local midnight, so the first day is a whole day, as the live plugin's are.
  const from = localMidnight(options.until - options.days * DAY_MS, config.timezone);
  const writers = new CoreWriters(bindings, config.timezone);
  replay({
    config,
    house: options.house ?? HOUSE,
    from,
    until: options.until,
    onReading: (r) => writers.reading(r.ts, r.deviceId, r.key, r.value),
  });
  const rawSince = options.rawSince ?? now - RAW_RETENTION_MS + 3_600_000;
  return aggregate(
    writers.finish(),
    Math.floor(options.until / 1000),
    Math.floor(Math.max(rawSince, from) / 1000),
  );
}

/** Each bucket's file, as a Sowel backup names it, with its lines. */
export function historyFiles(buckets: Buckets): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [bucket, name] of Object.entries(BUCKET_FILES) as [keyof Buckets, string][]) {
    files[name] = buckets[bucket].map((p) => toLineProtocol(p)).join("\n");
  }
  return files;
}

/**
 * The core's history writers, restated (spec 004, FR3).
 *
 * What the core writes to its raw bucket when a reading arrives live: from
 * `history-writer.ts` (values on change with a dedupe, energy folded per minute
 * and split into tariffs), `self-consumption-writer.ts` (the grid and solar
 * minutes paired into self-consumption, injection and household energy) and
 * `tariff-classifier.ts`. A copy, held honest by the pin test (FR4).
 */

import { localParts } from "../world/clock.js";
import {
  readingKey,
  type HistoryBindings,
  type SeriesMeta,
  type TariffConfig,
} from "./bindings.js";

/** One line of line protocol, before it is written out. */
export interface HistoryPoint {
  /** Epoch seconds. */
  ts: number;
  tags: Record<string, string>;
  field: string;
  value: number;
}

// Restated from the core's history writer.
const MIN_WRITE_INTERVAL_S = 30;
const MAX_WRITE_INTERVAL_S = 300;
const ENERGY_WINDOW_S = 60;
const DEADBAND: Record<string, number> = {
  temperature: 0.2,
  temperature_outdoor: 0.2,
  temperature_device: 0.2,
  humidity: 1.0,
  humidity_outdoor: 1.0,
  luminosity: 0.05,
  power: 5,
  energy: 0.01,
  shutter_position: 2,
  pressure: 0.5,
  voltage: 0.1,
  current: 0.05,
  battery: 1,
};

function tagsOf(
  meta: { equipmentId: string; zoneId: string | null },
  alias: string,
  category: string,
  type: string,
): Record<string, string> {
  const tags: Record<string, string> = {
    alias,
    category,
    equipmentId: meta.equipmentId,
    type,
  };
  if (meta.zoneId) tags.zoneId = meta.zoneId;
  return tags;
}

/** The core's tariff split of `totalWh` over a window, in the home's local time. */
export function classify(
  tariff: TariffConfig | null,
  totalWh: number,
  windowStartS: number,
  windowSeconds: number,
  timezone: string,
): { hp: number; hc: number } {
  if (!tariff) return { hp: totalWh, hc: 0 };
  const local = localParts(windowStartS * 1000, timezone);
  const schedule = tariff.schedules.find((s) => s.days.includes(local.weekday));
  if (!schedule || schedule.slots.length === 0) return { hp: totalWh, hc: 0 };
  const from = local.hour * 60 + local.minute;
  const to = from + windowSeconds / 60;
  let hp = 0;
  let hc = 0;
  for (const slot of schedule.slots) {
    for (const [start, end] of slotRanges(slot.start, slot.end)) {
      const overlap = Math.max(0, Math.min(to, end) - Math.max(from, start));
      if (overlap > 0) {
        if (slot.tariff === "hp") hp += overlap;
        else hc += overlap;
      }
    }
  }
  const total = hp + hc;
  if (total === 0) return { hp: totalWh, hc: 0 };
  return { hp: Math.round((totalWh * hp) / total), hc: Math.round((totalWh * hc) / total) };
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function slotRanges(startTime: string, endTime: string): [number, number][] {
  const start = minutesOf(startTime);
  let end = minutesOf(endTime);
  if (end === 0) end = 1440;
  return end <= start
    ? [
        [start, 1440],
        [0, end],
      ]
    : [[start, end]];
}

interface EnergyBucket {
  meta: SeriesMeta;
  minuteS: number;
  wh: number;
}

interface PairBucket {
  minuteS: number;
  gridWh: number;
  solarWh: number;
  hasGrid: boolean;
}

/** Feed it readings in time order; `finish()` returns the raw bucket's points. */
export class CoreWriters {
  private readonly points: HistoryPoint[] = [];
  private readonly lastWritten = new Map<string, { value: number; ts: number }>();
  private readonly energy = new Map<string, EnergyBucket>();
  private pair: PairBucket | null = null;
  /** The grid meter's household energy is the self-consumption writer's alone. */
  private readonly gridOwnedElsewhere: boolean;

  constructor(
    private readonly bindings: HistoryBindings,
    private readonly timezone: string,
  ) {
    this.gridOwnedElsewhere = bindings.grid !== null && bindings.production !== null;
  }

  /** A reading, as the plugin publishes it. `ts` in epoch milliseconds. */
  reading(tsMs: number, deviceId: string, key: string, value: unknown): void {
    const series = this.bindings.byReading.get(readingKey(deviceId, key));
    if (!series || typeof value !== "number" || !Number.isFinite(value)) return;
    const ts = Math.floor(tsMs / 1000);

    for (const meta of series) {
      if (meta.alias === "energy") this.pairEnergy(meta, value, ts);
      if (!meta.historized) continue;
      if (
        this.gridOwnedElsewhere &&
        meta.equipmentId === this.bindings.grid?.equipmentId &&
        (meta.alias === "energy" || meta.alias === "energy_hp" || meta.alias === "energy_hc")
      ) {
        continue;
      }
      if (meta.category === "energy" && meta.alias === "energy") {
        this.foldEnergy(meta, value, ts);
        continue;
      }
      if (this.shouldWrite(meta, value, ts)) {
        this.points.push({
          ts,
          tags: tagsOf(meta, meta.alias, meta.category, meta.type),
          field: "value_number",
          value,
        });
      }
    }
  }

  /** Flush what is still open and return every raw point, in time order. */
  finish(): HistoryPoint[] {
    for (const bucket of this.energy.values()) this.flushEnergy(bucket);
    this.energy.clear();
    if (this.pair) this.flushPair(this.pair);
    this.pair = null;
    return this.points.sort((a, b) => a.ts - b.ts);
  }

  private shouldWrite(meta: SeriesMeta, value: number, ts: number): boolean {
    const id = `${meta.equipmentId}\u0000${meta.alias}`;
    const last = this.lastWritten.get(id);
    const write = (): boolean => {
      this.lastWritten.set(id, { value, ts });
      return true;
    };
    if (!last) return write();
    const elapsed = ts - last.ts;
    if (elapsed < MIN_WRITE_INTERVAL_S) return false;
    if (elapsed > MAX_WRITE_INTERVAL_S) return write();
    const deadband = DEADBAND[meta.category];
    if (deadband !== undefined) {
      const delta = Math.abs(value - last.value);
      const threshold =
        meta.category === "luminosity" ? Math.max(Math.abs(last.value) * deadband, 1) : deadband;
      if (delta < threshold) return false;
    }
    return value !== last.value ? write() : false;
  }

  private foldEnergy(meta: SeriesMeta, wh: number, ts: number): void {
    const id = `${meta.equipmentId}\u0000${meta.alias}`;
    const minuteS = Math.floor(ts / 60) * 60;
    const bucket = this.energy.get(id);
    if (!bucket) {
      this.energy.set(id, { meta, minuteS, wh });
      return;
    }
    if (minuteS <= bucket.minuteS) {
      bucket.wh += wh;
      return;
    }
    this.flushEnergy(bucket);
    this.energy.set(id, { meta, minuteS, wh });
  }

  private flushEnergy({ meta, minuteS, wh }: EnergyBucket): void {
    this.points.push({
      ts: minuteS,
      tags: tagsOf(meta, meta.alias, meta.category, meta.type),
      field: "value_number",
      value: wh,
    });
    const split = classify(this.bindings.tariff, wh, minuteS, ENERGY_WINDOW_S, this.timezone);
    for (const [alias, value] of [
      ["energy_hp", split.hp],
      ["energy_hc", split.hc],
    ] as const) {
      this.points.push({
        ts: minuteS,
        tags: tagsOf(meta, alias, meta.category, meta.type),
        field: "value_number",
        value,
      });
    }
  }

  /** The self-consumption writer: the grid's and the solar meter's minutes, paired. */
  private pairEnergy(meta: SeriesMeta, wh: number, ts: number): void {
    const role =
      meta.equipmentType === "main_energy_meter"
        ? "grid"
        : meta.equipmentType === "energy_production_meter"
          ? "solar"
          : null;
    if (!role || !this.bindings.production) return;
    const minuteS = Math.floor(ts / 60) * 60;
    if (this.pair && minuteS > this.pair.minuteS) {
      this.flushPair(this.pair);
      this.pair = null;
    }
    this.pair ??= { minuteS, gridWh: 0, solarWh: 0, hasGrid: false };
    if (role === "grid") {
      this.pair.gridWh += wh;
      this.pair.hasGrid = true;
    } else {
      this.pair.solarWh += wh;
    }
  }

  private flushPair(bucket: PairBucket): void {
    const production = this.bindings.production;
    if (!bucket.hasGrid || !production) return;
    const injection = Math.max(0, -bucket.gridWh);
    const autoconso = Math.max(0, bucket.solarWh - injection);
    const household = Math.max(0, bucket.gridWh) + autoconso;
    const energyPoint = (
      where: { equipmentId: string; zoneId: string | null },
      alias: string,
      value: number,
    ): HistoryPoint => ({
      ts: bucket.minuteS,
      tags: tagsOf(where, alias, "energy", "number"),
      field: "value_number",
      value,
    });
    this.points.push(energyPoint(production, "autoconso", autoconso));
    this.points.push(energyPoint(production, "injection", injection));
    const grid = this.bindings.grid;
    if (grid) {
      const split = classify(
        this.bindings.tariff,
        household,
        bucket.minuteS,
        ENERGY_WINDOW_S,
        this.timezone,
      );
      this.points.push(energyPoint(grid, "energy", household));
      this.points.push(energyPoint(grid, "energy_hp", split.hp));
      this.points.push(energyPoint(grid, "energy_hc", split.hc));
    }
  }
}

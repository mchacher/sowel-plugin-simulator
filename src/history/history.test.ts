import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { aggregate, toLineProtocol } from "./aggregate.js";
import { historyBindings, readingKey, resolveHistorize, type BackupTables } from "./bindings.js";
import { generateHistory, historyFiles } from "./generate.js";
import { classify, CoreWriters, type HistoryPoint } from "./writers.js";

const TABLES = (
  JSON.parse(
    execFileSync("unzip", ["-p", "docs/fixtures/demo-fr.zip", "sowel-backup.json"], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString("utf8"),
  ) as { tables: BackupTables }
).tables;

const TZ = "Europe/Paris";
const BINDINGS = historyBindings(TABLES);

/** The source device id of the first equipment of a type, and its energy key. */
function readingOf(equipmentType: string, alias: string): string {
  for (const [key, series] of BINDINGS.byReading) {
    if (series.some((s) => s.equipmentType === equipmentType && s.alias === alias)) {
      return key.split("\u0000")[0];
    }
  }
  throw new Error(`no ${equipmentType} ${alias}`);
}

describe("which series the core historizes", () => {
  it("follows the core's defaults", () => {
    expect(resolveHistorize(null, "temperature", "temperature")).toBe(true);
    expect(resolveHistorize(null, "energy_forward", "energy")).toBe(false);
    expect(resolveHistorize(null, "setpoint", "whatever")).toBe(true);
    expect(resolveHistorize(null, "occupancy", "motion")).toBe(false);
    expect(resolveHistorize(0, "temperature", "temperature")).toBe(false);
    expect(resolveHistorize(1, "occupancy", "motion")).toBe(true);
  });

  it("finds the fixture's grid meter, production meter and tariff", () => {
    expect(BINDINGS.grid).not.toBeNull();
    expect(BINDINGS.production).not.toBeNull();
    expect(BINDINGS.tariff?.schedules.length).toBeGreaterThan(0);
  });
});

describe("the core's writers, restated", () => {
  it("splits a window between tariffs by the minutes in each", () => {
    const tariff = {
      schedules: [
        {
          days: [0, 1, 2, 3, 4, 5, 6],
          slots: [
            { start: "00:00", end: "06:00", tariff: "hc" as const },
            { start: "06:00", end: "00:00", tariff: "hp" as const },
          ],
        },
      ],
    };
    // 05:30 local, a 60-minute window: half in each.
    const start = Date.parse("2026-09-20T03:30:00Z") / 1000;
    expect(classify(tariff, 100, start, 3600, TZ)).toEqual({ hp: 50, hc: 50 });
    expect(classify(null, 100, start, 60, TZ)).toEqual({ hp: 100, hc: 0 });
  });

  it("folds energy per minute and splits it, as the history writer does", () => {
    const writers = new CoreWriters(BINDINGS, TZ);
    const inverter = readingOf("energy_production_meter", "energy");
    const t0 = Date.parse("2026-09-20T10:00:10Z");
    writers.reading(t0, inverter, "energy", 10);
    writers.reading(t0 + 20_000, inverter, "energy", 5);
    writers.reading(t0 + 60_000, inverter, "energy", 7);
    const points = writers
      .finish()
      .filter((p) => p.tags.equipmentId === BINDINGS.production?.equipmentId);
    const energy = points.filter((p) => p.tags.alias === "energy");
    expect(energy.map((p) => p.value)).toEqual([15, 7]);
    expect(energy[0].ts % 60).toBe(0);
    expect(points.some((p) => p.tags.alias === "energy_hp")).toBe(true);
  });

  it("pairs the grid and the solar minutes into self-consumption and injection", () => {
    const writers = new CoreWriters(BINDINGS, TZ);
    const grid = readingOf("main_energy_meter", "energy");
    const inverter = readingOf("energy_production_meter", "energy");
    const t0 = Date.parse("2026-09-20T10:00:00Z");
    writers.reading(t0, inverter, "energy", 50);
    writers.reading(t0, grid, "energy", -20);
    const points = writers.finish();
    const value = (alias: string, equipmentId?: string) =>
      points.find((p) => p.tags.alias === alias && p.tags.equipmentId === equipmentId)?.value;
    expect(value("injection", BINDINGS.production?.equipmentId)).toBe(20);
    expect(value("autoconso", BINDINGS.production?.equipmentId)).toBe(30);
    // The household's energy is the self-consumption writer's alone: 0 drawn + 30.
    const household = points.filter(
      (p) => p.tags.alias === "energy" && p.tags.equipmentId === BINDINGS.grid?.equipmentId,
    );
    expect(household.map((p) => p.value)).toEqual([30]);
  });

  it("writes a reading that has not moved only after the maximum interval", () => {
    const writers = new CoreWriters(BINDINGS, TZ);
    const probe = [...BINDINGS.byReading.entries()].find(([, s]) =>
      s.some((m) => m.category === "temperature" && m.historized),
    );
    const [deviceId, key] = (probe?.[0] ?? "").split("\u0000");
    const t0 = Date.parse("2026-09-20T10:00:00Z");
    for (let i = 0; i <= 10; i++) writers.reading(t0 + i * 60_000, deviceId, key, 20);
    const written = writers.finish().filter((p) => p.tags.alias === "temperature");
    // First, then once past five minutes of silence.
    expect(written.length).toBe(2);
  });

  it("integrates a power-only sub-meter's power into energy, a minute at a time", () => {
    // The core's power-submeter integrator: the heat pump's meter binds power only.
    const [meter] = [...BINDINGS.powerOnlySubmeters.keys()];
    expect(meter).toBeDefined();
    const [key] = [...BINDINGS.byReading.entries()].find(([, s]) =>
      s.some((m) => m.equipmentId === meter && m.alias === "power"),
    ) ?? [""];
    const [deviceId, reading] = key.split("\u0000");
    const writers = new CoreWriters(BINDINGS, TZ);
    const t0 = Date.parse("2026-09-20T10:00:00Z");
    writers.reading(t0, deviceId, reading, 180);
    for (let i = 1; i <= 10; i++) writers.tick(t0 + i * 60_000);
    const energy = writers
      .finish()
      .filter((p) => p.tags.equipmentId === meter && p.tags.alias === "energy");
    expect(energy).toHaveLength(10);
    expect(energy.reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(30);
  });

  it("ignores a reading nothing is bound to", () => {
    const writers = new CoreWriters(BINDINGS, TZ);
    writers.reading(Date.now(), "no-such-device", "energy", 1);
    expect(writers.finish()).toEqual([]);
    expect(BINDINGS.byReading.has(readingKey("no-such-device", "energy"))).toBe(false);
  });
});

describe("the core's downsampling, restated", () => {
  const tags = { alias: "power", category: "power", equipmentId: "e", type: "number" };
  const energyTags = { alias: "energy", category: "energy", equipmentId: "e", type: "number" };
  const base = Date.parse("2026-09-20T10:00:00Z") / 1000;
  const raw: HistoryPoint[] = [
    { ts: base, tags, field: "value_number", value: 100 },
    { ts: base + 1800, tags, field: "value_number", value: 300 },
    { ts: base, tags: energyTags, field: "value_number", value: 10 },
    { ts: base + 60, tags: energyTags, field: "value_number", value: 5 },
    // In the next hour, which `until` cuts through: left to the core's own tasks.
    { ts: base + 3700, tags, field: "value_number", value: 999 },
  ];
  const buckets = aggregate(raw, base + 3800, base);

  it("gives each hour a mean, a min and a max, stamped at its end", () => {
    const hour = buckets.hourly.filter((p) => p.tags.alias === "power");
    expect(hour.map((p) => [p.field, p.value, p.ts])).toEqual([
      ["mean", 200, base + 3600],
      ["min", 100, base + 3600],
      ["max", 300, base + 3600],
    ]);
  });

  it("sums energy per hour, stamped at its start", () => {
    expect(buckets.energyHourly).toEqual([
      { ts: base, tags: energyTags, field: "value_number", value: 15 },
    ]);
  });

  it("writes no window `until` cuts through, and no daily window not yet over", () => {
    expect(buckets.hourly.some((p) => p.value === 999)).toBe(false);
    expect(buckets.daily).toEqual([]);
    expect(buckets.energyDaily).toEqual([]);
  });

  it("writes lines as the core's backup does", () => {
    expect(toLineProtocol(buckets.energyHourly[0])).toBe(
      `equipment_data,alias=energy,category=energy,equipmentId=e,type=number value_number=15 ${base}000000000`,
    );
  });
});

describe("the house's past", () => {
  const until = Date.parse("2026-09-20T12:00:00Z");
  const buckets = generateHistory(TABLES, {
    until,
    days: 2,
    now: until,
  });

  it("writes nothing at or after `until`", () => {
    for (const bucket of Object.values(buckets)) {
      for (const p of bucket as HistoryPoint[]) expect(p.ts * 1000).toBeLessThanOrEqual(until);
    }
    for (const p of buckets.raw) expect(p.ts * 1000).toBeLessThan(until);
  });

  it("fills every bucket, production included", () => {
    expect(buckets.raw.length).toBeGreaterThan(1000);
    expect(buckets.hourly.length).toBeGreaterThan(100);
    expect(buckets.daily.length).toBeGreaterThan(10);
    const production = buckets.energyHourly.filter(
      (p) => p.tags.equipmentId === BINDINGS.production?.equipmentId && p.tags.alias === "energy",
    );
    expect(production.reduce((sum, p) => sum + p.value, 0)).toBeGreaterThan(1000);
  });

  it("keeps raw points to the core's seven days", () => {
    const later = generateHistory(TABLES, { until, days: 2, now: until + 8 * 86_400_000 });
    expect(later.raw).toEqual([]);
    expect(later.energyHourly.length).toBeGreaterThan(0);
  });

  it("names its files as a Sowel backup does", () => {
    expect(Object.keys(historyFiles(buckets)).sort()).toEqual([
      "influx-daily.lp",
      "influx-energy-daily.lp",
      "influx-energy-hourly.lp",
      "influx-hourly.lp",
      "influx-raw.lp",
    ]);
  });
});

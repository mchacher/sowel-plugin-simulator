/**
 * The fixture's bindings, as the core's history writer sees them (spec 004, FR3).
 *
 * A reading the plugin publishes is a device's key; what the core writes to
 * InfluxDB is an equipment's alias. This module resolves one into the other from
 * a Sowel backup's tables, and decides which series the core historizes — its
 * defaults restated from `src/shared/history-defaults.ts` in the core, held honest
 * by the pin test (FR4).
 */

/** The rows of a Sowel backup this module reads. Other columns are ignored. */
export interface BackupTables {
  settings: { key: string; value: string | null }[];
  devices: { id: string; integration_id: string | null; source_device_id: string | null }[];
  device_data: { id: string; device_id: string; key: string; type: string; category: string }[];
  data_bindings: {
    equipment_id: string;
    device_data_id: string;
    alias: string;
    historize: number | null;
  }[];
  equipments: { id: string; zone_id: string | null; type: string; enabled: number | boolean }[];
}

/** One series the core writes: the tags of every point it holds. */
export interface SeriesMeta {
  equipmentId: string;
  alias: string;
  category: string;
  type: string;
  zoneId: string | null;
  equipmentType: string;
  historized: boolean;
}

export interface TariffSlot {
  start: string;
  end: string;
  tariff: "hp" | "hc";
}

export interface TariffConfig {
  schedules: { days: number[]; slots: TariffSlot[] }[];
}

export interface HistoryBindings {
  /** `deviceId \u0000 key` → every series bound to that reading. */
  byReading: Map<string, SeriesMeta[]>;
  /** The grid meter and the production meter, when both exist (the core's self-consumption). */
  grid: { equipmentId: string; zoneId: string | null } | null;
  production: { equipmentId: string; zoneId: string | null } | null;
  tariff: TariffConfig | null;
  settings: Map<string, string>;
  /**
   * Sub-meters with a power reading and no energy one: the core integrates their
   * power into energy itself (`power-submeter-integrator.ts`), equipment id → zone.
   */
  powerOnlySubmeters: Map<string, string | null>;
}

// Restated from the core's `src/equipments/metering.ts`.
const NON_SUBMETER_TYPES = new Set(["main_energy_meter", "energy_production_meter", "solar_panel"]);

// Restated from the core's `src/shared/history-defaults.ts`.
const CATEGORY_DEFAULTS_ON = new Set([
  "temperature",
  "temperature_outdoor",
  "temperature_device",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "luminosity",
  "power",
  "energy",
  "rain",
  "wind",
  "co2",
  "voc",
  "noise",
  "voltage",
  "current",
  "shutter_position",
  "battery",
]);
const ALIAS_DEFAULTS_ON = new Set(["setpoint", "power"]);
const ALIAS_DEFAULTS_OFF = new Set([
  "demand_30min",
  "energy_forward",
  "energy_reverse",
  "sum_rain_1",
  "sum_rain_24",
  "wind_angle",
  "gust_strength",
  "gust_angle",
]);

export function resolveHistorize(
  historize: number | null | undefined,
  alias: string,
  category: string,
): boolean {
  if (historize === 1) return true;
  if (historize === 0) return false;
  if (ALIAS_DEFAULTS_OFF.has(alias)) return false;
  if (/^j\d+_/.test(alias)) return false;
  if (ALIAS_DEFAULTS_ON.has(alias)) return true;
  return CATEGORY_DEFAULTS_ON.has(category);
}

export function readingKey(deviceId: string, key: string): string {
  return `${deviceId}\u0000${key}`;
}

export function historyBindings(
  tables: BackupTables,
  integrationId = "simulator",
): HistoryBindings {
  const settings = new Map<string, string>();
  for (const row of tables.settings) if (row.value !== null) settings.set(row.key, row.value);

  const sourceOf = new Map<string, string>();
  for (const device of tables.devices) {
    if (device.integration_id === integrationId && device.source_device_id) {
      sourceOf.set(device.id, device.source_device_id);
    }
  }
  const dataById = new Map(tables.device_data.map((d) => [d.id, d]));
  const equipments = new Map(
    tables.equipments.filter((e) => Boolean(e.enabled)).map((e) => [e.id, e]),
  );

  const byReading = new Map<string, SeriesMeta[]>();
  for (const binding of tables.data_bindings) {
    const data = dataById.get(binding.device_data_id);
    const equipment = equipments.get(binding.equipment_id);
    if (!data || !equipment) continue;
    const source = sourceOf.get(data.device_id);
    if (!source) continue;
    const key = readingKey(source, data.key);
    const list = byReading.get(key) ?? [];
    list.push({
      equipmentId: equipment.id,
      alias: binding.alias,
      category: data.category,
      type: data.type,
      zoneId: equipment.zone_id,
      equipmentType: equipment.type,
      historized: resolveHistorize(binding.historize, binding.alias, data.category),
    });
    byReading.set(key, list);
  }

  const find = (type: string) => {
    const e = [...equipments.values()].find((eq) => eq.type === type);
    return e ? { equipmentId: e.id, zoneId: e.zone_id } : null;
  };

  const perEquipment = new Map<string, { alias: string; category: string; type: string }[]>();
  for (const binding of tables.data_bindings) {
    const data = dataById.get(binding.device_data_id);
    if (!data || !equipments.has(binding.equipment_id)) continue;
    const list = perEquipment.get(binding.equipment_id) ?? [];
    list.push({ alias: binding.alias, category: data.category, type: data.type });
    perEquipment.set(binding.equipment_id, list);
  }
  const powerOnlySubmeters = new Map<string, string | null>();
  for (const [id, bindings] of perEquipment) {
    const equipment = equipments.get(id);
    if (!equipment || NON_SUBMETER_TYPES.has(equipment.type)) continue;
    const isPower = (b: { alias: string; category: string }) =>
      b.alias === "power" || b.category === "power";
    const isEnergy = (b: { alias: string; category: string }) =>
      b.alias === "energy" || b.category === "energy";
    const metering = bindings.some((b) => (isPower(b) || isEnergy(b)) && b.type === "number");
    if (equipment.type !== "energy_meter" && !metering) continue;
    if (bindings.some(isPower) && !bindings.some(isEnergy)) {
      powerOnlySubmeters.set(id, equipment.zone_id);
    }
  }

  let tariff: TariffConfig | null = null;
  const rawTariff = settings.get("energy.tariff");
  if (rawTariff) {
    try {
      tariff = JSON.parse(rawTariff) as TariffConfig;
    } catch {
      tariff = null;
    }
  }

  return {
    byReading,
    grid: find("main_energy_meter"),
    production: find("energy_production_meter"),
    tariff,
    settings,
    powerOnlySubmeters,
  };
}

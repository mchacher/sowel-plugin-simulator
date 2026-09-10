/**
 * Rewriting a fixture onto the simulator (spec 003, FR2 and FR4).
 *
 * The interesting discovery, made by reading the fixture rather than assuming:
 * **its bindings already carry the right aliases.** The thermostat's bindings are
 * `setpoint`, `temperature`, `outsideTemperature`, `operationMode`; only the
 * *keys* behind them are vendor vocabulary — `targetTemperature`,
 * `insideTemperature`, `nanoe`.
 *
 * So the rewrite matches on **category**, not on key name. A binding whose
 * category the simulator's device also declares survives, re-pointed at the
 * simulator's key for that category. One whose category has no counterpart is
 * dropped and named. That is both more robust than a key map and exactly the
 * behaviour FR4 asks for: `nanoe` and `ignitionCount` have no category worth
 * keeping, so they go.
 */

import { randomUUID } from "node:crypto";
import { declare } from "../../src/publish/catalogue.js";
import type { DeviceSpec } from "../../src/house/types.js";
import type { Row } from "./derive.js";

export interface RewriteTarget {
  /** The fixture equipment this device now backs. Undefined for added devices. */
  equipmentId?: string;
  device: DeviceSpec;
}

export interface Dropped {
  equipmentId: string;
  alias: string;
  key: string;
  category: string | undefined;
  kind: "data" | "order";
}

export interface RewriteResult {
  devices: Row[];
  deviceData: Row[];
  deviceOrders: Row[];
  dataBindings: Row[];
  orderBindings: Row[];
  dropped: Dropped[];
}

/**
 * Spec 176 — the boolean run state of a thermostat binds under the `state` alias.
 * The fixture binds it as `power`, under the wattage category, which is the very
 * collision spec 176 exists to stop. Migrate the alias and the category together.
 */
const ALIAS_MIGRATIONS: Record<string, string> = { power: "state" };

/**
 * Categories the fixture uses that the catalogue spells differently. Two cases,
 * both of them the plugin's own correction rather than a rename:
 *
 * - `power` on a boolean reading is a thermostat's run state, and it belongs under
 *   `light_state` (spec 176, core issue #901).
 * - `generic` is where the real integrations still put the operating mode, because
 *   core issue #922 has not landed. The simulator declares the proper
 *   `operation_mode`, so the binding survives by its alias instead.
 */
const DATA_CATEGORY_MIGRATIONS: Record<string, string> = { power: "light_state" };

const DETERMINISTIC_NAMESPACE = "sowel-demo-fixture";

/** A stable id, so two runs over the same fixture produce the same document. */
function stableId(seed: string): string {
  // A UUID shape, derived from the seed rather than drawn: the core only needs it
  // to be unique and stable, and a random one would make every rebuild a diff.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const input = `${DETERMINISTIC_NAMESPACE}:${seed}`;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + input.charCodeAt(i), 2246822519) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 2654435761) >>> 0);
  const d = hex(Math.imul(h1 + h2, 40503) >>> 0);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5)}-${c.slice(0, 4)}-${c.slice(4)}${d}`;
}

export interface TableColumns {
  devices: readonly string[];
  deviceData: readonly string[];
  deviceOrders: readonly string[];
  dataBindings: readonly string[];
  orderBindings: readonly string[];
  equipments: readonly string[];
}

/**
 * Columns that are `NOT NULL` in the schema and that this plugin does not model.
 *
 * `dispatch_config` is a legacy column — migration 004 stopped using it and left
 * it in place with a `'{}'` default — and a restore will not take a null for it.
 * Reading the constraint off the fixture's own rows rather than off the migration
 * is deliberate: the fixture is what the restore will accept.
 */
const NOT_NULL_DEFAULTS: Record<string, unknown> = { dispatch_config: "{}" };

/** Keep only the columns the table actually has, and fill the ones it does. */
export function shape(columns: readonly string[], row: Row): Row {
  const out: Row = {};
  for (const column of columns) {
    out[column] = row[column] ?? NOT_NULL_DEFAULTS[column] ?? null;
  }
  return out;
}

/** The columns a table carries, read from its own rows. */
export function columnsOf(rows: Row[], fallback: readonly string[]): readonly string[] {
  return rows.length > 0 ? Object.keys(rows[0]) : fallback;
}

export interface RewriteInput {
  targets: RewriteTarget[];
  roomIds: readonly string[];
  columns: TableColumns;
  /** The fixture's own rows, read-only. */
  fixture: {
    devices: Row[];
    deviceData: Row[];
    deviceOrders: Row[];
    dataBindings: Row[];
    orderBindings: Row[];
  };
  integrationId: string;
}

export function rewrite(input: RewriteInput): RewriteResult {
  const { targets, roomIds, fixture, integrationId } = input;

  const devices: Row[] = [];
  const deviceData: Row[] = [];
  const deviceOrders: Row[] = [];
  const dropped: Dropped[] = [];

  /** equipmentId → (category → the rows that now carry it). */
  const dataByEquipmentCategory = new Map<string, Map<string, IndexRow[]>>();
  const ordersByEquipmentCategory = new Map<string, Map<string, IndexRow[]>>();
  /** equipmentId → (key → rows), the fallback when a category does not match. */
  const dataByEquipmentKey = new Map<string, Map<string, IndexRow[]>>();
  const ordersByEquipmentKey = new Map<string, Map<string, IndexRow[]>>();
  /** Every rewritten row, by device and key, for the added bindings. */
  const rowByDeviceKey = new Map<string, Row>();

  for (const target of targets) {
    const declaration = declare(target.device, roomIds);
    const deviceId = stableId(`device:${target.device.id}`);

    // Column sets are taken from the fixture's own rows, never invented: the
    // restore refuses a column the schema does not have, and the schema is the
    // core's to change. `shape` drops anything the fixture does not carry and
    // fills anything it does.
    devices.push(
      shape(input.columns.devices, {
        id: deviceId,
        mqtt_base_topic: null,
        mqtt_name: target.device.id,
        name: target.device.id,
        manufacturer: "Sowel",
        model: target.device.archetype,
        ieee_address: null,
        zone_id: null,
        source: integrationId,
        status: "unknown",
        integration_id: integrationId,
        last_seen: null,
        raw_expose: null,
        power_source: declaration.powerSource ?? "unknown",
        source_device_id: target.device.id,
        created_at: null,
        updated_at: null,
      }),
    );

    const dataCategories = new Map<string, IndexRow[]>();
    for (const entry of declaration.data) {
      const row: Row = shape(input.columns.deviceData, {
        id: stableId(`data:${target.device.id}:${entry.key}`),
        device_id: deviceId,
        key: entry.key,
        value: null,
        type: entry.type,
        unit: entry.unit ?? null,
        category: entry.category,
        enum_values: entry.enumValues ? JSON.stringify(entry.enumValues) : null,
        last_changed: null,
        last_updated: null,
      });
      deviceData.push(row);
      rowByDeviceKey.set(`${target.device.id}:${entry.key}`, row);
      const list = dataCategories.get(entry.category) ?? [];
      list.push({ id: row.id as string, key: entry.key, deviceId: target.device.id });
      dataCategories.set(entry.category, list);
    }

    const orderCategories = new Map<string, IndexRow[]>();
    for (const order of declaration.orders) {
      const row: Row = shape(input.columns.deviceOrders, {
        id: stableId(`order:${target.device.id}:${order.key}`),
        device_id: deviceId,
        key: order.key,
        type: order.type,
        category: order.category ?? null,
        min_value: order.min ?? null,
        max_value: order.max ?? null,
        unit: order.unit ?? null,
        enum_values: order.enumValues ? JSON.stringify(order.enumValues) : null,
        mqtt_set_topic: null,
        payload_key: null,
        dispatch_config: null,
      });
      deviceOrders.push(row);
      rowByDeviceKey.set(`order:${target.device.id}:${order.key}`, row);
      // Uncategorised simulation orders are keyed by their own key instead, so
      // they can still be bound on purpose.
      const key = order.category ?? order.key;
      const list = orderCategories.get(key) ?? [];
      list.push({ id: row.id as string, key: order.key, deviceId: target.device.id });
      orderCategories.set(key, list);
    }

    if (target.equipmentId) {
      mergeInto(dataByEquipmentCategory, target.equipmentId, dataCategories);
      mergeInto(ordersByEquipmentCategory, target.equipmentId, orderCategories);
      mergeInto(
        dataByEquipmentKey,
        target.equipmentId,
        byKey(declaration.data, target.device.id, "data"),
      );
      mergeInto(
        ordersByEquipmentKey,
        target.equipmentId,
        byKey(declaration.orders, target.device.id, "order"),
      );
    }
  }

  const oldData = new Map(fixture.deviceData.map((row) => [row.id as string, row]));
  const oldOrders = new Map(fixture.deviceOrders.map((row) => [row.id as string, row]));

  const dataBindings = repoint(
    fixture.dataBindings,
    "device_data_id",
    oldData,
    dataByEquipmentCategory,
    dataByEquipmentKey,
    DATA_CATEGORY_MIGRATIONS,
    "data",
    dropped,
  );
  const orderBindings = repoint(
    fixture.orderBindings,
    "device_order_id",
    oldOrders,
    ordersByEquipmentCategory,
    ordersByEquipmentKey,
    {},
    "order",
    dropped,
  );

  return { devices, deviceData, deviceOrders, dataBindings, orderBindings, dropped };
}

function mergeInto(
  into: Map<string, Map<string, IndexRow[]>>,
  equipmentId: string,
  categories: Map<string, IndexRow[]>,
): void {
  const existing = into.get(equipmentId) ?? new Map<string, IndexRow[]>();
  for (const [category, rows] of categories) {
    existing.set(category, [...(existing.get(category) ?? []), ...rows]);
  }
  into.set(equipmentId, existing);
}

/**
 * Re-point one side's bindings.
 *
 * Two passes, because a binding that matches exactly must not lose its row to one
 * that only matches by category. The inverter is the case that taught this: its
 * `energy`, `energy_forward` and `energy_reverse` bindings all carry category
 * `energy`, and handing them out in arrival order gave `energy_reverse` — which an
 * inverter does not have — the row that `energy` needed.
 *
 * **Pass one** takes every binding whose alias or key the catalogue declares under
 * the same category. Exact, unambiguous, order-independent.
 *
 * **Pass two** places what is left, most specific first:
 *
 * 1. the **migrated category** — a thermostat's boolean `power` is its run state
 *    and belongs under `light_state` (spec 176, core issue #901);
 * 2. the **category** — how `ext_temperature` finds the outdoor module while
 *    `temperature` keeps the indoor one: the categories differ, the keys do not;
 * 3. the **alias as a key** — recovers what the real integrations still file under
 *    `generic`. `operationMode` is why this step exists: the simulator declares the
 *    proper `operation_mode`, core issue #922 has not landed, and the binding
 *    should not be lost over it.
 *
 * Where several rows remain equally valid, one whose device id shares a word with
 * the alias wins — which is how `wind_battery` finds the wind gauge's battery
 * rather than the rain gauge's. A heuristic, and labelled as one; the alternative
 * is a coin toss.
 *
 * Anything that matches nothing is dropped and named.
 */
function repoint(
  bindings: Row[],
  field: "device_data_id" | "device_order_id",
  oldRows: Map<string, Row>,
  byEquipmentCategory: Map<string, Map<string, IndexRow[]>>,
  byEquipmentKey: Map<string, Map<string, IndexRow[]>>,
  categoryMigrations: Record<string, string>,
  kind: "data" | "order",
  dropped: Dropped[],
): Row[] {
  const claimed = new Set<string>();
  const resolved = new Map<Row, { row: IndexRow; migrated: boolean }>();

  const context = (binding: Row) => {
    const old = oldRows.get(binding[field] as string);
    return {
      equipmentId: binding.equipment_id as string,
      alias: binding.alias as string,
      key: old?.key as string | undefined,
      category: (old?.category as string | undefined) ?? undefined,
    };
  };

  const take = (candidates: IndexRow[], alias: string): IndexRow | undefined => {
    const free = candidates.filter((row) => !claimed.has(row.id));
    if (free.length === 0) return undefined;
    if (free.length === 1) return free[0];
    const words = alias.split(/[^a-z0-9]+/i).filter((word) => word.length > 2);
    return (
      free.find((row) => words.some((word) => row.deviceId.includes(word.toLowerCase()))) ?? free[0]
    );
  };

  // Pass one: alias or key, under the same category.
  for (const binding of bindings) {
    const { equipmentId, alias, key, category } = context(binding);
    if (!category) continue;
    const candidates = (byEquipmentCategory.get(equipmentId)?.get(category) ?? []).filter(
      (row) => row.key === alias || row.key === key,
    );
    const row = take(candidates, alias);
    if (!row) continue;
    claimed.add(row.id);
    resolved.set(binding, { row, migrated: false });
  }

  // Pass two: the rest.
  for (const binding of bindings) {
    if (resolved.has(binding)) continue;
    const { equipmentId, alias, key, category } = context(binding);
    const fromCategory = (lookup: string | undefined): IndexRow[] =>
      lookup ? (byEquipmentCategory.get(equipmentId)?.get(lookup) ?? []) : [];
    const fromKey = (lookup: string | undefined): IndexRow[] =>
      lookup ? (byEquipmentKey.get(equipmentId)?.get(lookup) ?? []) : [];

    const migratedCategory = category ? categoryMigrations[category] : undefined;
    const attempts: [IndexRow[], boolean][] = [
      [fromCategory(migratedCategory), true],
      [category && category !== "generic" ? fromCategory(category) : [], false],
      [fromKey(alias), false],
      [fromKey(key), false],
    ];

    let found: { row: IndexRow; migrated: boolean } | undefined;
    for (const [candidates, migrated] of attempts) {
      const row = take(candidates, alias);
      if (row) {
        found = { row, migrated };
        break;
      }
    }

    if (!found) {
      dropped.push({ equipmentId, alias, key: key ?? "?", category, kind });
      continue;
    }
    claimed.add(found.row.id);
    resolved.set(binding, found);
  }

  const out: Row[] = [];
  for (const binding of bindings) {
    const found = resolved.get(binding);
    if (!found) continue;
    out.push({
      ...binding,
      [field]: found.row.id,
      // The alias moves only when the category did. Migrating it unconditionally
      // renamed the inverter's `power` reading to `state`, which is nonsense: the
      // migration is about a thermostat's run state and nothing else.
      alias: found.migrated
        ? (ALIAS_MIGRATIONS[binding.alias as string] ?? binding.alias)
        : binding.alias,
    });
  }
  return out;
}

export interface IndexRow {
  id: string;
  key: string;
  deviceId: string;
}

/** A key → rows index, for the alias fallback. */
function byKey(
  entries: readonly { key: string }[],
  deviceId: string,
  kind: "data" | "order",
): Map<string, IndexRow[]> {
  const out = new Map<string, IndexRow[]>();
  for (const entry of entries) {
    const id = stableId(
      kind === "data" ? `data:${deviceId}:${entry.key}` : `order:${deviceId}:${entry.key}`,
    );
    out.set(entry.key, [...(out.get(entry.key) ?? []), { id, key: entry.key, deviceId }]);
  }
  return out;
}

export { randomUUID, stableId };

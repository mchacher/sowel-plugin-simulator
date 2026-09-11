/**
 * The demo house is smaller than the real one (spec 003, amendment of 2026-09-11).
 *
 * The showroom backup describes a real house: four levels, sixteen rooms, a cellar
 * and a workshop under the garage. Drawn in three dimensions that is a tower, and
 * a tower nobody can read: the floor above hides the floor below, and a visitor
 * asking what is happening in the kitchen has to peel three storeys off first.
 *
 * So the demo house is a pavilion — a ground floor and one storey, with the garage
 * attached at the side — and the fixture is reshaped to say so **before** anything
 * is derived from it. Two zones go with everything in them; two level zones fold
 * into the one above. Fewer equipments, and that is fine: the demo does not need
 * two motion sensors in a cellar to show what a motion sensor does.
 *
 * This runs on the raw backup, ahead of the derivation, so the rest of the builder
 * never learns those rooms existed. What it removes, it names.
 */

import type { Row } from "./derive.js";

/** Zones that go, with every equipment, binding and recipe instance in them. */
export const DROPPED_ZONES = ["Atelier", "Cave"] as const;

/** Level zones that fold into another: every child and every reference moves. */
export const MERGED_LEVELS: Record<string, string> = {
  "Sous-sol": "RDC",
  "Etage 2": "Etage 1",
};

/**
 * Rooms filed under the wrong level. The real house's stairwell zone sits on its
 * second floor; the pavilion's stairs start in the hall, and the plan draws the
 * stairwell on the ground floor — so that is where its zone goes.
 */
export const MOVED_ZONES: Record<string, string> = { Escalier: "RDC" };

export interface ReshapeReport {
  droppedZoneIds: string[];
  droppedEquipmentIds: string[];
  droppedRecipeInstances: number;
  mergedZoneIds: Record<string, string>;
}

function idByName(tables: Record<string, Row[]>, name: string): string {
  const zone = tables.zones.find((row) => row.name === name);
  if (!zone) throw new Error(`reshape: the fixture has no zone named "${name}"`);
  return zone.id as string;
}

export function reshape(tables: Record<string, Row[]>): ReshapeReport {
  // ── 1. Drop ──────────────────────────────────────────────────────────────
  const droppedZoneIds = DROPPED_ZONES.map((name) => idByName(tables, name));
  const droppedZones = new Set(droppedZoneIds);
  const droppedEquipmentIds = tables.equipments
    .filter((row) => droppedZones.has(row.zone_id as string))
    .map((row) => row.id as string);
  const droppedEquipments = new Set(droppedEquipmentIds);

  tables.equipments = tables.equipments.filter((row) => !droppedEquipments.has(row.id as string));
  tables.data_bindings = tables.data_bindings.filter(
    (row) => !droppedEquipments.has(row.equipment_id as string),
  );
  tables.order_bindings = tables.order_bindings.filter(
    (row) => !droppedEquipments.has(row.equipment_id as string),
  );

  // A recipe instance is a JSON blob naming zones and equipments; one that names
  // anything dropped would come up pointing at nothing. Whole instances go — a
  // motion light with its lamp removed is not a recipe with fewer lamps.
  const mentionsDropped = (text: string): boolean =>
    [...droppedZones, ...droppedEquipments].some((id) => text.includes(id));
  const before = tables.recipe_instances.length;
  tables.recipe_instances = tables.recipe_instances.filter(
    (row) => !mentionsDropped(JSON.stringify(row)),
  );
  const droppedRecipeInstances = before - tables.recipe_instances.length;

  for (const table of ["dashboard_widgets", "button_action_bindings", "chart_configs"]) {
    tables[table] = (tables[table] ?? []).filter((row) => !mentionsDropped(JSON.stringify(row)));
  }
  tables.zone_mode_impacts = tables.zone_mode_impacts.filter(
    (row) => !droppedZones.has(row.zone_id as string),
  );
  tables.zones = tables.zones.filter((row) => !droppedZones.has(row.id as string));

  // ── 2. Merge ─────────────────────────────────────────────────────────────
  const mergedZoneIds: Record<string, string> = {};
  for (const [from, to] of Object.entries(MERGED_LEVELS)) {
    const fromId = idByName(tables, from);
    const toId = idByName(tables, to);
    mergedZoneIds[fromId] = toId;

    for (const row of tables.zones) if (row.parent_id === fromId) row.parent_id = toId;
    for (const [name, rows] of Object.entries(tables)) {
      if (name === "zones") continue;
      for (const row of rows) {
        if (row.zone_id === fromId) row.zone_id = toId;
        // Recipe params and widget configs carry zone ids inside a JSON string.
        for (const field of ["params", "config"]) {
          const value = row[field];
          if (typeof value === "string" && value.includes(fromId)) {
            row[field] = value.split(fromId).join(toId);
          }
        }
      }
    }
    // A mode impact is one row per (mode, zone): folding two zones into one can
    // produce the same pair twice, and the restore's unique index would refuse it.
    const seen = new Set<string>();
    tables.zone_mode_impacts = tables.zone_mode_impacts.filter((row) => {
      const key = `${row.mode_id}:${row.zone_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    tables.zones = tables.zones.filter((row) => row.id !== fromId);
  }

  // ── 3. Move ──────────────────────────────────────────────────────────────
  for (const [name, parent] of Object.entries(MOVED_ZONES)) {
    const zone = tables.zones.find((row) => row.name === name);
    if (zone) zone.parent_id = idByName(tables, parent);
  }

  return { droppedZoneIds, droppedEquipmentIds, droppedRecipeInstances, mergedZoneIds };
}

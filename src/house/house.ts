/**
 * THE HOUSE.
 *
 * Two halves, composed here. `layout.ts` holds what a fixture cannot know — a
 * room's inertia and glazing, the household's agenda, the size of the array.
 * `devices.generated.ts` holds one device per equipment of the demo fixture,
 * derived from it rather than typed by hand.
 *
 * Device ids are stable technical slugs, because `friendlyName` becomes
 * `source_device_id` and that is what a binding resolves against. Display names
 * are not this plugin's business: `upsertFromDiscovery` preserves the name of a
 * device that already exists, so the demo fixture carries "Détecteur Séjour" and
 * the plugin never overwrites it.
 */

import { GENERATED_DEVICES } from "./devices.generated.js";
import { LAYOUT } from "./layout.js";
import type { House, LoadSpec, Room } from "./types.js";

export const HOUSE: House = { ...LAYOUT, devices: GENERATED_DEVICES };

export function roomById(id: string): Room {
  const room = HOUSE.rooms.find((r) => r.id === id);
  if (!room) throw new Error(`Unknown room: ${id}`);
  return room;
}

export function loadById(id: string): LoadSpec {
  const load = HOUSE.loads.find((l) => l.id === id);
  if (!load) throw new Error(`Unknown load: ${id}`);
  return load;
}

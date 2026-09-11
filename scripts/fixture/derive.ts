/**
 * Deriving the demo house from the core's anonymised fixture (spec 003, FR2).
 *
 * An equipment's archetype follows from its type and from the categories its
 * bindings actually resolve to; its room follows from the zone tree. Nothing here
 * is a list somebody typed — a hand-written table of seventy-four rows would be
 * wrong the first time the core regenerates its fixture.
 *
 * TypeScript rather than Python, against the spec's own first guess, for one
 * reason: the rewrite needs the catalogue, and the catalogue is TypeScript. One
 * source of truth beats matching the core's choice of language.
 */

import type { Archetype, DeviceSpec, LoadId } from "../../src/house/types.js";

export type Row = Record<string, unknown>;

export interface Backup {
  version: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

export interface Zone {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  zone_id: string | null;
}

/** What an equipment type maps onto, once its categories have spoken. */
export function archetypeFor(
  equipmentType: string,
  categories: ReadonlySet<string>,
): Archetype | "dropped" | null {
  if (equipmentType === "sensor") {
    if (categories.has("motion")) return categories.has("luminosity") ? "motion_lux" : "motion";
    if (categories.has("temperature")) return "th_probe";
    if (categories.has("co2")) return "air_quality";
    return null;
  }
  // Dropped by decision, not by oversight: docs/devices.md puts media players out
  // of scope, and core issue #932 says a freshly bound one has no power control.
  if (equipmentType === "media_player") return "dropped";

  const byType: Record<string, Archetype> = {
    light_onoff: "relay",
    light_dimmable: "dimmer",
    light_color: "dimmer",
    switch: "relay",
    shutter: "shutter",
    awning: "shutter",
    pool_cover: "pool_cover",
    button: "button",
    thermostat: "thermostat",
    heater: "heater",
    gate: "gate",
    water_valve: "valve",
    water_heater: "relay",
    pool_pump: "relay",
    pool_heat_pump: "pool_heat_pump",
    weather: "outdoor_module",
    weather_forecast: "forecast",
    main_energy_meter: "grid_clamp",
    energy_production_meter: "pv",
    energy_meter: "subload_clamp",
    appliance: "metered_appliance",
  };
  return byType[equipmentType] ?? null;
}

/**
 * Device ids the plugin's own code names, so they cannot be allocated by counting.
 * Keyed by the fixture's equipment name, the only stable handle it offers.
 *
 * Every entry is a place where the code depends on a specific device, and the list
 * being short is the point: everything else is derived.
 */
export const DEVICE_ID_BY_EQUIPMENT_NAME: Record<string, string> = {
  "Shelly Grid": "sim-grid",
  "Shelly Solar": "sim-pv",
  "Compteur PAC": "sim-clamp-heat-pump",
  "Compteur Piscine": "sim-clamp-pool-pump",
  "Prévisions Météo": "Weather Forecast",
  "Station Météo": "sim-outdoor",
  PAC: "sim-thermostat-maison",
  Poele: "sim-thermostat-sejour",
  "PAC Piscine": "sim-pool-heat-pump",
  "Pompe Piscine": "sim-relay-pool-pump",
  "Volet Piscine": "sim-pool-cover",
};

/**
 * Rooms the fixture does not give, because it files the equipment under a level
 * rather than a room. The pellet stove is in the living room; the fixture says
 * "RDC", which is a floor.
 */
export const ROOM_BY_EQUIPMENT_NAME: Record<string, string> = {
  Poele: "sejour",
};

/** The load a device measures or switches, where the fixture implies one. */
export const LOAD_BY_EQUIPMENT_NAME: Record<string, LoadId> = {
  "Compteur PAC": "heat-pump",
  "Compteur Piscine": "pool-pump",
  "Pompe Piscine": "pool-pump",
  "PAC Piscine": "pool-heat-pump",
};

/** Zone names that are levels or the house itself, never a room. */
const CONTAINER_ZONES = new Set(["Maison", "RDC", "Etage 1", "Etage 2", "Sous-sol", "Extérieur"]);

export function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface Derived {
  equipment: Equipment;
  archetype: Archetype;
  /** Undefined for the house-level devices: the meters, the forecast, the remotes. */
  room?: string;
  deviceId: string;
  load?: LoadId;
}

export interface DeriveResult {
  devices: Derived[];
  dropped: Equipment[];
  unmapped: Equipment[];
  rooms: string[];
}

export function derive(
  equipments: Equipment[],
  zones: Map<string, Zone>,
  categoriesOf: (equipmentId: string) => Set<string>,
): DeriveResult {
  const devices: Derived[] = [];
  const dropped: Equipment[] = [];
  const unmapped: Equipment[] = [];
  const rooms = new Set<string>();
  const counters = new Map<string, number>();

  // Sorted by id so two runs over the same fixture allocate the same numbers.
  for (const equipment of [...equipments].sort((a, b) => a.id.localeCompare(b.id))) {
    const archetype = archetypeFor(equipment.type, categoriesOf(equipment.id));
    if (archetype === "dropped") {
      dropped.push(equipment);
      continue;
    }
    if (archetype === null) {
      unmapped.push(equipment);
      continue;
    }

    const zone = equipment.zone_id ? zones.get(equipment.zone_id) : undefined;
    const room =
      ROOM_BY_EQUIPMENT_NAME[equipment.name] ??
      (zone && !CONTAINER_ZONES.has(zone.name) ? slug(zone.name) : undefined);
    if (room) rooms.add(room);

    let deviceId = DEVICE_ID_BY_EQUIPMENT_NAME[equipment.name];
    if (!deviceId) {
      // Kebab throughout: `motion_lux` would otherwise give `sim-motion_lux-…`,
      // the one id in the house with an underscore in it.
      const kind = archetype.replace(/_/g, "-");
      const stem = room ? `sim-${kind}-${room}` : `sim-${kind}`;
      const n = (counters.get(stem) ?? 0) + 1;
      counters.set(stem, n);
      deviceId = `${stem}-${n}`;
    }

    devices.push({
      equipment,
      archetype,
      room,
      deviceId,
      load: LOAD_BY_EQUIPMENT_NAME[equipment.name],
    });
  }

  return { devices, dropped, unmapped, rooms: [...rooms] };
}

/**
 * The devices the simulator has that no fixture equipment implies: the occupants,
 * the house-level simulation device, and the loads the demo needs metered.
 *
 * The water heater is the one equipment the demo house has and the real one does
 * not — a departure recorded in spec 003, taken so the demo can show the spec 152
 * solar channel and the clearest deferrable load there is.
 */
export function additionalDevices(occupantIds: readonly string[]): DeviceSpec[] {
  return [
    { id: "sim-house", archetype: "simulation" },

    // The second recorded departure from "the shape of the real home", and the one
    // that needed the most thought. **The reference house has no door or window
    // contact at all** — not one, in seventy-four equipments.
    //
    // A demo of a home-automation engine without a contact cannot show the
    // `contact_door` category, cannot show a window that stops the heating, and
    // cannot answer a visitor who clicks the front door. Three is the fewest that
    // covers the story: the way in, a French window on the living room, and the
    // garage for the car.
    { id: "sim-contact-entree", archetype: "contact", room: "entree" },
    { id: "sim-contact-sejour", archetype: "contact", room: "sejour" },
    { id: "sim-contact-garage", archetype: "contact", room: "garage" },
    // The fourth: the gate on the drive. A gate motor's relay is a momentary
    // contact and says nothing about where the gate is; the contact does, and it
    // joins the Portail equipment so a client reads the gate as one thing.
    { id: "sim-contact-portail", archetype: "contact", room: "jardin" },

    { id: "sim-relay-water-heater", archetype: "relay", load: "water-heater" },
    {
      id: "sim-relay-water-heater-solar",
      archetype: "relay",
      load: "water-heater",
      solarChannel: true,
    },
    { id: "sim-clamp-water-heater", archetype: "subload_clamp", load: "water-heater" },
    { id: "sim-clamp-pool-heat-pump", archetype: "subload_clamp", load: "pool-heat-pump" },
    { id: "sim-clamp-cuisine", archetype: "subload_clamp", load: "cooking" },
    { id: "sim-appliance-dishwasher", archetype: "metered_appliance", load: "dishwasher" },
    {
      id: "sim-appliance-washing-machine",
      archetype: "metered_appliance",
      load: "washing-machine",
    },
    { id: "sim-rain", archetype: "rain_gauge" },
    { id: "sim-wind", archetype: "wind_gauge" },
    { id: "sim-air-sejour", archetype: "air_quality", room: "sejour" },
    ...occupantIds.map((id): DeviceSpec => ({
      id: `sim-occupant-${id}`,
      archetype: "occupant",
      occupant: id,
    })),
  ];
}

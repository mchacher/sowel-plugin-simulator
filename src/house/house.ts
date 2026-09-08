/**
 * THE HOUSE (spec 001, FR1).
 *
 * One source of truth. Nothing else in the plugin hard-codes a room name, a
 * device id or a load. Adding a lamp is an edit here and nowhere else.
 *
 * Device ids are stable technical slugs, because `friendlyName` becomes
 * `source_device_id` and that is what a binding resolves against. Display names
 * are not this plugin's business: `upsertFromDiscovery` preserves the name of a
 * device that already exists, so the demo fixture carries "Détecteur Séjour" and
 * the plugin never overwrites it.
 */

import type { DeviceSpec, House, LoadSpec, Occupant, Room } from "./types.js";

const rooms: Room[] = [
  {
    id: "entree",
    label: "Entrée",
    level: 0,
    floorAreaM2: 8,
    lossWPerK: 7,
    capacityJPerK: 8 * 100_000,
    setpointC: 19,
    heating: "trv",
    windows: [],
  },
  {
    id: "sejour",
    label: "Séjour",
    level: 0,
    floorAreaM2: 38,
    lossWPerK: 32,
    capacityJPerK: 38 * 100_000,
    setpointC: 20.5,
    heating: "thermostat",
    windows: [
      { orientation: "S", areaM2: 6.5, shutterDeviceId: "sim-shutter-sejour-sud" },
      { orientation: "W", areaM2: 3.2, shutterDeviceId: "sim-shutter-sejour-ouest" },
    ],
  },
  {
    id: "cuisine",
    label: "Cuisine",
    level: 0,
    floorAreaM2: 14,
    lossWPerK: 13,
    capacityJPerK: 14 * 100_000,
    setpointC: 20,
    heating: "trv",
    windows: [{ orientation: "E", areaM2: 1.8, shutterDeviceId: "sim-shutter-cuisine" }],
  },
  {
    id: "bureau",
    label: "Bureau",
    level: 0,
    floorAreaM2: 12,
    lossWPerK: 11,
    capacityJPerK: 12 * 100_000,
    setpointC: 20,
    heating: "heater",
    windows: [{ orientation: "N", areaM2: 1.6, shutterDeviceId: "sim-shutter-bureau" }],
  },
  {
    id: "wc",
    label: "WC",
    level: 0,
    floorAreaM2: 3,
    lossWPerK: 3,
    capacityJPerK: 3 * 100_000,
    setpointC: 18,
    heating: "trv",
    windows: [],
  },
  {
    id: "garage",
    label: "Garage",
    level: 0,
    floorAreaM2: 22,
    lossWPerK: 40,
    capacityJPerK: 22 * 100_000,
    setpointC: 12,
    heating: "none",
    windows: [],
  },
  {
    id: "palier",
    label: "Palier",
    level: 1,
    floorAreaM2: 9,
    lossWPerK: 6,
    capacityJPerK: 9 * 100_000,
    setpointC: 19,
    heating: "trv",
    windows: [],
  },
  {
    id: "chambre-parents",
    label: "Chambre parents",
    level: 1,
    floorAreaM2: 16,
    lossWPerK: 15,
    capacityJPerK: 16 * 100_000,
    setpointC: 18.5,
    heating: "trv",
    windows: [{ orientation: "S", areaM2: 2.4, shutterDeviceId: "sim-shutter-chambre-parents" }],
  },
  {
    id: "chambre-1",
    label: "Chambre 1",
    level: 1,
    floorAreaM2: 12,
    lossWPerK: 12,
    capacityJPerK: 12 * 100_000,
    setpointC: 18.5,
    heating: "trv",
    windows: [{ orientation: "E", areaM2: 1.8, shutterDeviceId: "sim-shutter-chambre-1" }],
  },
  {
    id: "chambre-2",
    label: "Chambre 2",
    level: 1,
    floorAreaM2: 11,
    lossWPerK: 11,
    capacityJPerK: 11 * 100_000,
    setpointC: 18.5,
    heating: "trv",
    windows: [{ orientation: "W", areaM2: 1.8, shutterDeviceId: "sim-shutter-chambre-2" }],
  },
  {
    id: "salle-de-bain",
    label: "Salle de bain",
    level: 1,
    floorAreaM2: 7,
    lossWPerK: 8,
    capacityJPerK: 7 * 100_000,
    setpointC: 21,
    heating: "heater",
    windows: [{ orientation: "N", areaM2: 0.6 }],
  },
  {
    id: "terrasse",
    label: "Terrasse",
    level: 0,
    floorAreaM2: 25,
    lossWPerK: 1000,
    capacityJPerK: 25 * 100_000,
    setpointC: 0,
    heating: "none",
    windows: [],
    outdoor: true,
  },
];

const occupants: Occupant[] = [
  {
    id: "adulte-1",
    label: "Adulte 1",
    kind: "adult",
    bedroom: "chambre-parents",
    weekday: { wake: 6 * 60 + 45, leave: 8 * 60 + 10, back: 18 * 60 + 30, sleep: 22 * 60 + 45 },
    weekend: { wake: 8 * 60 + 45, sleep: 23 * 60 + 30 },
  },
  {
    id: "adulte-2",
    label: "Adulte 2",
    kind: "adult",
    bedroom: "chambre-parents",
    weekday: { wake: 7 * 60, leave: 8 * 60 + 40, back: 17 * 60 + 15, sleep: 22 * 60 + 45 },
    weekend: { wake: 8 * 60 + 30, sleep: 23 * 60 + 30 },
    homeDays: [3],
    homeWorkRoom: "bureau",
  },
  {
    id: "enfant-1",
    label: "Enfant 1",
    kind: "child",
    bedroom: "chambre-1",
    weekday: { wake: 6 * 60 + 55, leave: 7 * 60 + 50, back: 17 * 60, sleep: 21 * 60 + 15 },
    weekend: { wake: 9 * 60, sleep: 22 * 60 },
  },
  {
    id: "enfant-2",
    label: "Enfant 2",
    kind: "child",
    bedroom: "chambre-2",
    weekday: { wake: 7 * 60 + 5, leave: 8 * 60, back: 16 * 60 + 45, sleep: 21 * 60 },
    weekend: { wake: 9 * 60 + 20, sleep: 21 * 60 + 45 },
  },
];

/**
 * Sizing is not decoration (spec 001, FR9b). An arbiter with no surplus, or with
 * a surplus smaller than its smallest load, demonstrates nothing: 6 kWc against a
 * 2 400 W water heater and a 750 W pool pump is a real contest at midday, which is
 * the exact scenario core spec 140 was written for.
 */
const loads: LoadSpec[] = [
  { id: "heat-pump", label: "Pompe à chaleur", nominalW: 2000, arbiterClass: "comfort" },
  { id: "water-heater", label: "Ballon d'eau chaude", nominalW: 2400, arbiterClass: "deferrable" },
  { id: "pool-pump", label: "Pompe piscine", nominalW: 750, arbiterClass: "deferrable" },
  {
    id: "pool-heat-pump",
    label: "PAC piscine",
    nominalW: 1500,
    arbiterClass: "deferrable",
  },
  { id: "cooking", label: "Cuisson", nominalW: 2500, arbiterClass: "background" },
  { id: "dishwasher", label: "Lave-vaisselle", nominalW: 1900, arbiterClass: "background" },
  { id: "washing-machine", label: "Lave-linge", nominalW: 2100, arbiterClass: "background" },
];

const LIT_ROOMS = rooms.filter((r) => !r.outdoor).map((r) => r.id);

const devices: DeviceSpec[] = [
  // Presence and environment
  ...["entree", "cuisine", "palier", "salle-de-bain", "garage", "wc"].map((room): DeviceSpec => ({
    id: `sim-pir-${room}`,
    archetype: "motion",
    room,
  })),
  ...["sejour", "bureau"].map((room): DeviceSpec => ({
    id: `sim-pir-${room}`,
    archetype: "motion_lux",
    room,
  })),
  { id: "sim-contact-entree", archetype: "contact", room: "entree" },
  { id: "sim-contact-sejour", archetype: "contact", room: "sejour" },
  { id: "sim-contact-garage", archetype: "contact", room: "garage" },
  ...["sejour", "bureau", "chambre-parents", "chambre-1", "chambre-2", "salle-de-bain"].map(
    (room): DeviceSpec => ({ id: `sim-th-${room}`, archetype: "th_probe", room }),
  ),
  { id: "sim-air-sejour", archetype: "air_quality", room: "sejour" },
  { id: "sim-button-entree", archetype: "button", room: "entree" },

  // Lighting and openings
  ...LIT_ROOMS.map((room): DeviceSpec => ({ id: `sim-light-${room}`, archetype: "relay", room })),
  { id: "sim-light-exterieur", archetype: "relay_4ch", room: "terrasse", channels: 4 },
  { id: "sim-dimmer-sejour", archetype: "dimmer", room: "sejour" },
  { id: "sim-dimmer-chambre-parents", archetype: "dimmer", room: "chambre-parents" },
  { id: "sim-shutter-sejour-sud", archetype: "shutter", room: "sejour" },
  { id: "sim-shutter-sejour-ouest", archetype: "shutter", room: "sejour" },
  { id: "sim-shutter-cuisine", archetype: "shutter", room: "cuisine" },
  { id: "sim-shutter-bureau", archetype: "shutter", room: "bureau" },
  { id: "sim-shutter-chambre-parents", archetype: "shutter", room: "chambre-parents" },
  { id: "sim-shutter-chambre-1", archetype: "shutter", room: "chambre-1" },
  { id: "sim-shutter-chambre-2", archetype: "shutter", room: "chambre-2" },
  { id: "sim-gate", archetype: "gate" },
  { id: "sim-valve-jardin", archetype: "valve" },

  // Climate
  { id: "sim-thermostat-sejour", archetype: "thermostat", room: "sejour" },
  { id: "sim-heater-salle-de-bain", archetype: "heater", room: "salle-de-bain" },
  { id: "sim-heater-bureau", archetype: "heater", room: "bureau" },
  { id: "sim-pool-heat-pump", archetype: "pool_heat_pump", load: "pool-heat-pump" },

  // Flexible loads: a relay as well as a clamp, or there is nothing to arbitrate
  { id: "sim-relay-water-heater", archetype: "relay", load: "water-heater" },
  {
    id: "sim-relay-water-heater-solar",
    archetype: "relay",
    load: "water-heater",
    solarChannel: true,
  },
  { id: "sim-relay-pool-pump", archetype: "relay", load: "pool-pump" },

  // Energy
  { id: "sim-grid", archetype: "grid_clamp" },
  { id: "sim-pv", archetype: "pv" },
  { id: "sim-clamp-heat-pump", archetype: "subload_clamp", load: "heat-pump" },
  { id: "sim-clamp-water-heater", archetype: "subload_clamp", load: "water-heater" },
  { id: "sim-clamp-pool-pump", archetype: "subload_clamp", load: "pool-pump" },
  { id: "sim-clamp-pool-heat-pump", archetype: "subload_clamp", load: "pool-heat-pump" },
  { id: "sim-clamp-cuisine", archetype: "subload_clamp", load: "cooking" },
  { id: "sim-appliance-dishwasher", archetype: "metered_appliance", load: "dishwasher" },
  { id: "sim-appliance-washing-machine", archetype: "metered_appliance", load: "washing-machine" },

  // Weather
  { id: "sim-outdoor", archetype: "outdoor_module" },
  { id: "sim-rain", archetype: "rain_gauge" },
  { id: "sim-wind", archetype: "wind_gauge" },
  { id: "Weather Forecast", archetype: "forecast" },

  // Occupants — published for the 3D app and for debugging. Presence reaches
  // Sowel through the PIRs, not through these (spec 001, FR7).
  ...occupants.map((o): DeviceSpec => ({
    id: `sim-occupant-${o.id}`,
    archetype: "occupant",
    occupant: o.id,
  })),
];

export const HOUSE: House = {
  rooms,
  occupants,
  devices,
  loads,
  pool: {
    volumeM3: 48,
    surfaceM2: 32,
    lossWPerK: 600,
    setpointC: 27,
    heatPumpThermalW: 7000,
  },
  pv: { peakW: 6000, systemLoss: 0.12 },
  baseLoadW: { night: 250, day: 380, evening: 620 },
};

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

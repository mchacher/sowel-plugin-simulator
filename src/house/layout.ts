/**
 * The half of the house description a fixture cannot know (spec 003, FR1).
 *
 * The fixture says which rooms exist and what is in them. It does not say a
 * room's inertia, its glazing or which way its windows face; it does not know the
 * household's agenda, and it has no opinion about how big the array is. Those are
 * physical facts about a building and a family, and they are written here by hand.
 *
 * The other half — one device per fixture equipment — is generated into
 * `devices.generated.ts`. Keeping them in separate files rather than in marked
 * regions of one file is deliberate: a generated file can honestly say "do not
 * edit", and nobody loses an afternoon's work to the next run.
 */

import type { LoadSpec, Occupant, PoolSpec, Room } from "./types.js";

const rooms: Room[] = [
  // The pavilion: a ground floor and one storey, the garage attached on the east.
  // Areas and orientations are the 3D plan's (sowel-house-3d, `scripts/plan/`),
  // which is the drawing of this house; the physics runs on the same rooms a
  // visitor sees, at the same size, facing the same way.

  // ── Ground floor ─────────────────────────────────────────────────────────
  {
    id: "entree",
    label: "Entrée",
    level: 0,
    floorAreaM2: 7.5,
    lossWPerK: 7,
    capacityJPerK: 7.5 * 100_000,
    setpointC: 19,
    setpointOffsetK: 1.5,
    heating: "trv",
    windows: [],
  },
  {
    id: "sejour",
    label: "Séjour",
    level: 0,
    floorAreaM2: 47,
    lossWPerK: 38,
    capacityJPerK: 47 * 100_000,
    setpointC: 20.5,
    // The pellet stove: a local unit with its own setpoint, and the reason the
    // living room is the one room that does not simply follow the house.
    heating: "thermostat",
    // Two bays onto the terrace, one window to the west.
    windows: [
      { orientation: "S", areaM2: 5.2, shutterDeviceId: "sim-shutter-sejour-1" },
      { orientation: "S", areaM2: 3.4, shutterDeviceId: "sim-shutter-sejour-2" },
      { orientation: "W", areaM2: 3.2, shutterDeviceId: "sim-shutter-sejour-3" },
    ],
  },
  {
    id: "cuisine",
    label: "Cuisine",
    level: 0,
    floorAreaM2: 20,
    lossWPerK: 17,
    capacityJPerK: 20 * 100_000,
    setpointC: 20,
    setpointOffsetK: 0.5,
    heating: "trv",
    // A window over the sink to the street, and the glazed door to the side.
    windows: [
      { orientation: "N", areaM2: 1.8, shutterDeviceId: "sim-shutter-cuisine-1" },
      { orientation: "E", areaM2: 3.6, shutterDeviceId: "sim-shutter-cuisine-2" },
    ],
  },
  {
    id: "bureau",
    label: "Bureau",
    level: 0,
    floorAreaM2: 10.5,
    lossWPerK: 10,
    capacityJPerK: 10.5 * 100_000,
    setpointC: 20,
    setpointOffsetK: 0.5,
    heating: "trv",
    windows: [{ orientation: "N", areaM2: 1.6, shutterDeviceId: "sim-shutter-bureau-1" }],
  },
  {
    id: "wc",
    label: "WC",
    level: 0,
    floorAreaM2: 3,
    lossWPerK: 3,
    capacityJPerK: 3 * 100_000,
    setpointC: 19,
    setpointOffsetK: 1.5,
    heating: "trv",
    windows: [],
  },
  {
    id: "escalier",
    label: "Escalier",
    level: 0,
    floorAreaM2: 7.5,
    lossWPerK: 5,
    capacityJPerK: 7.5 * 100_000,
    setpointC: 18,
    setpointOffsetK: 2.5,
    // A stairwell is heated by the rooms around it, not by a valve of its own.
    heating: "none",
    windows: [],
  },
  {
    id: "garage",
    label: "Garage",
    level: 0,
    floorAreaM2: 30,
    // Three outside walls and a door the size of a car: it follows the weather.
    lossWPerK: 45,
    capacityJPerK: 30 * 100_000,
    setpointC: 12,
    heating: "none",
    windows: [],
  },

  // ── First floor ──────────────────────────────────────────────────────────
  {
    id: "chambre-parents",
    label: "Chambre Parents",
    level: 1,
    floorAreaM2: 18,
    lossWPerK: 16,
    capacityJPerK: 18 * 100_000,
    setpointC: 18.5,
    setpointOffsetK: 2,
    heating: "trv",
    windows: [{ orientation: "S", areaM2: 2.4, shutterDeviceId: "sim-shutter-chambre-parents-1" }],
  },
  {
    id: "chambre-enfant-1",
    label: "Chambre Enfant 1",
    level: 1,
    floorAreaM2: 15.75,
    lossWPerK: 14,
    capacityJPerK: 15.75 * 100_000,
    setpointC: 18.5,
    setpointOffsetK: 2,
    heating: "trv",
    windows: [{ orientation: "S", areaM2: 1.8, shutterDeviceId: "sim-shutter-chambre-enfant-1-1" }],
  },
  {
    id: "chambre-enfant-2",
    label: "Chambre Enfant 2",
    level: 1,
    floorAreaM2: 13.5,
    lossWPerK: 12,
    capacityJPerK: 13.5 * 100_000,
    setpointC: 18.5,
    setpointOffsetK: 2,
    // An electric radiator, where the heat pump's circuit does not go.
    heating: "heater",
    // No shutter in the fixture: a plain window, and nothing to close over it.
    windows: [{ orientation: "S", areaM2: 1.2 }],
  },
  {
    id: "chambre-enfant-3",
    label: "Chambre Enfant 3",
    level: 1,
    floorAreaM2: 16,
    lossWPerK: 15,
    capacityJPerK: 16 * 100_000,
    setpointC: 18.5,
    setpointOffsetK: 2,
    heating: "heater",
    windows: [{ orientation: "N", areaM2: 1.4, shutterDeviceId: "sim-shutter-chambre-enfant-3-1" }],
  },
  {
    id: "salle-de-bain",
    label: "Salle de Bain",
    level: 1,
    floorAreaM2: 10.5,
    lossWPerK: 10,
    capacityJPerK: 10.5 * 100_000,
    setpointC: 21,
    // Warmer than the bedrooms it sits between: its valve is opened, not turned
    // down. The fixture has no radiator of its own here.
    setpointOffsetK: -0.5,
    heating: "trv",
    windows: [{ orientation: "N", areaM2: 0.6, shutterDeviceId: "sim-shutter-salle-de-bain-1" }],
  },

  // ── Outdoors ─────────────────────────────────────────────────────────────
  // These track the outdoor model. They are rooms only so that the devices in
  // them have somewhere to live and the zone tree matches the fixture.
  {
    id: "jardin",
    label: "Jardin",
    level: null,
    floorAreaM2: 400,
    lossWPerK: 10_000,
    capacityJPerK: 400 * 100_000,
    setpointC: 0,
    heating: "none",
    windows: [],
    outdoor: true,
  },
  {
    id: "piscine",
    label: "Piscine",
    level: null,
    floorAreaM2: 32,
    lossWPerK: 10_000,
    capacityJPerK: 32 * 100_000,
    setpointC: 0,
    heating: "none",
    windows: [],
    outdoor: true,
  },
  {
    id: "terrasse",
    label: "Terrasse",
    level: null,
    floorAreaM2: 31.5,
    lossWPerK: 10_000,
    capacityJPerK: 31.5 * 100_000,
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
    bedroom: "chambre-enfant-1",
    weekday: { wake: 6 * 60 + 55, leave: 7 * 60 + 50, back: 17 * 60, sleep: 21 * 60 + 15 },
    weekend: { wake: 9 * 60, sleep: 22 * 60 },
  },
  {
    id: "enfant-2",
    label: "Enfant 2",
    kind: "child",
    bedroom: "chambre-enfant-2",
    weekday: { wake: 7 * 60 + 5, leave: 8 * 60, back: 16 * 60 + 45, sleep: 21 * 60 },
    weekend: { wake: 9 * 60 + 20, sleep: 21 * 60 + 45 },
  },
  {
    // The third bedroom is furnished and heated in the fixture, so somebody
    // sleeps in it.
    id: "enfant-3",
    label: "Enfant 3",
    kind: "child",
    bedroom: "chambre-enfant-3",
    weekday: { wake: 7 * 60 + 10, leave: 8 * 60 + 5, back: 17 * 60 + 30, sleep: 21 * 60 + 30 },
    weekend: { wake: 9 * 60 + 40, sleep: 22 * 60 },
  },
];

/**
 * Sizing is not decoration (spec 001, FR9b). An arbiter with no surplus, or with
 * a surplus smaller than its smallest load, demonstrates nothing: 4 kWc against a
 * 2 400 W water heater and a 750 W pool pump is a real contest at midday, which is
 * the exact scenario core spec 140 was written for.
 */

const loads: LoadSpec[] = [
  { id: "heat-pump", label: "Pompe à chaleur", nominalW: 2000, arbiterClass: "comfort" },
  {
    id: "water-heater",
    label: "Ballon thermodynamique",
    // A heat pump, not a resistance: 600 W drawn for 1 800 W of heat. The surplus
    // input raises its target from 55 to 62 °C rather than switching it on.
    nominalW: 600,
    arbiterClass: "deferrable",
  },
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

/**
 * The house's own heat pump: the air-to-water unit that serves every `trv` room
 * through its valves. It has no room of its own, which is why it is named here
 * rather than found by looking in one.
 */
export const HOUSE_THERMOSTAT_DEVICE_ID = "sim-thermostat-maison";

export const LAYOUT = {
  rooms,
  occupants,
  loads,
  houseThermostatDeviceId: HOUSE_THERMOSTAT_DEVICE_ID,
  pool: {
    volumeM3: 48,
    surfaceM2: 32,
    lossWPerK: 600,
    setpointC: 27,
    heatPumpThermalW: 7000,
  } satisfies PoolSpec,
  // Eight 500 W panels on the south slope of the roof — the ones the 3D view draws.
  pv: { peakW: 4000, systemLoss: 0.12 },
  baseLoadW: { night: 250, day: 380, evening: 620 },
};

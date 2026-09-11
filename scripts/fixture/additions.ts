/**
 * The equipments the demo needs and the fixture does not have (spec 003, FR5).
 *
 * Two different things live here.
 *
 * Some added devices belong to an equipment the fixture already has: the weather
 * station is one equipment over four devices here — outdoor module, rain gauge,
 * wind gauge and the indoor air module — because that is what a Netatmo actually
 * is, and the category matching distributes its bindings between them.
 *
 * The rest need an equipment of their own, and then the `sim.*` order bindings,
 * because Sowel has no device-level order route: the only path that reaches a
 * plugin is `POST /equipments/:id/orders/:alias`. A simulation order nobody bound
 * is a simulation order nobody can call.
 */

import type { DeviceSpec } from "../../src/house/types.js";
import { declare } from "../../src/publish/catalogue.js";
import type { Row } from "./derive.js";
import { shape, stableId, type TableColumns } from "./rewrite.js";

/** Added devices that join an equipment the fixture already has, by its name. */
export const ATTACH_TO_EQUIPMENT_NAMED: Record<string, string> = {
  "sim-rain": "Station Météo",
  "sim-wind": "Station Météo",
  "sim-air-sejour": "Station Météo",
  "sim-clamp-pool-heat-pump": "PAC Piscine",
  "sim-clamp-water-heater": "__water-heater__",
  "sim-relay-water-heater": "__water-heater__",
  "sim-relay-water-heater-solar": "__water-heater__",
};

interface NewEquipment {
  name: string;
  type: string;
  /** Room id whose zone the equipment goes in; the house root when absent. */
  room?: string;
  deviceIds: string[];
}

/** Equipments the demo house gains, with the devices behind each. */
export const NEW_EQUIPMENTS: NewEquipment[] = [
  { name: "Porte d'Entrée", type: "sensor", room: "entree", deviceIds: ["sim-contact-entree"] },
  { name: "Porte-Fenêtre", type: "sensor", room: "sejour", deviceIds: ["sim-contact-sejour"] },
  {
    name: "Porte Garage Contact",
    type: "sensor",
    room: "garage",
    deviceIds: ["sim-contact-garage"],
  },
  {
    // The one equipment the demo house has and the real one does not. Its two
    // relays are the whole point: the main supply, and the 230 V surplus contact
    // core spec 152 models, which raises the target rather than switching it on.
    name: "Ballon Thermodynamique",
    type: "water_heater",
    room: "garage",
    deviceIds: ["sim-relay-water-heater", "sim-relay-water-heater-solar", "sim-clamp-water-heater"],
  },
  {
    name: "Compteur Cuisine",
    type: "energy_meter",
    room: "cuisine",
    deviceIds: ["sim-clamp-cuisine"],
  },
  {
    name: "Lave-Vaisselle",
    type: "appliance",
    room: "cuisine",
    deviceIds: ["sim-appliance-dishwasher"],
  },
  {
    name: "Lave-Linge",
    type: "appliance",
    room: "garage",
    deviceIds: ["sim-appliance-washing-machine"],
  },
  { name: "Simulation", type: "switch", deviceIds: ["sim-house"] },
  {
    // Adopted: the fixture's gate has a motor relay and nothing that says where
    // the gate is. The contact is a *new* reading on an existing equipment, which
    // is what adoption is for — attaching by name only re-points bindings the
    // fixture already had, and it had none for this.
    name: "Portail",
    type: "gate",
    deviceIds: ["sim-contact-portail"],
  },
  {
    // The fixture has this equipment and **no bindings at all** behind it — a
    // pool cover nobody ever wired up. It is adopted rather than recreated, so
    // the zone tree and anything referring to it stay as they are.
    name: "Volet Piscine",
    type: "pool_cover",
    room: "piscine",
    deviceIds: ["sim-pool-cover"],
  },
];

/** One `sensor` equipment per occupant, so the 3D application can move them. */
export function occupantEquipments(occupantLabels: Map<string, string>): NewEquipment[] {
  return [...occupantLabels].map(([id, label]) => ({
    name: label,
    type: "sensor",
    deviceIds: [`sim-occupant-${id}`],
  }));
}

export interface BuiltAdditions {
  equipments: Row[];
  dataBindings: Row[];
  orderBindings: Row[];
}

/**
 * The solar role is assigned by hand, never guessed — core spec 152 is explicit
 * that nothing at discovery distinguishes a solar relay from a main one.
 */
const SOLAR_ALIAS = "solar";
const SOLAR_STATE_ALIAS = "solar_state";

export function buildAdditions(
  equipments: NewEquipment[],
  devicesById: Map<string, DeviceSpec>,
  roomIds: readonly string[],
  columns: TableColumns,
  zoneIdForRoom: (room: string | undefined) => string | null,
  /** Equipment ids the fixture already has, by name: adopt rather than duplicate. */
  existingByName: Map<string, string> = new Map(),
): BuiltAdditions {
  const out: BuiltAdditions = { equipments: [], dataBindings: [], orderBindings: [] };

  for (const spec of equipments) {
    const adopted = existingByName.get(spec.name);
    const equipmentId = adopted ?? stableId(`equipment:${spec.name}`);
    if (!adopted)
      out.equipments.push(
        shape(columns.equipments, {
          id: equipmentId,
          name: spec.name,
          zone_id: zoneIdForRoom(spec.room),
          type: spec.type,
          icon: null,
          description: null,
          enabled: 1,
          created_at: null,
          updated_at: null,
        }),
      );

    for (const deviceId of spec.deviceIds) {
      const device = devicesById.get(deviceId);
      if (!device)
        throw new Error(`NEW_EQUIPMENTS names a device that does not exist: ${deviceId}`);
      const declaration = declare(device, roomIds);
      const solar = device.solarChannel === true;

      for (const entry of declaration.data) {
        out.dataBindings.push(
          shape(columns.dataBindings, {
            id: stableId(`data-binding:${spec.name}:${deviceId}:${entry.key}`),
            equipment_id: equipmentId,
            device_data_id: stableId(`data:${deviceId}:${entry.key}`),
            alias:
              solar && entry.category === "light_state"
                ? SOLAR_STATE_ALIAS
                : aliasFor(entry.key, entry.category),
            historize: null,
          }),
        );
      }
      for (const order of declaration.orders) {
        out.orderBindings.push(
          shape(columns.orderBindings, {
            id: stableId(`order-binding:${spec.name}:${deviceId}:${order.key}`),
            equipment_id: equipmentId,
            device_order_id: stableId(`order:${deviceId}:${order.key}`),
            alias:
              solar && order.category === "light_toggle"
                ? SOLAR_ALIAS
                : aliasFor(order.key, order.category),
          }),
        );
      }
    }
  }
  return out;
}

/**
 * The alias a binding takes. Category-driven where the core has a convention, and
 * the key itself otherwise — which is what the `sim.*` orders want, since they
 * carry no category on purpose.
 */
function aliasFor(key: string, category: string | undefined): string {
  const byCategory: Record<string, string> = {
    light_state: "state",
    light_toggle: "state",
    light_brightness: "brightness",
    set_brightness: "brightness",
    shutter_position: "position",
    set_shutter_position: "position",
    shutter_move: "state",
    contact_door: "contact",
    battery: "battery",
    power: "power",
    energy: key,
    appliance_state: "state",
    motion: "motion",
    luminosity: "luminosity",
    temperature: "temperature",
    humidity: "humidity",
    generic: key,
  };
  return (category && byCategory[category]) ?? key;
}

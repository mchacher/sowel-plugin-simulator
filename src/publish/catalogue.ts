/**
 * The catalogue, in code (spec 001).
 *
 * One declaration per archetype, exactly as `docs/devices.md` specifies. This is
 * the only place those literals appear: keys, categories, types, units, bounds
 * and enum vocabularies. Get them right and everything downstream follows on its
 * own — binding suggestions, zone aggregation, the energy surfaces, the
 * thermostat card. **The category is the contract.**
 */

import type { Archetype, DeviceSpec } from "../house/types.js";
import type { DiscoveredDevice } from "../sowel-api.js";

/**
 * Keys no simulated device ever publishes.
 *
 * The first group is configuration noise — roughly half the readings in the
 * reference installation, all under `generic`, none of it visible to a user, all
 * of it costing WebSocket traffic to every visitor and cluttering every binding
 * dialog. The second is vendor vocabulary: a simulated Panasonic that does not
 * talk to Panasonic is a lie about what is being demonstrated.
 */
export const PROHIBITED_KEYS: readonly string[] = [
  "linkquality",
  "power_on_behavior",
  "keep_time",
  "sensitivity",
  "lift_duration",
  "dimmer_mode",
  "indicator_mode",
  "on_level",
  "device_mode",
  "power_outage_count",
  "nanoe",
  "airSwingUD",
  "airSwingLR",
  "ecoMode",
  "fanSpeed",
  "stoveState",
  "profile",
  "pelletSensor",
  "ignitionCount",
  "sparkPlug",
  "resetAlarm",
  "ch1_power",
  "serial",
  "signal",
  "frequency",
];

/**
 * The modes the simulated heat pump actually has. Declaring `cool`, `dry` and
 * `fan` on a unit whose model cannot do them would be vendor noise of exactly
 * the kind this catalogue exists to keep out.
 */
export const SIMULATED_OPERATION_MODES = ["auto", "heat"];

export const WEATHER_CONDITIONS = [
  "sunny",
  "partly_cloudy",
  "cloudy",
  "foggy",
  "rainy",
  "snowy",
  "stormy",
];

/**
 * `appliance_state` carries exactly two values while core issue #936 is open:
 * two real plugins publish four, and the core charts the category as binary and
 * clips the rest.
 */
export const APPLIANCE_STATES = ["on", "off"];

/**
 * Brightness travels on the Zigbee 0–254 scale, not a percentage, while core
 * issue #933 is open: a device's declared `min`/`max` are ignored and that range
 * is hard-coded in the interface, so a light declaring 0–100 would read 39 % at
 * full power.
 */
export const BRIGHTNESS_MAX = 254;

const battery = { key: "battery", type: "number", category: "battery", unit: "%" } as const;

/**
 * Simulation orders (spec 002, FR3) carry **no category**.
 *
 * A category is what every core consumer keys off, and these are none of the
 * categories the core knows. Giving them one would make a motion sensor look
 * like an actuator in the binding dialog. Uncategorised they are extras: bound
 * by hand when someone wants them, invisible otherwise.
 */
const SIM_TRIGGER = { type: "boolean" } as const;

type Declaration = Omit<DiscoveredDevice, "friendlyName">;

function declarationFor(
  archetype: Archetype,
  device: DeviceSpec,
  roomIds: readonly string[],
): Declaration {
  switch (archetype) {
    case "motion":
      return {
        data: [{ key: "occupancy", type: "boolean", category: "motion" }, battery],
        orders: [{ key: "sim.motion", ...SIM_TRIGGER }],
        powerSource: "battery",
      };
    case "motion_lux":
      return {
        data: [
          { key: "occupancy", type: "boolean", category: "motion" },
          { key: "illuminance", type: "number", category: "luminosity", unit: "lx" },
          battery,
        ],
        orders: [{ key: "sim.motion", ...SIM_TRIGGER }],
        powerSource: "battery",
      };
    case "contact":
      return {
        // Zigbee declares `contact` true-means-CLOSED. A door that reads true
        // when open is a door every recipe gets backwards.
        data: [{ key: "contact", type: "boolean", category: "contact_door" }, battery],
        orders: [
          { key: "sim.open", ...SIM_TRIGGER },
          { key: "sim.close", ...SIM_TRIGGER },
        ],
        powerSource: "battery",
      };
    case "th_probe":
      return {
        data: [
          { key: "temperature", type: "number", category: "temperature", unit: "°C" },
          { key: "humidity", type: "number", category: "humidity", unit: "%" },
          battery,
        ],
        orders: [{ key: "sim.temperature", type: "number", min: -10, max: 40, unit: "°C" }],
        powerSource: "battery",
      };
    case "air_quality":
      return {
        data: [
          { key: "temperature", type: "number", category: "temperature", unit: "°C" },
          { key: "humidity", type: "number", category: "humidity", unit: "%" },
          { key: "pressure", type: "number", category: "pressure", unit: "hPa" },
          { key: "co2", type: "number", category: "co2", unit: "ppm" },
          { key: "noise", type: "number", category: "noise", unit: "dB" },
        ],
        orders: [],
        powerSource: "mains",
      };
    case "button":
      return {
        data: [
          {
            key: "action",
            type: "enum",
            category: "action",
            enumValues: ["single", "double", "hold"],
          },
          battery,
        ],
        orders: [],
        powerSource: "battery",
      };
    case "relay":
      return {
        data: [{ key: "state", type: "boolean", category: "light_state" }],
        orders: [{ key: "state", type: "boolean", category: "light_toggle" }],
        powerSource: "mains",
      };
    case "relay_4ch": {
      const channels = device.channels ?? 4;
      const keys = Array.from({ length: channels }, (_, i) => `power${i + 1}`);
      return {
        // Booleans, not an enum of "ON"/"OFF". Core issue #930 is about a relay
        // arriving in two different shapes and eighteen modules downstream
        // defending against both; a greenfield plugin declares the shape the
        // core actually wants rather than reproducing the older one.
        data: keys.map((key) => ({
          key,
          type: "boolean" as const,
          category: "light_state" as const,
        })),
        orders: keys.map((key) => ({
          key,
          type: "boolean" as const,
          category: "light_toggle" as const,
        })),
        powerSource: "mains",
      };
    }
    case "dimmer":
      return {
        data: [
          { key: "state", type: "boolean", category: "light_state" },
          {
            key: "brightness",
            type: "number",
            category: "light_brightness",
          },
        ],
        orders: [
          { key: "state", type: "boolean", category: "light_toggle" },
          {
            key: "brightness",
            type: "number",
            category: "set_brightness",
            min: 0,
            max: BRIGHTNESS_MAX,
          },
        ],
        powerSource: "mains",
      };
    case "shutter":
    case "pool_cover":
      return {
        // A pool cover declares exactly what a shutter declares, because the core
        // resolves a `pool_cover` equipment through the same branch of
        // `computeBindingCandidates` and aliases `pool_cover_move` and
        // `shutter_move` to the same `state`. One archetype for the physics, one
        // declaration for the contract.
        //
        // A shutter reports only its position; `state` is write-only.
        data: [{ key: "position", type: "number", category: "shutter_position", unit: "%" }],
        orders: [
          { key: "position", type: "number", category: "set_shutter_position", min: 0, max: 100 },
          {
            key: "state",
            type: "enum",
            category: "shutter_move",
            enumValues: ["OPEN", "CLOSE", "STOP"],
          },
        ],
        powerSource: "mains",
      };
    case "gate":
      return {
        data: [{ key: "R1", type: "boolean", category: "gate_state" }],
        orders: [{ key: "R1", type: "boolean", category: "gate_trigger" }],
        powerSource: "mains",
      };
    case "valve":
      return {
        data: [{ key: "state", type: "boolean", category: "light_state" }, battery],
        orders: [{ key: "state", type: "boolean", category: "light_toggle" }],
        // An irrigation valve in a garden has no mains next to it.
        powerSource: "battery",
      };
    case "thermostat":
      return {
        data: [
          { key: "temperature", type: "number", category: "temperature", unit: "°C" },
          { key: "setpoint", type: "number", category: "setpoint", unit: "°C" },
          // Spec 176/177: the boolean run state binds under the `state` alias,
          // which `light_state` maps to directly. Declaring it under `power`
          // works too, but only because the core rescues that case for a
          // Panasonic that got there first (issue #901) — a greenfield plugin
          // has no reason to need rescuing.
          { key: "state", type: "boolean", category: "light_state" },
          {
            key: "operationMode",
            type: "enum",
            category: "operation_mode",
            enumValues: SIMULATED_OPERATION_MODES,
          },
          {
            key: "outsideTemperature",
            type: "number",
            category: "temperature_outdoor",
            unit: "°C",
          },
        ],
        orders: [
          { key: "power", type: "boolean", category: "toggle_power" },
          {
            key: "setpoint",
            type: "number",
            category: "set_setpoint",
            min: 16,
            max: 30,
            unit: "°C",
          },
          {
            key: "operationMode",
            type: "enum",
            category: "set_operation_mode",
            enumValues: SIMULATED_OPERATION_MODES,
          },
          { key: "sim.temperature", type: "number", min: -10, max: 40, unit: "°C" },
        ],
        powerSource: "mains",
      };
    case "heater":
      return {
        data: [{ key: "state", type: "boolean", category: "light_state" }],
        orders: [{ key: "state", type: "boolean", category: "light_toggle" }],
        powerSource: "mains",
      };
    case "pool_heat_pump":
      return {
        data: [
          {
            key: "water_temperature",
            type: "number",
            category: "pool_water_temperature",
            unit: "°C",
          },
          {
            key: "outdoor_temperature",
            type: "number",
            category: "temperature_outdoor",
            unit: "°C",
          },
          { key: "setpoint", type: "number", category: "pool_temperature_setpoint", unit: "°C" },
          // Whether the unit is actually running. The model knows; the card shows
          // it; and without it the fixture's own state binding has nowhere to go.
          { key: "state", type: "boolean", category: "light_state" },
        ],
        orders: [
          {
            key: "setpoint",
            type: "number",
            category: "set_pool_temperature_setpoint",
            min: 10,
            max: 30,
            unit: "°C",
          },
        ],
        powerSource: "mains",
      };
    case "grid_clamp":
      return {
        data: [
          // Signed: negative means export. The energy arbiter is the only
          // component allowed to smooth this (core spec 140).
          { key: "power", type: "number", category: "power", unit: "W" },
          { key: "voltage", type: "number", category: "voltage", unit: "V" },
          { key: "current", type: "number", category: "current", unit: "A" },
          { key: "energy_forward", type: "number", category: "energy", unit: "Wh" },
          { key: "energy_reverse", type: "number", category: "energy", unit: "Wh" },
          { key: "energy", type: "number", category: "energy", unit: "Wh" },
        ],
        orders: [],
        powerSource: "mains",
      };
    case "subload_clamp":
      return {
        data: [
          { key: "power", type: "number", category: "power", unit: "W" },
          { key: "energy", type: "number", category: "energy", unit: "Wh" },
        ],
        orders: [],
        powerSource: "mains",
      };
    case "pv":
      return {
        data: [
          { key: "power", type: "number", category: "power", unit: "W" },
          { key: "energy", type: "number", category: "energy", unit: "Wh" },
          // The production total. A clamp on an inverter measures both
          // directions, but an inverter only ever produces, so there is no
          // `energy_reverse` here and a binding for one is correctly dropped.
          { key: "energy_forward", type: "number", category: "energy", unit: "Wh" },
        ],
        orders: [],
        powerSource: "mains",
      };
    case "metered_appliance":
      return {
        data: [
          { key: "power", type: "number", category: "power", unit: "W" },
          { key: "energy", type: "number", category: "energy", unit: "Wh" },
          {
            key: "state",
            type: "enum",
            category: "appliance_state",
            enumValues: APPLIANCE_STATES,
          },
        ],
        orders: [],
        powerSource: "mains",
      };
    case "outdoor_module":
      return {
        data: [
          { key: "temperature", type: "number", category: "temperature_outdoor", unit: "°C" },
          { key: "humidity", type: "number", category: "humidity_outdoor", unit: "%" },
          battery,
        ],
        orders: [{ key: "sim.weather", type: "enum", enumValues: WEATHER_CONDITIONS }],
        powerSource: "battery",
      };
    case "rain_gauge":
      return {
        data: [
          { key: "rain", type: "number", category: "rain", unit: "mm" },
          { key: "sum_rain_24", type: "number", category: "rain", unit: "mm" },
          battery,
        ],
        orders: [],
        powerSource: "battery",
      };
    case "wind_gauge":
      return {
        data: [
          { key: "wind_strength", type: "number", category: "wind", unit: "km/h" },
          { key: "wind_angle", type: "number", category: "wind", unit: "°" },
          { key: "gust_strength", type: "number", category: "wind", unit: "km/h" },
          { key: "gust_angle", type: "number", category: "wind", unit: "°" },
          battery,
        ],
        orders: [],
        powerSource: "battery",
      };
    case "forecast": {
      const data: Declaration["data"] = [];
      // Five days, starting tomorrow. There is no day 0.
      for (let i = 1; i <= 5; i++) {
        data.push({
          key: `j${i}_condition`,
          type: "enum",
          category: "weather_condition",
          enumValues: WEATHER_CONDITIONS,
        });
        data.push({
          key: `j${i}_temp_min`,
          type: "number",
          category: "temperature_outdoor",
          unit: "°C",
        });
        data.push({
          key: `j${i}_temp_max`,
          type: "number",
          category: "temperature_outdoor",
          unit: "°C",
        });
        data.push({ key: `j${i}_rain_prob`, type: "number", category: "rain", unit: "%" });
        data.push({ key: `j${i}_wind_gusts`, type: "number", category: "wind", unit: "km/h" });
      }
      return { data, orders: [], powerSource: "mains" };
    }
    case "occupant":
      return {
        // An occupant is not in a zone — it moves between them — so this is not
        // something a person binds to an equipment. It is published for the 3D
        // application and for debugging. Presence reaches Sowel through the PIRs.
        data: [
          {
            key: "zone",
            type: "enum",
            category: "generic",
            enumValues: [...roomIds, "away"],
          },
          { key: "present", type: "boolean", category: "generic" },
        ],
        orders: [
          { key: "sim.enter", ...SIM_TRIGGER },
          { key: "sim.leave", ...SIM_TRIGGER },
        ],
        powerSource: "mains",
      };
    case "simulation":
      return {
        // A ghost is a visitor's own presence. `sejour` addresses the default
        // ghost, `g7:sejour` addresses ghost `g7`, so several visitors do not
        // fight over one.
        data: [{ key: "ghosts", type: "number", category: "generic" }],
        orders: [{ key: "sim.ghost", type: "string" }],
        powerSource: "mains",
      };
  }
}

/**
 * The full discovery declaration for one device of the house.
 *
 * It takes the room ids rather than the whole house so that the generator can
 * call it before the device list exists — which is the one thing it must be able
 * to do, since it is the device list it produces.
 */
export function declare(device: DeviceSpec, roomIds: readonly string[]): DiscoveredDevice {
  const declaration = declarationFor(device.archetype, device, roomIds);
  return {
    friendlyName: device.id,
    manufacturer: "Sowel",
    model: device.archetype,
    ...declaration,
  };
}

/** Every key an archetype declares, data and orders. */
export function declaredKeys(device: DeviceSpec, roomIds: readonly string[]): string[] {
  const declaration = declare(device, roomIds);
  return [...declaration.data.map((d) => d.key), ...declaration.orders.map((o) => o.key)];
}

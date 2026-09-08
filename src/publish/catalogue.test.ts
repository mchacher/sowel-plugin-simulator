import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import type { DeviceSpec } from "../house/types.js";
import {
  APPLIANCE_STATES,
  BRIGHTNESS_MAX,
  declare,
  declaredKeys,
  PROHIBITED_KEYS,
  SIMULATED_OPERATION_MODES,
} from "./catalogue.js";

const CATALOGUE_DOC = readFileSync(new URL("../../docs/devices.md", import.meta.url), "utf8");

const find = (archetype: DeviceSpec["archetype"]): DeviceSpec => {
  const device = HOUSE.devices.find((d) => d.archetype === archetype);
  if (!device) throw new Error(`No ${archetype} in the house`);
  return device;
};

const declarationOf = (archetype: DeviceSpec["archetype"]) => declare(find(archetype), HOUSE);
const dataOf = (archetype: DeviceSpec["archetype"], key: string) =>
  declarationOf(archetype).data.find((d) => d.key === key);
const orderOf = (archetype: DeviceSpec["archetype"], key: string) =>
  declarationOf(archetype).orders.find((o) => o.key === key);

describe("the catalogue matches docs/devices.md", () => {
  it("declares no key the document does not mention", () => {
    // The document is the contract; the code is one reading of it. A key here
    // that is not there is drift, whichever of the two is wrong.
    const undocumented = new Set<string>();
    for (const device of HOUSE.devices) {
      for (const key of declaredKeys(device, HOUSE)) {
        // Two families are documented as patterns rather than one row each: the
        // forecast's five days, and the multi-channel relay's channels.
        const documented = key.replace(/^j[1-5]_/, "j{i}_").replace(/^power[23]$/, "power1");
        if (!CATALOGUE_DOC.includes(`\`${documented}\``)) undocumented.add(key);
      }
    }
    expect([...undocumented]).toEqual([]);
  });

  it("puts every reading in a category, and never leaves an enum without a vocabulary", () => {
    for (const device of HOUSE.devices) {
      const declaration = declare(device, HOUSE);
      for (const entry of declaration.data) {
        expect(entry.category, `${device.id}.${entry.key}`).toBeTruthy();
        if (entry.type === "enum") {
          expect(entry.enumValues?.length, `${device.id}.${entry.key}`).toBeGreaterThan(0);
        }
      }
      for (const order of declaration.orders) {
        expect(order.category, `${device.id}.${order.key}`).toBeTruthy();
        if (order.type === "enum") {
          expect(order.enumValues?.length, `${device.id}.${order.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("publishes no configuration noise and no vendor vocabulary", () => {
    for (const device of HOUSE.devices) {
      for (const key of declaredKeys(device, HOUSE)) {
        expect(PROHIBITED_KEYS, `${device.id} publishes ${key}`).not.toContain(key);
      }
    }
  });

  it("gives every device in the house a declaration and a unique identity", () => {
    const ids = HOUSE.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const device of HOUSE.devices) {
      const declaration = declare(device, HOUSE);
      expect(declaration.friendlyName).toBe(device.id);
      expect(declaration.data.length + declaration.orders.length).toBeGreaterThan(0);
    }
  });
});

describe("the categories the core actually keys off", () => {
  it("identifies the thermostat by its setpoint, not by a vendor key", () => {
    // Core spec 177: a device is a thermostat when it can be given a target.
    expect(dataOf("thermostat", "setpoint")?.category).toBe("setpoint");
    expect(orderOf("thermostat", "setpoint")?.category).toBe("set_setpoint");
  });

  it("puts the thermostat's run state under light_state, not under power", () => {
    // Spec 176: the boolean run state binds under the `state` alias. Declaring a
    // boolean under `power` also works, but only because the core rescues that
    // case for a Panasonic that got there first (issue #901).
    expect(dataOf("thermostat", "state")?.category).toBe("light_state");
    expect(dataOf("thermostat", "state")?.type).toBe("boolean");
    expect(declarationOf("thermostat").data.find((d) => d.category === "power")).toBeUndefined();
    expect(orderOf("thermostat", "power")?.category).toBe("toggle_power");
  });

  it("commits to the core's operating-mode vocabulary and nothing else", () => {
    const modes = dataOf("thermostat", "operationMode")?.enumValues ?? [];
    const core = ["auto", "heat", "cool", "dry", "fan", "off"];
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) expect(core).toContain(mode);
    expect(modes).toEqual(SIMULATED_OPERATION_MODES);
  });

  it("keeps brightness on the Zigbee 0–254 scale while #933 is open", () => {
    const order = orderOf("dimmer", "brightness");
    expect(order?.min).toBe(0);
    expect(order?.max).toBe(BRIGHTNESS_MAX);
    expect(BRIGHTNESS_MAX).toBe(254);
  });

  it("keeps appliance_state binary while #936 is open", () => {
    const state = dataOf("metered_appliance", "state");
    expect(state?.category).toBe("appliance_state");
    expect(state?.enumValues).toEqual(APPLIANCE_STATES);
    expect(APPLIANCE_STATES).toHaveLength(2);
  });

  it("declares a relay as a boolean rather than an enum of two strings", () => {
    // Core issue #930: the same relay arriving in two shapes is why eighteen
    // modules downstream defend against both.
    for (const archetype of ["relay", "relay_4ch"] as const) {
      for (const entry of declarationOf(archetype).data) expect(entry.type).toBe("boolean");
      for (const order of declarationOf(archetype).orders) expect(order.type).toBe("boolean");
    }
  });

  it("signs the grid clamp and keeps the energy delta apart from the totals", () => {
    const grid = declarationOf("grid_clamp");
    expect(grid.data.find((d) => d.key === "power")?.category).toBe("power");
    for (const key of ["energy", "energy_forward", "energy_reverse"]) {
      expect(grid.data.find((d) => d.key === key)?.category).toBe("energy");
    }
  });

  it("gives the pool its own categories rather than reusing the house's", () => {
    const pool = declarationOf("pool_heat_pump");
    expect(pool.data.find((d) => d.key === "water_temperature")?.category).toBe(
      "pool_water_temperature",
    );
    expect(pool.orders[0].category).toBe("set_pool_temperature_setpoint");
  });

  it("starts the forecast tomorrow: there is no day 0", () => {
    const keys = declarationOf("forecast").data.map((d) => d.key);
    expect(keys.some((k) => k.startsWith("j0_"))).toBe(false);
    for (const day of [1, 2, 3, 4, 5]) expect(keys).toContain(`j${day}_condition`);
  });

  it("keeps an occupant out of the binding surface", () => {
    // An occupant is not in a zone — it moves between them — so it is not
    // something a person binds to an equipment.
    for (const entry of declarationOf("occupant").data) expect(entry.category).toBe("generic");
    expect(declarationOf("occupant").orders).toEqual([]);
  });

  it("inverts the door contact the way Zigbee does", () => {
    // `contact` is true when the door is SHUT. A door that reads true when open
    // is a door every recipe gets backwards.
    expect(dataOf("contact", "contact")?.category).toBe("contact_door");
    expect(CATALOGUE_DOC).toContain("true-means-**closed**");
  });
});

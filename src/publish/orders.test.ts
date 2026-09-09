import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE } from "../house/house.js";
import type { Logger } from "../sowel-api.js";
import { World } from "../world/world.js";
import { declare } from "./catalogue.js";
import { coerceBoolean, coerceEnum, coerceNumber, DEBOUNCE_MS, OrderRouter } from "./orders.js";

const CONFIG = { latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris", seed: 1789 };
const NOON = Date.parse("2026-06-21T11:00:00Z");

function fakeLogger(): Logger {
  const logger: Logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return logger;
}

function harness(startAt = NOON) {
  const world = new World(CONFIG, HOUSE);
  world.warmUp(startAt);
  const logger = fakeLogger();
  let now = startAt;
  const router = new OrderRouter({ world, logger, house: HOUSE, now: () => now });
  return {
    world,
    logger,
    router,
    advance: (ms: number) => {
      now += ms;
      return world.advance(now);
    },
    at: () => now,
    tick: (ms = 1000) => {
      now += ms;
      return world.advance(now);
    },
  };
}

describe("coercion", () => {
  it("reads a boolean however the wire spells it", () => {
    for (const value of [true, "true", "ON", "on", 1, "1", "yes"]) {
      expect(coerceBoolean(value), String(value)).toBe(true);
    }
    for (const value of [false, "false", "OFF", "off", 0, "0", "no"]) {
      expect(coerceBoolean(value), String(value)).toBe(false);
    }
    expect(coerceBoolean("banana")).toBeUndefined();
    expect(coerceBoolean(null)).toBeUndefined();
  });

  it("clamps a number rather than refusing it", () => {
    expect(coerceNumber("42")).toBe(42);
    expect(coerceNumber(99, 16, 30)).toBe(30);
    expect(coerceNumber(-5, 16, 30)).toBe(16);
    expect(coerceNumber("banana")).toBeUndefined();
  });

  it("matches an enum without caring about case", () => {
    expect(coerceEnum("open", ["OPEN", "CLOSE"])).toBe("OPEN");
    expect(coerceEnum("nope", ["OPEN"])).toBeUndefined();
  });
});

describe("every declared order does something", () => {
  /** Apply one order to a fresh house and say whether the world moved. */
  function applied(deviceId: string, orderKey: string, value: unknown): boolean {
    const { world, router, logger } = harness();
    const before = JSON.stringify(world.advance(NOON).actuators);
    router.execute(deviceId, orderKey, value);
    // Half a second: long enough for a travel to have started, short enough
    // that the gate's own two-second pulse has not released yet.
    const after = JSON.stringify(world.advance(NOON + 500).actuators);
    expect(logger.warn, `${deviceId}.${orderKey}`).not.toHaveBeenCalled();
    return before !== after;
  }

  it("has an effect for each key in the catalogue", () => {
    // AC1 — walk the catalogue rather than trusting a list written by hand. The
    // simulation orders that change no actuator are covered in world.test.ts.
    const elsewhere = ["sim.motion", "sim.open", "sim.close", "sim.enter", "sim.leave"];

    for (const device of HOUSE.devices) {
      for (const order of declare(device, HOUSE).orders) {
        if (elsewhere.includes(order.key) || order.key.startsWith("sim.")) continue;

        if (order.type === "boolean") {
          // Some things start on and some start off, so the order that moves
          // the house is not the same one everywhere. Either must work.
          const moved = applied(device.id, order.key, true) || applied(device.id, order.key, false);
          expect(moved, `${device.id}.${order.key} changed nothing either way`).toBe(true);
          continue;
        }

        const value =
          order.type === "enum"
            ? // The shutters start open, so `OPEN` would legitimately change
              // nothing and the walk would read that as a dead order.
              (order.enumValues ?? []).includes("CLOSE")
              ? "CLOSE"
              : (order.enumValues ?? [])[0]
            : ((order.min ?? 0) + (order.max ?? 100)) / 2;
        expect(
          applied(device.id, order.key, value),
          `${device.id}.${order.key} changed nothing`,
        ).toBe(true);
      }
    }
  });

  it("covers every simulation order somewhere", () => {
    const declared = new Set<string>();
    for (const device of HOUSE.devices) {
      for (const order of declare(device, HOUSE).orders) {
        if (order.key.startsWith("sim.")) declared.add(order.key);
      }
    }
    expect([...declared].sort()).toEqual([
      "sim.close",
      "sim.enter",
      "sim.ghost",
      "sim.leave",
      "sim.motion",
      "sim.open",
      "sim.temperature",
      "sim.weather",
    ]);
  });
});

describe("orders change the world", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("switches a light and echoes it on the reading", () => {
    h.router.execute("sim-light-sejour", "state", true);
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(true);
    h.advance(DEBOUNCE_MS);
    h.router.execute("sim-light-sejour", "state", "OFF");
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(false);
  });

  it("travels a shutter rather than teleporting it", () => {
    h.router.execute("sim-shutter-sejour-sud", "position", 0);
    const positions: number[] = [];
    for (let i = 0; i < 30; i++) {
      positions.push(h.tick().actuators.shutters["sim-shutter-sejour-sud"]);
    }
    expect(positions[0]).toBeLessThan(100);
    expect(positions[0]).toBeGreaterThan(90);
    expect(positions.at(-1)).toBe(0);
  });

  it("stops a shutter where it is, and never debounces the stop", () => {
    h.router.execute("sim-shutter-sejour-sud", "position", 0);
    h.tick(5000);
    // Well inside the debounce window, and it must still be obeyed.
    h.router.execute("sim-shutter-sejour-sud", "state", "STOP");
    const stopped = h.tick().actuators.shutters["sim-shutter-sejour-sud"];
    expect(stopped).toBeGreaterThan(70);
    expect(stopped).toBeLessThan(90);
    expect(h.tick(10_000).actuators.shutters["sim-shutter-sejour-sud"]).toBe(stopped);
  });

  it("lights a dark lamp when a brightness is set on it", () => {
    h.router.execute("sim-dimmer-sejour", "brightness", 200);
    const dimmer = h.tick(2000).actuators.dimmers["sim-dimmer-sejour"];
    expect(dimmer.on).toBe(true);
    expect(dimmer.brightness).toBe(200);
  });

  it("pulses a gate and lets it go on its own", () => {
    h.router.execute("sim-gate", "R1", true);
    expect(h.tick().actuators.gates["sim-gate"]).toBe(true);
    expect(h.tick(3000).actuators.gates["sim-gate"]).toBe(false);
  });

  it("clamps a setpoint instead of refusing it", () => {
    h.router.execute("sim-thermostat-sejour", "setpoint", 99);
    expect(h.tick().actuators.thermostats["sim-thermostat-sejour"].setpointC).toBe(30);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("stops heating a room when its heater relay is opened", () => {
    h.router.execute("sim-heater-bureau", "state", false);
    const state = h.tick(600_000);
    expect(state.actuators.heaters["sim-heater-bureau"]).toBe(false);
    expect(state.rooms.bureau.heatingOn).toBe(false);
  });

  it("moves the meter when the water heater's solar input is closed", () => {
    // AC8 — the third of the four things the energy arbiter needs.
    const before = h.tick();
    h.router.execute("sim-relay-water-heater-solar", "state", true);
    const after = h.tick();
    expect(after.energy.loads["water-heater"]).toBeGreaterThan(500);
    expect(after.energy.gridW - before.energy.gridW).toBeGreaterThan(500);
  });
});

describe("the debounce", () => {
  it("ignores a second order on the same target inside the window", () => {
    const h = harness();
    h.router.execute("sim-light-sejour", "state", true);
    h.advance(500);
    h.router.execute("sim-light-sejour", "state", false);
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(true);
  });

  it("lets the same order through once the window has passed", () => {
    const h = harness();
    h.router.execute("sim-light-sejour", "state", true);
    h.advance(DEBOUNCE_MS + 100);
    h.router.execute("sim-light-sejour", "state", false);
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(false);
  });

  it("never makes two visitors in two rooms contend", () => {
    const h = harness();
    h.router.execute("sim-light-sejour", "state", true);
    h.router.execute("sim-light-cuisine", "state", true);
    const state = h.tick();
    expect(state.actuators.relays["sim-light-sejour"]).toBe(true);
    expect(state.actuators.relays["sim-light-cuisine"]).toBe(true);
  });

  it("keeps two keys on one device apart", () => {
    const h = harness();
    h.router.execute("sim-dimmer-sejour", "state", true);
    h.router.execute("sim-dimmer-sejour", "brightness", 100);
    const dimmer = h.tick(2000).actuators.dimmers["sim-dimmer-sejour"];
    expect(dimmer.on).toBe(true);
    expect(dimmer.brightness).toBe(100);
  });
});

describe("nothing an order can say makes it throw", () => {
  it("shrugs at an unknown device", () => {
    const h = harness();
    expect(() => h.router.execute("sim-nowhere", "state", true)).not.toThrow();
    expect(h.logger.debug).toHaveBeenCalled();
  });

  it("shrugs at a key the device does not declare", () => {
    const h = harness();
    expect(() => h.router.execute("sim-light-sejour", "nanoe", true)).not.toThrow();
  });

  it("warns and changes nothing on a value it cannot read", () => {
    const h = harness();
    h.router.execute("sim-light-sejour", "state", { nope: true });
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(false);
  });

  it("does not let a rejected value start the debounce clock", () => {
    const h = harness();
    h.router.execute("sim-light-sejour", "state", "banana");
    h.router.execute("sim-light-sejour", "state", true);
    expect(h.tick().actuators.relays["sim-light-sejour"]).toBe(true);
  });
});

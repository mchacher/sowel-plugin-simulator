import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE } from "../house/house.js";
import type { DeviceManager, DiscoveredDevice, Logger } from "../sowel-api.js";
import { World } from "../world/world.js";
import { Publisher } from "./publisher.js";

const CONFIG = { latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris", seed: 1789 };
const NOON = Date.parse("2026-07-15T11:00:00Z");

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

function harness() {
  const declared: DiscoveredDevice[] = [];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const statuses: { id: string; status: string }[] = [];
  const deviceManager: DeviceManager = {
    upsertFromDiscovery: (_id, _source, discovered) => declared.push(discovered),
    updateDeviceData: (_id, sourceDeviceId, payload) =>
      updates.push({ id: sourceDeviceId, payload }),
    updateDeviceStatus: (_id, sourceDeviceId, status) =>
      statuses.push({ id: sourceDeviceId, status }),
    removeStaleDevices: vi.fn(),
    logSummary: vi.fn(),
  };
  const logger = fakeLogger();
  const publisher = new Publisher({
    deviceManager,
    logger,
    integrationId: "simulator",
    house: HOUSE,
    seed: CONFIG.seed,
  });
  return { declared, updates, statuses, publisher, logger };
}

describe("the house is alive at t = 0", () => {
  it("declares every device, then gives every one of them a value, before any tick", () => {
    const { declared, updates, publisher } = harness();
    const world = new World(CONFIG, HOUSE);

    publisher.declareAll();
    expect(declared).toHaveLength(HOUSE.devices.length);

    world.warmUp(NOON);
    publisher.publish(world.advance(NOON), true);

    const withValues = new Set(updates.map((u) => u.id));
    for (const device of HOUSE.devices) {
      expect(withValues, `${device.id} opened empty`).toContain(device.id);
    }
  });

  it("declares nothing twice", () => {
    const { declared, publisher } = harness();
    publisher.declareAll();
    const names = declared.map((d) => d.friendlyName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("what goes on the wire", () => {
  let world: World;

  beforeEach(() => {
    world = new World(CONFIG, HOUSE);
    world.warmUp(NOON);
  });

  it("says nothing about a reading that has not moved and is not due", () => {
    const { updates, publisher } = harness();
    publisher.publish(world.advance(NOON), true);
    const afterFirst = updates.length;
    // One second later, almost nothing has changed by more than its threshold.
    publisher.publish(world.advance(NOON + 1000));
    expect(updates.length - afterFirst).toBeLessThan(afterFirst / 4);
  });

  it("republishes a quiet reading once its heartbeat has elapsed", () => {
    const { updates, publisher } = harness();
    publisher.publish(world.advance(NOON), true);
    const afterFirst = updates.length;
    publisher.publish(world.advance(NOON + 6 * 60_000));
    const republished = updates.slice(afterFirst).map((u) => u.id);
    expect(republished.length).toBeGreaterThan(0);
    expect(republished).toContain("sim-th-sejour");
  });

  it("carries the grid clamp as soon as it moves, which is what the arbiter reads", () => {
    const { updates, publisher } = harness();
    publisher.publish(world.advance(NOON), true);
    const before = updates.length;
    // Switching a load moves the grid within one tick (core spec 140 smooths it
    // over 60 s, so it has to be able to see the change).
    world.actuatorStates.relays["sim-relay-water-heater-solar"] = true;
    publisher.publish(world.advance(NOON + 1000));
    const grid = updates.slice(before).find((u) => u.id === "sim-grid");
    expect(grid).toBeDefined();
    expect(typeof grid?.payload.power).toBe("number");
  });

  it("refuses an undeclared key rather than sending it", () => {
    const { publisher, logger, updates } = harness();
    publisher.publish(world.advance(NOON), true);
    // `valuesFor` is the only producer, so reach the gate the way a bug would.
    const before = updates.length;
    (publisher as unknown as { gate: (...args: unknown[]) => Record<string, unknown> }).gate(
      "sim-th-sejour",
      { linkquality: 42, nanoe: true, temperature: 21 },
      NOON + 600_000,
      false,
    );
    expect(logger.warn).toHaveBeenCalled();
    expect(updates.length).toBe(before);
  });

  it("takes the PV inverter offline at night and back online at sunrise", () => {
    const { statuses, publisher } = harness();
    const night = new World(CONFIG, HOUSE);
    const nightTs = Date.parse("2026-07-15T23:30:00Z");
    night.warmUp(nightTs);
    publisher.publish(night.advance(nightTs), true);
    expect(statuses.at(-1)).toEqual({ id: "sim-pv", status: "offline" });

    const day = new World(CONFIG, HOUSE);
    day.warmUp(NOON);
    publisher.publish(day.advance(NOON));
    expect(statuses.at(-1)).toEqual({ id: "sim-pv", status: "online" });
  });

  it("says nothing at all for an offline inverter, rather than repeating a zero", () => {
    const { updates, publisher } = harness();
    const night = new World(CONFIG, HOUSE);
    const nightTs = Date.parse("2026-07-15T23:30:00Z");
    night.warmUp(nightTs);

    // It still opens with a value: an empty card is not "alive at t = 0".
    publisher.publish(night.advance(nightTs), true);
    expect(updates.some((u) => u.id === "sim-pv")).toBe(true);

    // But after that it is silent, because `updateDeviceData` marks a device
    // online again and a heartbeat would resurrect it a minute after sunset.
    const before = updates.length;
    for (let minute = 1; minute <= 10; minute++) {
      publisher.publish(night.advance(nightTs + minute * 60_000));
    }
    expect(updates.slice(before).some((u) => u.id === "sim-pv")).toBe(false);
  });

  it("does not repeat a status that has not changed", () => {
    const { statuses, publisher } = harness();
    publisher.publish(world.advance(NOON), true);
    publisher.publish(world.advance(NOON + 1000));
    publisher.publish(world.advance(NOON + 2000));
    expect(statuses).toHaveLength(1);
  });

  it("reports energy as a delta and the totals as totals", () => {
    const { updates, publisher } = harness();
    publisher.publish(world.advance(NOON), true);
    const first = updates.find((u) => u.id === "sim-grid")?.payload;
    expect(first?.energy).toBe(0);

    const before = updates.length;
    publisher.publish(world.advance(NOON + 120_000));
    const second = updates.slice(before).find((u) => u.id === "sim-grid")?.payload;
    expect(second?.energy).toBeTypeOf("number");
    expect(second?.energy as number).toBeGreaterThanOrEqual(0);
    expect(second?.energy_forward as number).toBeGreaterThanOrEqual(
      first?.energy_forward as number,
    );
  });
});

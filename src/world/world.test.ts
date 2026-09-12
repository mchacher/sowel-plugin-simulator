import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import { World, type WorldConfig } from "./world.js";

const CONFIG: WorldConfig = {
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: "Europe/Paris",
  seed: 1789,
};

const at = (iso: string) => {
  const world = new World(CONFIG, HOUSE);
  return world.advance(Date.parse(iso));
};

describe("the house reconstructs itself from the clock", () => {
  it("is warm at three in the afternoon, not cold from a fresh start", () => {
    const state = at("2026-01-15T14:00:00Z");
    expect(state.rooms.sejour.temperatureC).toBeGreaterThan(19);
    expect(state.rooms.sejour.temperatureC).toBeLessThan(23);
    // And the counters carry the day so far rather than starting at zero.
    expect(state.energy.counters.importedWh).toBeGreaterThan(0);
  });

  it("gives the same instant the same house, twice", () => {
    expect(at("2026-07-15T11:00:00Z")).toEqual(at("2026-07-15T11:00:00Z"));
  });

  it("bridges a small gap by stepping and a large one by rebuilding", () => {
    const stepped = new World(CONFIG, HOUSE);
    const base = Date.parse("2026-07-15T11:00:00Z");
    stepped.advance(base);
    for (let i = 1; i <= 60; i++) stepped.advance(base + i * 1000);
    const rebuilt = at("2026-07-15T11:01:00Z");
    expect(stepped.advance(base + 60_000).rooms.sejour.temperatureC).toBeCloseTo(
      rebuilt.rooms.sejour.temperatureC,
      1,
    );
  });

  it("keeps the day's totals monotonic across a restart", () => {
    const morning = at("2026-07-15T09:00:00Z").energy.counters;
    const afternoon = at("2026-07-15T15:00:00Z").energy.counters;
    expect(afternoon.importedWh).toBeGreaterThanOrEqual(morning.importedWh);
    expect(afternoon.producedWh).toBeGreaterThan(morning.producedWh);
  });

  it("starts a new local day with fresh counters", () => {
    const world = new World(CONFIG, HOUSE);
    const beforeMidnight = Date.parse("2026-07-15T21:50:00Z");
    const before = world.advance(beforeMidnight).energy.counters.importedWh;
    const after = world.advance(beforeMidnight + 20 * 60_000).energy.counters.importedWh;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });
});

describe("what the house looks like", () => {
  it("reports motion where the household actually is, and holds it briefly after", () => {
    const night = at("2026-07-15T01:00:00Z");
    expect(night.rooms["chambre-parents"].occupants).toBe(2);
    expect(night.rooms.sejour.occupants).toBe(0);
    expect(night.rooms.sejour.occupied).toBe(false);
  });

  it("keeps its doors shut except when someone goes through them", () => {
    const night = at("2026-07-15T01:00:00Z");
    for (const closed of Object.values(night.contactsClosed)) expect(closed).toBe(true);
  });

  it("balances the meter at every tick, and exports at midday in summer", () => {
    const world = new World(CONFIG, HOUSE);
    const base = Date.parse("2026-06-21T09:00:00Z");
    let sawExport = false;
    for (let minute = 0; minute < 240; minute += 5) {
      const state = world.advance(base + minute * 60_000);
      expect(state.energy.gridW).toBeCloseTo(state.energy.loadW - state.energy.productionW, 6);
      if (state.energy.gridW < 0) sawExport = true;
    }
    expect(sawExport).toBe(true);
  });

  it("produces nothing at night and marks the inverter offline", () => {
    const night = at("2026-07-15T23:30:00Z");
    expect(night.energy.productionW).toBe(0);
    expect(night.energy.inverterOffline).toBe(true);
    expect(at("2026-07-15T11:00:00Z").energy.inverterOffline).toBe(false);
  });

  it("leaves the water tank depleted through the sunny part of the day", () => {
    // This is what gives the energy arbiter something worth granting: with a
    // daily quota met overnight, a surplus charge would have nothing to do.
    const midday = at("2026-07-15T11:00:00Z");
    expect(midday.waterHeater.temperatureC).toBeLessThan(52);
    expect(midday.energy.loads["water-heater"]).toBe(0);
  });

  it("draws the water heater on its solar input, and the meter moves with it", () => {
    const world = new World(CONFIG, HOUSE);
    const base = Date.parse("2026-06-21T11:00:00Z");
    const before = world.advance(base);
    world.actuatorStates.relays["sim-relay-water-heater-solar"] = true;
    const after = world.advance(base + 60_000);

    expect(after.energy.loads["water-heater"]).toBeGreaterThan(500);
    expect(after.energy.gridW - before.energy.gridW).toBeGreaterThan(500);
    expect(after.waterHeater.heating).toBe(true);
  });

  it("meters every flexible load separately, which is what the arbiter reserves", () => {
    const state = at("2026-06-21T11:00:00Z");
    for (const load of HOUSE.loads.filter((l) => l.arbiterClass === "deferrable")) {
      expect(state.energy.loads[load.id]).toBeTypeOf("number");
      const clamp = HOUSE.devices.find(
        (d) => d.archetype === "subload_clamp" && d.load === load.id,
      );
      expect(clamp, `${load.id} has no clamp`).toBeDefined();
      const relay = HOUSE.devices.find((d) => d.archetype === "relay" && d.load === load.id);
      const own = HOUSE.devices.find((d) => d.archetype === "pool_heat_pump" && d.load === load.id);
      expect(relay ?? own, `${load.id} cannot be switched`).toBeDefined();
    }
  });

  it("leaves the pool pump alone until something closes its relay", () => {
    // The simulator schedules nothing: the pump's hours are a recipe's, and the
    // arbiter may claim it. A simulator that ran it on its own would look to
    // spec 140 like a hand on a wall switch, and the arbiter would suspend
    // itself on that load — which it did, on a real instance.
    const world = new World(CONFIG, HOUSE);
    const midday = Date.parse("2026-06-21T11:30:00Z");
    world.warmUp(midday);
    expect(world.advance(midday).energy.loads["pool-pump"]).toBe(0);

    world.setRelay("sim-relay-pool-pump", true);
    const running = world.advance(midday + 1000);
    expect(running.energy.loads["pool-pump"]).toBeGreaterThan(0);
    // And the water is where twelve days of reconstructed history put it.
    expect(running.pool.waterTemperatureC).toBeGreaterThan(15);
  });

  it("cannot heat the pool while its pump is off", () => {
    // A pool heat pump is interlocked on flow. Granting it surplus without the
    // pump would buy nothing, which is why the pump sits above it in the
    // arbiter's priority list.
    const world = new World(CONFIG, HOUSE);
    const midday = Date.parse("2026-06-21T11:30:00Z");
    world.warmUp(midday);
    expect(world.advance(midday).pool.heatPumpOn).toBe(false);
    expect(world.advance(midday).energy.loads["pool-heat-pump"]).toBe(0);
  });

  it("keeps every room habitable all year", () => {
    for (const iso of ["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]) {
      const state = at(`${iso}T14:00:00Z`);
      for (const room of HOUSE.rooms) {
        if (room.outdoor || room.heating === "none") continue;
        const temperature = state.rooms[room.id].temperatureC;
        expect(temperature, `${room.id} on ${iso}`).toBeGreaterThan(16);
        expect(temperature, `${room.id} on ${iso}`).toBeLessThan(30);
      }
    }
  });

  it("gives the forecast five days starting tomorrow", () => {
    expect(at("2026-07-15T11:00:00Z").forecast.map((d) => d.index)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("a motorised gate", () => {
  it("opens on a pulse, closes on the next, and closes itself in time", () => {
    const world = new World(CONFIG, HOUSE);
    let now = Date.parse("2026-06-15T10:00:00Z");
    world.advance(now);
    // Stepped a second at a time: a jump of minutes is a rebuild, which forgets
    // every door on purpose.
    const after = (seconds: number) => {
      let state = world.advance(now);
      for (let i = 0; i < seconds; i++) state = world.advance((now += 1000));
      return state.contactsClosed["sim-contact-portail"];
    };
    expect(after(1)).toBe(true);

    world.pulseGate("sim-gate-1", now);
    expect(after(2)).toBe(false);
    // Ninety seconds later it has shut itself.
    expect(after(95)).toBe(true);

    // Pulsed while open: it shuts.
    world.pulseGate("sim-gate-1", now);
    expect(after(2)).toBe(false);
    world.pulseGate("sim-gate-1", now);
    expect(after(2)).toBe(true);
  });
});

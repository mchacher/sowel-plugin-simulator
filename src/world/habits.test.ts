import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import { Habits, poolPumpHabit } from "./habits.js";
import { World, type WorldConfig } from "./world.js";

const CONFIG: WorldConfig = {
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: "Europe/Paris",
  seed: 1789,
};

function run(fromIso: string, toIso: string) {
  const world = new World(CONFIG, HOUSE);
  const habits = new Habits(HOUSE, CONFIG.timezone);
  for (let ts = Date.parse(fromIso); ts <= Date.parse(toIso); ts += 60_000) {
    habits.apply(world, world.advance(ts));
  }
  return { world, state: world.advance(Date.parse(toIso) + 60_000) };
}

describe("habits — what the past assumes Sowel did", () => {
  it("runs the pool pump on its schedule's hours", () => {
    expect(poolPumpHabit(12 * 60)).toBe(true);
    expect(poolPumpHabit(6 * 60)).toBe(false);
    expect(poolPumpHabit(20 * 60)).toBe(false);
  });

  it("opens the shutters by day and closes them at night", () => {
    const shutters = HOUSE.devices.filter((d) => d.archetype === "shutter").map((d) => d.id);
    const noon = run("2026-09-20T09:00:00Z", "2026-09-20T10:30:00Z");
    for (const id of shutters) expect(noon.world.actuatorStates.shutters[id]).toBe(100);
    const night = run("2026-09-20T19:00:00Z", "2026-09-20T21:30:00Z");
    for (const id of shutters) expect(night.world.actuatorStates.shutters[id]).toBe(0);
  });

  it("lights a room somebody is awake in, after dark, and no other", () => {
    const { world, state } = run("2026-09-20T18:00:00Z", "2026-09-20T19:30:00Z");
    const awake = new Set(
      state.occupants.filter((o) => o.present && !o.asleep).map((o) => o.place),
    );
    const lamps = HOUSE.devices.filter((d) => d.archetype === "relay" && !d.load && d.room);
    expect(lamps.length).toBeGreaterThan(0);
    for (const lamp of lamps) {
      expect(world.actuatorStates.relays[lamp.id], lamp.id).toBe(awake.has(lamp.room ?? ""));
    }
  });

  it("switches the pool pump on at eleven and off at three, local time", () => {
    const pump = HOUSE.devices.find((d) => d.archetype === "relay" && d.load === "pool-pump");
    expect(pump).toBeDefined();
    const on = run("2026-09-20T09:30:00Z", "2026-09-20T10:00:00Z");
    expect(on.world.actuatorStates.relays[pump?.id ?? ""]).toBe(true);
    const off = run("2026-09-20T13:30:00Z", "2026-09-20T14:00:00Z");
    expect(off.world.actuatorStates.relays[pump?.id ?? ""]).toBe(false);
  });
});

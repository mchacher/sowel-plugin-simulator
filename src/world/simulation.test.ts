import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import { GHOST_TTL_MS } from "./ghosts.js";
import { AWAY } from "./occupants.js";
import { World, type WorldConfig } from "./world.js";

const CONFIG: WorldConfig = {
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: "Europe/Paris",
  seed: 1789,
};
/** A weekday at 11:00 local, when the house is empty. */
const EMPTY_HOUSE = Date.parse("2026-06-22T09:00:00Z");

function world(at = EMPTY_HOUSE) {
  const w = new World(CONFIG, HOUSE);
  w.warmUp(at);
  return w;
}

describe("a visitor makes presence", () => {
  it("lights a sensor with sim.motion, and it clears on its own", () => {
    const w = world();
    expect(w.advance(EMPTY_HOUSE).rooms.sejour.occupied).toBe(false);

    w.simMotion("sim-motion-lux-sejour-1", EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + 1000).rooms.sejour.occupied).toBe(true);
    expect(w.advance(EMPTY_HOUSE + 30_000).rooms.sejour.occupied).toBe(true);
    expect(w.advance(EMPTY_HOUSE + 120_000).rooms.sejour.occupied).toBe(false);
  });

  it("counts a ghost as a person, not just as a sensor reading", () => {
    const w = world();
    const before = w.advance(EMPTY_HOUSE);
    expect(before.rooms.sejour.occupants).toBe(0);

    w.simGhost("visitor", "sejour", EMPTY_HOUSE);
    const after = w.advance(EMPTY_HOUSE + 1000);
    expect(after.rooms.sejour.occupants).toBe(1);
    expect(after.rooms.sejour.occupied).toBe(true);
    expect(after.ghostCount).toBe(1);
  });

  it("lets a ghost breathe and warm the room it is in", () => {
    const empty = world();
    const haunted = world();
    for (let minute = 0; minute < 45; minute++) {
      const ts = EMPTY_HOUSE + minute * 60_000;
      haunted.simGhost("visitor", "sejour", ts);
      empty.advance(ts);
      haunted.advance(ts);
    }
    const a = empty.advance(EMPTY_HOUSE + 45 * 60_000).rooms.sejour;
    const b = haunted.advance(EMPTY_HOUSE + 45 * 60_000).rooms.sejour;
    expect(b.co2Ppm).toBeGreaterThan(a.co2Ppm + 100);
    expect(b.temperatureC).toBeGreaterThan(a.temperatureC);
  });

  it("forgets a ghost two minutes after the last click", () => {
    const w = world();
    w.simGhost("visitor", "sejour", EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + GHOST_TTL_MS - 1000).ghostCount).toBe(1);
    expect(w.advance(EMPTY_HOUSE + GHOST_TTL_MS + 1000).ghostCount).toBe(0);
  });

  it("refuses a room the house does not have", () => {
    const w = world();
    expect(w.simGhost("visitor", "donjon", EMPTY_HOUSE)).toBe(false);
    expect(w.advance(EMPTY_HOUSE + 1000).ghostCount).toBe(0);
  });

  it("never publishes a ghost as one of the household", () => {
    const w = world();
    w.simGhost("visitor", "sejour", EMPTY_HOUSE);
    const state = w.advance(EMPTY_HOUSE + 1000);
    expect(state.occupants).toHaveLength(HOUSE.occupants.length);
    expect(state.occupants.every((o) => !o.present)).toBe(true);
  });
});

describe("a visitor opens a door", () => {
  it("opens it and lets it close on its own", () => {
    const w = world();
    expect(w.advance(EMPTY_HOUSE).contactsClosed["sim-contact-entree"]).toBe(true);
    w.simDoor("sim-contact-entree", true, EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + 1000).contactsClosed["sim-contact-entree"]).toBe(false);
    expect(w.advance(EMPTY_HOUSE + 20_000).contactsClosed["sim-contact-entree"]).toBe(true);
  });

  it("shuts it now when asked to", () => {
    const w = world();
    w.simDoor("sim-contact-entree", true, EMPTY_HOUSE);
    w.advance(EMPTY_HOUSE + 1000);
    w.simDoor("sim-contact-entree", false, EMPTY_HOUSE + 1000);
    expect(w.advance(EMPTY_HOUSE + 2000).contactsClosed["sim-contact-entree"]).toBe(true);
  });
});

describe("a visitor changes the weather", () => {
  it("forces the sky, and the production follows it", () => {
    const clear = world();
    clear.simWeather("sunny", EMPTY_HOUSE);
    const bright = clear.advance(EMPTY_HOUSE + 1000);

    const dull = world();
    dull.simWeather("stormy", EMPTY_HOUSE);
    const dark = dull.advance(EMPTY_HOUSE + 1000);

    expect(bright.weather.condition).toBe("sunny");
    expect(dark.weather.condition).toBe("stormy");
    // A forced sky that did not change the production would be a picture.
    expect(bright.energy.productionW).toBeGreaterThan(dark.energy.productionW * 2);
    expect(bright.weather.cloudFactor).toBeGreaterThan(dark.weather.cloudFactor);
  });

  it("leaves the forecast alone: tomorrow is not a visitor's to decide", () => {
    const w = world();
    const before = w.advance(EMPTY_HOUSE).forecast.map((d) => d.condition);
    w.simWeather("stormy", EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + 1000).forecast.map((d) => d.condition)).toEqual(before);
  });
});

describe("a visitor nudges a room", () => {
  it("moves it, and the model brings it back on its own", () => {
    const w = world();
    const before = w.advance(EMPTY_HOUSE).rooms.sejour.temperatureC;
    expect(w.simTemperature("sejour", before + 6)).toBe(true);

    const nudged = w.advance(EMPTY_HOUSE + 1000).rooms.sejour.temperatureC;
    expect(nudged).toBeGreaterThan(before + 5);

    // Nothing is held: the thermal model takes it from there, which is the
    // demonstration.
    const later = w.advance(EMPTY_HOUSE + 6 * 3_600_000).rooms.sejour.temperatureC;
    expect(later).toBeLessThan(nudged);
  });

  it("shrugs at a room that is not in the house", () => {
    expect(world().simTemperature("donjon", 25)).toBe(false);
  });
});

describe("a visitor sends someone home", () => {
  it("brings an absent occupant back and takes a present one out", () => {
    const w = world();
    expect(w.advance(EMPTY_HOUSE).occupants.every((o) => !o.present)).toBe(true);

    expect(w.simOccupant("adulte-1", true, EMPTY_HOUSE)).toBe(true);
    const home = w.advance(EMPTY_HOUSE + 1000).occupants.find((o) => o.id === "adulte-1");
    expect(home?.present).toBe(true);
    expect(home?.place).not.toBe(AWAY);

    w.simOccupant("adulte-1", false, EMPTY_HOUSE + 1000);
    const gone = w.advance(EMPTY_HOUSE + 2000).occupants.find((o) => o.id === "adulte-1");
    expect(gone?.present).toBe(false);
  });

  it("opens the entrance on the way through", () => {
    const w = world();
    w.advance(EMPTY_HOUSE);
    w.simOccupant("adulte-1", true, EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + 1000).contactsClosed["sim-contact-entree"]).toBe(false);
  });

  it("shrugs at someone who does not live here", () => {
    expect(world().simOccupant("nobody", true, EMPTY_HOUSE)).toBe(false);
  });

  it("lets the agenda take over again the next day", () => {
    const w = world();
    w.simOccupant("adulte-1", true, EMPTY_HOUSE);
    expect(w.advance(EMPTY_HOUSE + 1000).occupants.find((o) => o.id === "adulte-1")?.present).toBe(
      true,
    );
    // The next weekday at the same hour, the house is empty again.
    const tomorrow = EMPTY_HOUSE + 86_400_000;
    expect(w.advance(tomorrow).occupants.find((o) => o.id === "adulte-1")?.present).toBe(false);
  });
});

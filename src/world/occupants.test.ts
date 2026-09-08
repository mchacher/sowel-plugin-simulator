import { describe, expect, it } from "vitest";
import { HOUSE } from "../house/house.js";
import { localMidnight } from "./clock.js";
import { AWAY, isCooking, occupancyByRoom, occupantsAt } from "./occupants.js";

const TZ = "Europe/Paris";
const SEED = 1789;

/** 2026-06-22 is a Monday, 2026-06-24 a Wednesday, 2026-06-27 a Saturday. */
const MONDAY = localMidnight(Date.parse("2026-06-22T12:00:00Z"), TZ);
const WEDNESDAY = localMidnight(Date.parse("2026-06-24T12:00:00Z"), TZ);
const SATURDAY = localMidnight(Date.parse("2026-06-27T12:00:00Z"), TZ);

const at = (midnight: number, minutes: number) =>
  occupantsAt(midnight + minutes * 60_000, TZ, HOUSE, SEED);

describe("the household", () => {
  it("sleeps in its own bedrooms overnight", () => {
    const night = at(MONDAY, 3 * 60);
    expect(night.every((o) => o.asleep)).toBe(true);
    for (const occupant of night) {
      const spec = HOUSE.occupants.find((o) => o.id === occupant.id);
      expect(occupant.place).toBe(spec?.bedroom);
    }
  });

  it("empties the house on a weekday morning and fills it again in the evening", () => {
    expect(at(MONDAY, 11 * 60).filter((o) => o.present)).toHaveLength(0);
    expect(at(MONDAY, 20 * 60).filter((o) => o.present)).toHaveLength(HOUSE.occupants.length);
  });

  it("leaves everyone through the entrance", () => {
    // Someone stands in the entrance in the minutes around every departure.
    let seen = false;
    for (let minutes = 7 * 60; minutes < 9 * 60; minutes += 1) {
      if (at(MONDAY, minutes).some((o) => o.place === "entree")) seen = true;
    }
    expect(seen).toBe(true);
  });

  it("keeps the adult who works from home in the study on their day", () => {
    const wednesday = at(WEDNESDAY, 14 * 60).find((o) => o.id === "adulte-2");
    expect(wednesday?.place).toBe("bureau");
    const monday = at(MONDAY, 14 * 60).find((o) => o.id === "adulte-2");
    expect(monday?.place).toBe(AWAY);
  });

  it("does not send anyone to work on a Saturday", () => {
    for (let minutes = 0; minutes < 1440; minutes += 20) {
      expect(at(SATURDAY, minutes).every((o) => o.present)).toBe(true);
    }
  });

  it("gets up later at the weekend", () => {
    const weekdayUp = at(MONDAY, 7 * 60 + 30).filter((o) => !o.asleep).length;
    const weekendUp = at(SATURDAY, 7 * 60 + 30).filter((o) => !o.asleep).length;
    expect(weekendUp).toBeLessThan(weekdayUp);
  });

  it("replays the same day identically", () => {
    expect(at(MONDAY, 8 * 60 + 5)).toEqual(at(MONDAY, 8 * 60 + 5));
  });

  it("varies from one day to the next without changing the shape of the day", () => {
    const nextMonday = MONDAY + 7 * 86_400_000;
    const departures = (midnight: number) => {
      for (let minutes = 6 * 60; minutes < 12 * 60; minutes++) {
        const adult = occupantsAt(midnight + minutes * 60_000, TZ, HOUSE, SEED).find(
          (o) => o.id === "adulte-1",
        );
        if (adult?.place === AWAY) return minutes;
      }
      return -1;
    };
    const first = departures(MONDAY);
    const second = departures(nextMonday);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    expect(first).not.toBe(second);
    expect(Math.abs(first - second)).toBeLessThan(40);
  });

  it("counts people per room", () => {
    const counts = occupancyByRoom(at(MONDAY, 3 * 60));
    expect(counts.get("chambre-parents")).toBe(2);
    expect(counts.get("chambre-1")).toBe(1);
    expect(counts.get(AWAY)).toBeUndefined();
  });

  it("cooks before dinner and not after", () => {
    expect(isCooking(MONDAY + 19 * 60 * 60_000, TZ)).toBe(true);
    expect(isCooking(MONDAY + 21 * 60 * 60_000, TZ)).toBe(false);
  });
});

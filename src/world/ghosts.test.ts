import { describe, expect, it } from "vitest";
import { GHOST_LIMIT, GHOST_TTL_MS, Ghosts, parseGhostTarget } from "./ghosts.js";

const ROOMS = new Set(["sejour", "cuisine", "bureau"]);
const T0 = 1_000_000;

describe("a ghost", () => {
  it("counts as a person in the room it was placed in", () => {
    const ghosts = new Ghosts();
    expect(ghosts.place("visitor", "sejour", T0, ROOMS)).toBe(true);
    expect(ghosts.byRoom(T0).get("sejour")).toBe(1);
    expect(ghosts.count(T0)).toBe(1);
  });

  it("moves rather than multiplying when the same id is placed again", () => {
    const ghosts = new Ghosts();
    ghosts.place("g7", "sejour", T0, ROOMS);
    ghosts.place("g7", "cuisine", T0 + 1000, ROOMS);
    expect(ghosts.count(T0 + 1000)).toBe(1);
    expect(ghosts.byRoom(T0 + 1000).get("cuisine")).toBe(1);
    expect(ghosts.byRoom(T0 + 1000).get("sejour")).toBeUndefined();
  });

  it("is gone two minutes after its last order", () => {
    const ghosts = new Ghosts();
    ghosts.place("visitor", "sejour", T0, ROOMS);
    expect(ghosts.count(T0 + GHOST_TTL_MS - 1000)).toBe(1);
    expect(ghosts.count(T0 + GHOST_TTL_MS)).toBe(0);
  });

  it("stays as long as the visitor keeps clicking", () => {
    const ghosts = new Ghosts();
    let now = T0;
    for (let i = 0; i < 20; i++) {
      ghosts.place("visitor", "sejour", now, ROOMS);
      now += GHOST_TTL_MS - 5000;
    }
    expect(ghosts.count(now)).toBe(1);
  });

  it("drops the oldest at the limit, never refuses the newest", () => {
    const ghosts = new Ghosts();
    for (let i = 0; i < GHOST_LIMIT; i++) ghosts.place(`g${i}`, "sejour", T0 + i, ROOMS);
    expect(ghosts.count(T0 + GHOST_LIMIT)).toBe(GHOST_LIMIT);

    expect(ghosts.place("newcomer", "cuisine", T0 + 100, ROOMS)).toBe(true);
    const ids = ghosts.list(T0 + 100).map((g) => g.id);
    expect(ids).toContain("newcomer");
    expect(ids).not.toContain("g0");
    expect(ids).toHaveLength(GHOST_LIMIT);
  });

  it("refuses a room the house does not have", () => {
    const ghosts = new Ghosts();
    expect(ghosts.place("visitor", "donjon", T0, ROOMS)).toBe(false);
    expect(ghosts.count(T0)).toBe(0);
  });
});

describe("addressing a ghost", () => {
  it("takes a bare room as the default visitor", () => {
    expect(parseGhostTarget("sejour")).toEqual({ id: "visitor", room: "sejour" });
  });

  it("takes id:room so two visitors do not fight over one", () => {
    expect(parseGhostTarget("g7:cuisine")).toEqual({ id: "g7", room: "cuisine" });
    expect(parseGhostTarget("  g7 : cuisine ")).toEqual({ id: "g7", room: "cuisine" });
  });

  it("refuses what it cannot read", () => {
    expect(parseGhostTarget("")).toBeNull();
    expect(parseGhostTarget("  ")).toBeNull();
    expect(parseGhostTarget(":sejour")).toBeNull();
    expect(parseGhostTarget("g7:")).toBeNull();
  });
});

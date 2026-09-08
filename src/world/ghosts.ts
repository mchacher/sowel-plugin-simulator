/**
 * Ephemeral presence (spec 002, FR4).
 *
 * A ghost is a visitor's own presence: an occupant that exists because someone
 * clicked, walks where told, and disappears when they stop. It counts as a person
 * for motion, CO₂ and thermal gain, because otherwise clicking a room would light
 * up a sensor and change nothing else, which is a puppet rather than a house.
 *
 * Ghosts are **not** the household. They are never published as occupant devices:
 * the household is four people on an agenda, and a visitor is not one of them.
 */

/** How long a ghost survives without a new order. */
export const GHOST_TTL_MS = 120_000;
/** How many may exist at once. */
export const GHOST_LIMIT = 10;

export interface Ghost {
  id: string;
  room: string;
  lastSeenAt: number;
}

/** `"sejour"` addresses the default ghost; `"g7:sejour"` addresses ghost `g7`. */
export function parseGhostTarget(value: string): { id: string; room: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(":");
  if (separator < 0) return { id: "visitor", room: trimmed };
  const id = trimmed.slice(0, separator).trim();
  const room = trimmed.slice(separator + 1).trim();
  if (!id || !room) return null;
  return { id, room };
}

export class Ghosts {
  private readonly ghosts = new Map<string, Ghost>();

  /**
   * Place or move a ghost. Returns false when the room is not one of `rooms`.
   *
   * At the limit the **oldest** ghost is dropped, not the newest refused: a
   * visitor who has just arrived should not be the one told no.
   */
  place(id: string, room: string, now: number, rooms: ReadonlySet<string>): boolean {
    if (!rooms.has(room)) return false;
    this.expire(now);
    if (!this.ghosts.has(id) && this.ghosts.size >= GHOST_LIMIT) {
      const oldest = [...this.ghosts.values()].reduce((a, b) =>
        a.lastSeenAt <= b.lastSeenAt ? a : b,
      );
      this.ghosts.delete(oldest.id);
    }
    this.ghosts.set(id, { id, room, lastSeenAt: now });
    return true;
  }

  expire(now: number): void {
    for (const [id, ghost] of this.ghosts) {
      if (now - ghost.lastSeenAt >= GHOST_TTL_MS) this.ghosts.delete(id);
    }
  }

  /** How many ghosts are in each room, after expiry. */
  byRoom(now: number): Map<string, number> {
    this.expire(now);
    const counts = new Map<string, number>();
    for (const ghost of this.ghosts.values()) {
      counts.set(ghost.room, (counts.get(ghost.room) ?? 0) + 1);
    }
    return counts;
  }

  count(now: number): number {
    this.expire(now);
    return this.ghosts.size;
  }

  list(now: number): Ghost[] {
    this.expire(now);
    return [...this.ghosts.values()];
  }

  clear(): void {
    this.ghosts.clear();
  }
}

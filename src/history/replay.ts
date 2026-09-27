/**
 * The house's past, replayed (spec 004, FR1 and FR2).
 *
 * The same `World` and the same `Publisher` the plugin runs live, stepped a minute
 * at a time, with habits standing in for Sowel. The publisher's device manager is a
 * capture: every reading it would have sent, with the minute it was sent at.
 */

import { HOUSE } from "../house/house.js";
import type { House } from "../house/types.js";
import { Publisher } from "../publish/publisher.js";
import type { DeviceManager, Logger } from "../sowel-api.js";
import { Habits } from "../world/habits.js";
import { World, type WorldConfig } from "../world/world.js";

export interface Reading {
  /** Epoch milliseconds. */
  ts: number;
  deviceId: string;
  key: string;
  value: unknown;
}

const STEP_MS = 60_000;

const silent: Logger = {
  child: () => silent,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

export function replay(options: {
  config: WorldConfig;
  house?: House;
  /** Epoch ms, inclusive; stepped from the minute it falls in. */
  from: number;
  /** Epoch ms, exclusive. */
  until: number;
  onReading: (reading: Reading) => void;
  /** After each minute's readings. */
  onStep?: (ts: number) => void;
}): void {
  const house = options.house ?? HOUSE;
  let now = Math.floor(options.from / STEP_MS) * STEP_MS;
  const deviceManager: DeviceManager = {
    upsertFromDiscovery: () => undefined,
    updateDeviceData: (
      _integrationId: string,
      deviceId: string,
      payload: Record<string, unknown>,
    ) => {
      for (const [key, value] of Object.entries(payload)) {
        options.onReading({ ts: now, deviceId, key, value });
      }
    },
    updateDeviceStatus: () => undefined,
    removeStaleDevices: () => undefined,
    logSummary: () => undefined,
  } as unknown as DeviceManager;

  const world = new World(options.config, house);
  const publisher = new Publisher({
    deviceManager,
    logger: silent,
    integrationId: "simulator",
    house,
    seed: options.config.seed,
  });
  const habits = new Habits(house, options.config.timezone);

  let first = true;
  for (; now < options.until; now += STEP_MS) {
    const state = world.advance(now);
    publisher.publish(state, first);
    first = false;
    habits.apply(world, state);
    options.onStep?.(now);
  }
}

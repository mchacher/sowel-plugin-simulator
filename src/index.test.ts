import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlugin, INTEGRATION_ID } from "./index.js";
import { HOUSE } from "./house/house.js";
import type { DiscoveredDevice, Logger, PluginDeps } from "./sowel-api.js";

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

function fakeDeps(settings: Record<string, string> = {}) {
  const declared: DiscoveredDevice[] = [];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const logger = fakeLogger();
  const deps: PluginDeps = {
    logger,
    eventBus: { emit: vi.fn() },
    settingsManager: { get: (key) => settings[key] },
    deviceManager: {
      upsertFromDiscovery: (_id, _source, discovered) => declared.push(discovered),
      updateDeviceData: (_id, sourceDeviceId, payload) =>
        updates.push({ id: sourceDeviceId, payload }),
      updateDeviceStatus: vi.fn(),
      removeStaleDevices: vi.fn(),
      logSummary: vi.fn(),
    },
    pluginDir: "/tmp/plugin",
  };
  return { deps, declared, updates, logger };
}

const PARIS = {
  "home.latitude": "48.8566",
  "home.longitude": "2.3522",
  "home.timezone": "Europe/Paris",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the plugin", () => {
  it("declares the simulator identity and needs no credentials", () => {
    const { deps } = fakeDeps();
    const plugin = createPlugin(deps);
    expect(plugin.id).toBe(INTEGRATION_ID);
    expect(plugin.apiVersion).toBe(2);
    expect(plugin.isConfigured()).toBe(true);
    expect(plugin.getSettingsSchema().map((s) => s.key)).toEqual(["seed"]);
  });

  it("opens on a full house rather than an empty one", async () => {
    const { deps, declared, updates } = fakeDeps(PARIS);
    const plugin = createPlugin(deps);
    await plugin.start();
    try {
      expect(declared).toHaveLength(HOUSE.devices.length);
      expect(new Set(updates.map((u) => u.id)).size).toBe(HOUSE.devices.length);
      expect(plugin.getStatus()).toBe("connected");
    } finally {
      await plugin.stop();
    }
    expect(plugin.getStatus()).toBe("disconnected");
  });

  it("publishes the same house twice for the same instant and seed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-15T11:00:00Z"));

    const run = async () => {
      const { deps, updates } = fakeDeps(PARIS);
      const plugin = createPlugin(deps);
      await plugin.start();
      await plugin.stop();
      return updates;
    };

    expect(await run()).toEqual(await run());
  });

  it("falls back to a documented location and says so, rather than refusing to start", async () => {
    const { deps, logger, updates } = fakeDeps();
    const plugin = createPlugin(deps);
    await plugin.start();
    try {
      expect(logger.warn).toHaveBeenCalled();
      expect(updates.length).toBeGreaterThan(0);
    } finally {
      await plugin.stop();
    }
  });

  it("takes a different seed to a different house", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-15T11:00:00Z"));

    const run = async (seed: string) => {
      const { deps, updates } = fakeDeps({ ...PARIS, "integration.simulator.seed": seed });
      const plugin = createPlugin(deps);
      await plugin.start();
      await plugin.stop();
      return updates;
    };

    expect(await run("1789")).not.toEqual(await run("2026"));
  });

  it("acknowledges an order and ignores it — spec 002 gives it meaning", async () => {
    const { deps, updates, logger } = fakeDeps(PARIS);
    const plugin = createPlugin(deps);
    await plugin.start();
    const before = updates.length;
    const device = {
      id: "d1",
      integrationId: INTEGRATION_ID,
      sourceDeviceId: "sim-light-sejour",
      name: "Lampe",
    };
    await expect(plugin.executeOrder(device, "state", true)).resolves.toBeUndefined();
    await expect(plugin.executeOrder(device, "sim.motion", true)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(updates.length).toBe(before);
    await plugin.stop();
  });

  it("survives a failing tick instead of taking the engine down with it", async () => {
    const { deps, logger } = fakeDeps(PARIS);
    const plugin = createPlugin(deps);
    await plugin.start();
    // Reach in the way a bug would: break the world under the running ticker.
    const broken = plugin as unknown as { world: { advance: () => never } };
    broken.world = {
      advance: () => {
        throw new Error("model exploded");
      },
    };
    (plugin as unknown as { tick: (ts: number) => void }).tick(Date.now());
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Simulation tick failed",
    );
    await plugin.stop();
  });

  it("stops cleanly and stops publishing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-15T11:00:00Z"));
    const { deps, updates } = fakeDeps(PARIS);
    const plugin = createPlugin(deps);
    await plugin.start();
    await plugin.stop();
    const after = updates.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updates.length).toBe(after);
  });
});

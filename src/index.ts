/**
 * Sowel plugin: Simulator
 *
 * Simulates a home — occupants on an agenda, sun and weather, a thermal model
 * per room, a pool, PV and household loads — and publishes it as ordinary
 * devices. Sowel's own recipes do the automation on top; nothing here knows what
 * a recipe is.
 *
 * Spec 001 (`specs/001-world-model/`) is the world. It publishes; it does not yet
 * listen: orders are logged and ignored until spec 002.
 */

import { HOUSE } from "./house/house.js";
import { Publisher } from "./publish/publisher.js";
import { Ticker } from "./world/clock.js";
import { World } from "./world/world.js";
import type {
  Device,
  IntegrationPlugin,
  IntegrationSettingDef,
  IntegrationStatus,
  Logger,
  PluginDeps,
} from "./sowel-api.js";

export const INTEGRATION_ID = "simulator";

/** The plugin's heartbeat. Live power is a per-second reading (FR10). */
const TICK_MS = 1_000;

/**
 * Where the house sits when the instance has not been told. Spec 111 lets a
 * plugin read `home.latitude` / `home.longitude` / `home.timezone`; it does not
 * promise they are set.
 */
const FALLBACK_LOCATION = { latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris" };

const DEFAULT_SEED = 1789;

class SimulatorPlugin implements IntegrationPlugin {
  readonly id = INTEGRATION_ID;
  readonly name = "Simulator";
  readonly description =
    "A simulated home: occupants, sun, weather, thermal, PV and loads, as ordinary devices";
  readonly icon = "House";
  readonly apiVersion = 2;

  private readonly logger: Logger;
  private status: IntegrationStatus = "disconnected";
  private world: World | undefined;
  private publisher: Publisher | undefined;
  private ticker: Ticker | undefined;

  constructor(private readonly deps: PluginDeps) {
    this.logger = deps.logger.child({ module: "simulator" });
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  /** The simulator needs no credentials: it is always configured. */
  isConfigured(): boolean {
    return true;
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "seed",
        label: "Graine de simulation",
        type: "number",
        required: false,
        defaultValue: String(DEFAULT_SEED),
        placeholder: String(DEFAULT_SEED),
      },
    ];
  }

  private readLocation(): typeof FALLBACK_LOCATION {
    const latitude = Number(this.deps.settingsManager.get("home.latitude"));
    const longitude = Number(this.deps.settingsManager.get("home.longitude"));
    const timezone = this.deps.settingsManager.get("home.timezone");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !timezone) {
      this.logger.warn(
        { fallback: FALLBACK_LOCATION },
        "Home location not set — simulating at the fallback location",
      );
      return FALLBACK_LOCATION;
    }
    return { latitude, longitude, timezone };
  }

  private readSeed(): number {
    const raw = this.deps.settingsManager.get(`integration.${INTEGRATION_ID}.seed`);
    const seed = Number(raw);
    return Number.isFinite(seed) && seed !== 0 ? seed : DEFAULT_SEED;
  }

  /**
   * Everything is declared and carries a value before the first tick (FR4). Five
   * of the six polled plugins in the fleet declare their devices inside the first
   * poll, so nothing exists until it succeeds — a demo cannot open on an empty
   * house.
   */
  async start(): Promise<void> {
    const location = this.readLocation();
    const seed = this.readSeed();
    const now = Date.now();

    this.world = new World({ ...location, seed }, HOUSE);
    this.publisher = new Publisher({
      deviceManager: this.deps.deviceManager,
      logger: this.logger,
      integrationId: INTEGRATION_ID,
      house: HOUSE,
      seed,
    });

    this.publisher.declareAll();
    this.world.warmUp(now);
    this.publisher.publish(this.world.advance(now), true);

    this.ticker = new Ticker({
      intervalMs: TICK_MS,
      onTick: (ts) => this.tick(ts),
      onOverrun: (lateByMs) => this.logger.debug({ lateByMs }, "Tick skipped: previous overran"),
    });
    this.ticker.start();

    this.status = "connected";
    this.logger.info({ ...location, seed, devices: HOUSE.devices.length }, "Simulator started");
  }

  /** Never throws: a failed tick is logged and the house carries on (FR13). */
  private tick(now: number): void {
    try {
      if (!this.world || !this.publisher) return;
      this.publisher.publish(this.world.advance(now));
    } catch (err) {
      this.logger.error({ err }, "Simulation tick failed");
    }
  }

  async stop(): Promise<void> {
    this.ticker?.stop();
    this.ticker = undefined;
    this.world = undefined;
    this.publisher = undefined;
    this.status = "disconnected";
    this.logger.info("Simulator stopped");
  }

  /**
   * Spec 002 gives orders meaning — real ones and the `sim.*` simulation orders.
   * Until then an order is acknowledged and ignored, never an error.
   */
  async executeOrder(device: Device, orderKey: string, value: unknown): Promise<void> {
    this.logger.debug(
      { deviceId: device.sourceDeviceId, orderKey, value },
      "Order received (spec 002 will act on it)",
    );
  }
}

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new SimulatorPlugin(deps);
}

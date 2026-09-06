/**
 * Sowel plugin: Simulator
 *
 * Simulates a home — occupants on an agenda, sun and weather, a thermal model
 * per room, PV and household loads — and publishes it as ordinary devices.
 * Sowel's own recipes do the automation on top; nothing here knows what a
 * recipe is.
 *
 * Phase 1 of the showroom project map:
 * https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md
 *
 * This is the skeleton: it starts, stops and reports its status. The world
 * model arrives with the phase 1 spec.
 */

import type {
  Device,
  IntegrationPlugin,
  IntegrationSettingDef,
  IntegrationStatus,
  Logger,
  PluginDeps,
} from "./sowel-api.js";

export const INTEGRATION_ID = "simulator";

class SimulatorPlugin implements IntegrationPlugin {
  readonly id = INTEGRATION_ID;
  readonly name = "Simulator";
  readonly description =
    "A simulated home: occupants, sun, weather, thermal, PV and loads, as ordinary devices";
  readonly icon = "House";
  readonly apiVersion = 2;

  private readonly logger: Logger;
  private status: IntegrationStatus = "disconnected";

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
    return [];
  }

  async start(): Promise<void> {
    this.status = "connected";
    this.logger.info({ pluginDir: this.deps.pluginDir }, "Simulator started");
  }

  async stop(): Promise<void> {
    this.status = "disconnected";
    this.logger.info("Simulator stopped");
  }

  async executeOrder(device: Device, orderKey: string, value: unknown): Promise<void> {
    this.logger.debug(
      { deviceId: device.id, orderKey, value },
      "Order received (no world model yet, ignored)",
    );
  }
}

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new SimulatorPlugin(deps);
}

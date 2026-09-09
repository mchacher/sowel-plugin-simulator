/**
 * Publication (spec 001, FR4, FR10, FR11, FR12).
 *
 * Maps a `WorldState` onto the devices of the catalogue and pushes them through
 * Sowel's `DeviceManager`. Holds no physics: everything here is naming, cadence
 * and change detection.
 *
 * Two rules shape it. Everything is declared and carries a value **before the
 * first tick**, because a demo cannot open on an empty house. And a reading is
 * published when its cadence elapses **or** when it moved past a threshold that
 * matters, because the WebSocket carries every message to every visitor.
 */

import { HOUSE } from "../house/house.js";
import type { DeviceSpec, House } from "../house/types.js";
import type { DeviceManager, DiscoveredDevice, Logger } from "../sowel-api.js";
import { rngFrom, hashSeed } from "../world/random.js";
import type { WorldState } from "../world/world.js";
import { declare, PROHIBITED_KEYS } from "./catalogue.js";

/**
 * How long a reading may stay silent before it is republished unchanged. This is
 * a floor, not a schedule: the tick runs every second, so anything that moves
 * past its threshold is published within a second whatever its heartbeat says.
 *
 * The distinction matters more here than in a real integration. A real clamp
 * publishes every second down the wire to one broker; this one publishes to
 * every visitor's WebSocket at once, so a load sitting at 0 W repeating itself
 * sixty times a minute is pure fan-out with nothing in it.
 */
const HEARTBEAT_MS = {
  live: 60_000,
  counters: 60_000,
  environment: 300_000,
  forecast: 6 * 3_600_000,
  event: 3_600_000,
} as const;

type Cadence = keyof typeof HEARTBEAT_MS;

interface KeyRule {
  cadence: Cadence;
  /** How far a number must move to be published immediately. */
  threshold?: number;
}

/** Per-category publication rules. Unlisted categories fall back to `event`. */
const RULES: Record<string, KeyRule> = {
  power: { cadence: "live", threshold: 5 },
  voltage: { cadence: "live", threshold: 0.5 },
  current: { cadence: "live", threshold: 0.05 },
  energy: { cadence: "counters" },
  temperature: { cadence: "environment", threshold: 0.1 },
  temperature_outdoor: { cadence: "environment", threshold: 0.1 },
  humidity: { cadence: "environment", threshold: 0.5 },
  humidity_outdoor: { cadence: "environment", threshold: 0.5 },
  pressure: { cadence: "environment", threshold: 0.3 },
  co2: { cadence: "environment", threshold: 5 },
  noise: { cadence: "environment", threshold: 1 },
  luminosity: { cadence: "environment", threshold: 25 },
  battery: { cadence: "environment", threshold: 1 },
  rain: { cadence: "environment", threshold: 0.1 },
  wind: { cadence: "environment", threshold: 1 },
  setpoint: { cadence: "environment", threshold: 0.1 },
  pool_water_temperature: { cadence: "environment", threshold: 0.05 },
  pool_temperature_setpoint: { cadence: "environment", threshold: 0.1 },
  weather_condition: { cadence: "forecast" },
  light_brightness: { cadence: "event", threshold: 1 },
  shutter_position: { cadence: "event", threshold: 1 },
};

interface Published {
  value: unknown;
  at: number;
}

export interface PublisherOptions {
  deviceManager: DeviceManager;
  logger: Logger;
  integrationId: string;
  house?: House;
  seed: number;
}

export class Publisher {
  private readonly house: House;
  private readonly declarations = new Map<string, DiscoveredDevice>();
  private readonly categories = new Map<string, Map<string, string>>();
  private readonly last = new Map<string, Map<string, Published>>();
  private readonly counterBaseline = new Map<string, number>();
  private inverterOffline: boolean | undefined;

  constructor(private readonly options: PublisherOptions) {
    this.house = options.house ?? HOUSE;
    for (const device of this.house.devices) {
      const declaration = declare(device, this.house);
      this.declarations.set(device.id, declaration);
      const byKey = new Map<string, string>();
      for (const entry of declaration.data) byKey.set(entry.key, entry.category);
      this.categories.set(device.id, byKey);
    }
  }

  /** Every device, declared before the first value (FR4). */
  declareAll(): void {
    for (const device of this.house.devices) {
      const declaration = this.declarations.get(device.id);
      if (!declaration) continue;
      this.options.deviceManager.upsertFromDiscovery(
        this.options.integrationId,
        this.options.integrationId,
        declaration,
      );
    }
    this.options.logger.info({ devices: this.house.devices.length }, "Simulated devices declared");
  }

  /**
   * Publish what has changed or is due. `force` sends everything, which is what
   * the first publication after `declareAll` does.
   */
  publish(state: WorldState, force = false): void {
    for (const device of this.house.devices) {
      // An offline inverter publishes nothing. It has to be silent rather than
      // repeating a zero, because `updateDeviceData` marks a device online again
      // — so a heartbeat of `power: 0` would quietly resurrect it a minute after
      // sunset. The one exception is the forced first publication, so the device
      // still opens with a value rather than an empty card (FR4).
      if (device.archetype === "pv" && state.energy.inverterOffline && !force) continue;

      const values = this.valuesFor(device, state);
      if (!values) continue;
      const payload = this.gate(device.id, values, state.ts, force);
      if (Object.keys(payload).length === 0) continue;
      this.options.deviceManager.updateDeviceData(
        this.options.integrationId,
        device.id,
        payload,
        state.ts,
      );
    }
    this.publishInverterStatus(state);
  }

  /** The PV inverter goes offline at night rather than reporting 0 W (FR12). */
  private publishInverterStatus(state: WorldState): void {
    const inverter = this.house.devices.find((d) => d.archetype === "pv");
    if (!inverter) return;
    if (this.inverterOffline === state.energy.inverterOffline) return;
    this.inverterOffline = state.energy.inverterOffline;
    this.options.deviceManager.updateDeviceStatus(
      this.options.integrationId,
      inverter.id,
      state.energy.inverterOffline ? "offline" : "online",
    );
  }

  /** Drop what has not moved and is not due. */
  private gate(
    deviceId: string,
    values: Record<string, unknown>,
    ts: number,
    force: boolean,
  ): Record<string, unknown> {
    let last = this.last.get(deviceId);
    if (!last) {
      last = new Map();
      this.last.set(deviceId, last);
    }
    const categories = this.categories.get(deviceId);
    const payload: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      if (PROHIBITED_KEYS.includes(key)) {
        this.options.logger.warn({ deviceId, key }, "Refused to publish a prohibited key");
        continue;
      }
      if (!categories?.has(key)) {
        this.options.logger.warn({ deviceId, key }, "Refused to publish an undeclared key");
        continue;
      }
      const previous = last.get(key);
      if (!force && previous && !this.isDue(categories.get(key), previous, value, ts)) continue;
      payload[key] = value;
      last.set(key, { value, at: ts });
    }
    return payload;
  }

  private isDue(
    category: string | undefined,
    previous: Published,
    value: unknown,
    ts: number,
  ): boolean {
    const rule = (category && RULES[category]) || { cadence: "event" as Cadence };
    if (ts - previous.at >= HEARTBEAT_MS[rule.cadence]) return true;
    if (typeof value === "number" && typeof previous.value === "number") {
      return Math.abs(value - previous.value) >= (rule.threshold ?? 0.0001);
    }
    return value !== previous.value;
  }

  /**
   * A battery level that does not move. Flat batteries belong with simulated
   * hardware faults, which the project map parks for a later phase — but a
   * device that reports no battery at all looks broken, so each one carries a
   * stable, plausible level derived from its own name.
   */
  private batteryFor(deviceId: string): number {
    return Math.round(rngFrom(hashSeed(this.options.seed, `battery:${deviceId}`)).range(72, 100));
  }

  /** Cumulative-to-delta for the `energy` category (spec 001, FR9). */
  private delta(deviceId: string, key: string, cumulativeWh: number): number {
    const id = `${deviceId}:${key}`;
    const previous = this.counterBaseline.get(id);
    this.counterBaseline.set(id, cumulativeWh);
    if (previous === undefined) return 0;
    // A day rollover resets the cumulative: report nothing rather than a
    // negative delta, which would be read as production.
    return cumulativeWh >= previous ? cumulativeWh - previous : 0;
  }

  private round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private valuesFor(device: DeviceSpec, state: WorldState): Record<string, unknown> | undefined {
    const room = device.room ? state.rooms[device.room] : undefined;
    const battery = this.batteryFor(device.id);

    switch (device.archetype) {
      case "motion":
        return room && { occupancy: room.occupied, battery };
      case "motion_lux":
        return (
          room && {
            occupancy: room.occupied,
            battery,
            illuminance: this.round(room.illuminanceLx, 0),
          }
        );
      case "contact":
        return { contact: state.contactsClosed[device.id] ?? true, battery };
      case "th_probe":
        return (
          room && {
            temperature: this.round(room.temperatureC, 1),
            humidity: this.round(room.humidityPct, 0),
            battery,
          }
        );
      case "air_quality":
        return (
          room && {
            temperature: this.round(room.temperatureC, 1),
            humidity: this.round(room.humidityPct, 0),
            pressure: this.round(state.weather.pressureHpa, 1),
            co2: this.round(room.co2Ppm, 0),
            noise: this.round(room.noiseDb, 0),
          }
        );
      case "button":
        // `action` is momentary: nothing is published until something presses
        // it, which is a simulation order and therefore spec 002.
        return { battery };
      case "relay":
        return { state: state.actuators.relays[device.id] ?? false };
      case "valve":
        // A valve keeps its own state, not the relays'. Reading `relays` here
        // published `false` for ever, whatever the valve was actually doing.
        return { state: state.actuators.valves[device.id] ?? false };
      case "heater":
        return { state: state.actuators.heaters[device.id] ?? false };
      case "relay_4ch": {
        const channels = state.actuators.relayChannels[device.id] ?? [];
        const values: Record<string, unknown> = {};
        channels.forEach((on, index) => {
          values[`power${index + 1}`] = on;
        });
        return values;
      }
      case "dimmer": {
        const dimmer = state.actuators.dimmers[device.id];
        return dimmer && { state: dimmer.on, brightness: Math.round(dimmer.brightness) };
      }
      case "shutter":
      case "pool_cover":
        return { position: this.round(state.actuators.shutters[device.id] ?? 100, 0) };
      case "gate":
        return { R1: state.actuators.gates[device.id] ?? false };
      case "thermostat": {
        const thermostat = state.actuators.thermostats[device.id];
        if (!thermostat || !room) return undefined;
        return {
          temperature: this.round(room.temperatureC, 1),
          setpoint: this.round(thermostat.setpointC, 1),
          state: thermostat.power && room.heatingOn,
          operationMode: thermostat.operationMode,
          outsideTemperature: this.round(state.outdoor.temperatureC, 1),
        };
      }
      case "pool_heat_pump":
        return {
          water_temperature: this.round(state.pool.waterTemperatureC, 2),
          outdoor_temperature: this.round(state.outdoor.temperatureC, 1),
          setpoint: this.round(state.pool.setpointC, 1),
        };
      case "grid_clamp": {
        const { gridW, voltageV, counters } = state.energy;
        return {
          power: this.round(gridW, 0),
          voltage: this.round(voltageV, 1),
          current: this.round(Math.abs(gridW) / voltageV, 2),
          energy_forward: this.round(counters.importedWh, 1),
          energy_reverse: this.round(counters.exportedWh, 1),
          // The delta convention: what was drawn since the previous report.
          energy: this.round(this.delta(device.id, "energy", counters.importedWh), 2),
        };
      }
      case "subload_clamp": {
        if (!device.load) return undefined;
        return {
          power: this.round(state.energy.loads[device.load] ?? 0, 0),
          energy: this.round(
            this.delta(device.id, "energy", state.energy.counters.perLoadWh[device.load] ?? 0),
            2,
          ),
        };
      }
      case "pv":
        return {
          power: this.round(state.energy.productionW, 0),
          energy: this.round(this.delta(device.id, "energy", state.energy.counters.producedWh), 2),
        };
      case "metered_appliance": {
        if (!device.load) return undefined;
        return {
          power: this.round(state.energy.loads[device.load] ?? 0, 0),
          energy: this.round(
            this.delta(device.id, "energy", state.energy.counters.perLoadWh[device.load] ?? 0),
            2,
          ),
          state: state.appliancesRunning[device.id] ? "on" : "off",
        };
      }
      case "outdoor_module":
        return {
          temperature: this.round(state.outdoor.temperatureC, 1),
          humidity: this.round(state.outdoor.humidityPct, 0),
          battery,
        };
      case "rain_gauge":
        return {
          rain: this.round(state.weather.rainMmPerHour, 2),
          sum_rain_24: this.round(state.weather.rainMmToday, 2),
          battery,
        };
      case "wind_gauge":
        return {
          wind_strength: this.round(state.weather.windKmh, 0),
          wind_angle: this.round(state.weather.windDeg, 0),
          gust_strength: this.round(state.weather.gustKmh, 0),
          gust_angle: this.round(state.weather.gustDeg, 0),
          battery,
        };
      case "forecast": {
        const values: Record<string, unknown> = {};
        for (const day of state.forecast) {
          values[`j${day.index}_condition`] = day.condition;
          values[`j${day.index}_temp_min`] = day.tempMinC;
          values[`j${day.index}_temp_max`] = day.tempMaxC;
          values[`j${day.index}_rain_prob`] = day.rainProbabilityPct;
          values[`j${day.index}_wind_gusts`] = day.windGustsKmh;
        }
        return values;
      }
      case "occupant": {
        const occupant = state.occupants.find((o) => o.id === device.occupant);
        return occupant && { zone: occupant.place, present: occupant.present };
      }
      case "simulation":
        return { ghosts: state.ghostCount };
    }
  }
}

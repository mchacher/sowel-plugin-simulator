/**
 * Orders (spec 002).
 *
 * The only file in the plugin that knows what a `DeviceOrder` is. It resolves
 * the device and the order against the catalogue, coerces the value, applies the
 * debounce, and changes the world. It never publishes: the reading follows on the
 * next tick because the model changed, so an order and the physics that follow it
 * cannot disagree.
 *
 * It never throws either. `executeOrder` is one of the methods the core rethrows
 * from, so a throw here surfaces as a failed order in a visitor's face.
 */

import { HOUSE } from "../house/house.js";
import type { DeviceSpec, House } from "../house/types.js";
import type { DiscoveredOrder, Logger } from "../sowel-api.js";
import { parseGhostTarget } from "../world/ghosts.js";
import type { Condition } from "../world/weather.js";
import type { World } from "../world/world.js";
import { declare, WEATHER_CONDITIONS } from "./catalogue.js";

/**
 * How long a target stays deaf after an accepted order.
 *
 * This is the "ten hands on one lamp" rule, and it lives here because the core
 * has no demo mode. Deliberately short: long enough that a lamp cannot strobe,
 * short enough that a visitor never feels the house ignoring them.
 */
export const DEBOUNCE_MS = 3000;

const TRUE_VALUES = new Set(["true", "on", "1", "yes", "open"]);
const FALSE_VALUES = new Set(["false", "off", "0", "no", "close", "closed"]);

/** Being strict about a wire shape we do not control buys nothing. */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalised)) return true;
    if (FALSE_VALUES.has(normalised)) return false;
  }
  return undefined;
}

export function coerceNumber(value: unknown, min?: number, max?: number): number | undefined {
  const raw = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(raw)) return undefined;
  // Clamped rather than refused: a setpoint above the maximum is a visitor
  // asking for the maximum, and refusing it is a worse demo than giving it.
  return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, raw));
}

export function coerceEnum(value: unknown, allowed: readonly string[]): string | undefined {
  const raw = String(value ?? "").trim();
  return allowed.find((entry) => entry.toLowerCase() === raw.toLowerCase());
}

export interface OrderRouterOptions {
  world: World;
  logger: Logger;
  house?: House;
  now?: () => number;
}

export class OrderRouter {
  private readonly house: House;
  private readonly devices = new Map<string, DeviceSpec>();
  private readonly orders = new Map<string, Map<string, DiscoveredOrder>>();
  private readonly lastAccepted = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: OrderRouterOptions) {
    this.house = options.house ?? HOUSE;
    this.now = options.now ?? Date.now;
    for (const device of this.house.devices) {
      this.devices.set(device.id, device);
      const byKey = new Map<string, DiscoveredOrder>();
      for (const order of declare(device, this.house).orders) byKey.set(order.key, order);
      this.orders.set(device.id, byKey);
    }
  }

  execute(sourceDeviceId: string, orderKey: string, value: unknown): void {
    const device = this.devices.get(sourceDeviceId);
    if (!device) {
      this.options.logger.debug({ sourceDeviceId, orderKey }, "Order for an unknown device");
      return;
    }
    const declared = this.orders.get(sourceDeviceId)?.get(orderKey);
    if (!declared) {
      this.options.logger.debug({ sourceDeviceId, orderKey }, "Order the device does not declare");
      return;
    }

    const now = this.now();
    // A STOP is exempt: debouncing a stop is how a shutter ends up somewhere
    // nobody asked for.
    const isStop = orderKey === "state" && coerceEnum(value, ["STOP"]) === "STOP";
    if (!isStop && this.debounced(sourceDeviceId, orderKey, now)) {
      this.options.logger.debug({ sourceDeviceId, orderKey }, "Order debounced");
      return;
    }

    const applied = this.apply(device, declared, orderKey, value, now);
    if (applied) this.lastAccepted.set(`${sourceDeviceId}:${orderKey}`, now);
  }

  private debounced(sourceDeviceId: string, orderKey: string, now: number): boolean {
    const last = this.lastAccepted.get(`${sourceDeviceId}:${orderKey}`);
    return last !== undefined && now - last < DEBOUNCE_MS;
  }

  private warnValue(device: DeviceSpec, orderKey: string, value: unknown): false {
    this.options.logger.warn(
      { sourceDeviceId: device.id, orderKey, value: String(value).slice(0, 40) },
      "Order value could not be read",
    );
    return false;
  }

  /** Returns whether anything actually changed. */
  private apply(
    device: DeviceSpec,
    declared: DiscoveredOrder,
    orderKey: string,
    value: unknown,
    now: number,
  ): boolean {
    const { world } = this.options;

    if (orderKey.startsWith("sim.")) return this.applySimulation(device, orderKey, value, now);

    switch (device.archetype) {
      case "relay":
        return this.withBoolean(device, orderKey, value, (on) => world.setRelay(device.id, on));
      case "valve":
        return this.withBoolean(device, orderKey, value, (open) => world.setValve(device.id, open));
      case "heater":
        return this.withBoolean(device, orderKey, value, (on) => world.setHeater(device.id, on));
      case "relay_4ch": {
        const index = Number(orderKey.replace("power", "")) - 1;
        return this.withBoolean(device, orderKey, value, (on) =>
          world.setRelayChannel(device.id, index, on),
        );
      }
      case "dimmer":
        if (orderKey === "state") {
          return this.withBoolean(device, orderKey, value, (on) =>
            world.setDimmerPower(device.id, on),
          );
        }
        return this.withNumber(device, orderKey, value, declared, (brightness) =>
          world.setDimmerBrightness(device.id, brightness),
        );
      case "shutter":
        if (orderKey === "state") {
          const move = coerceEnum(value, ["OPEN", "CLOSE", "STOP"]);
          if (!move) return this.warnValue(device, orderKey, value);
          world.moveShutter(device.id, move as "OPEN" | "CLOSE" | "STOP");
          return true;
        }
        return this.withNumber(device, orderKey, value, declared, (position) =>
          world.setShutterPosition(device.id, position),
        );
      case "gate":
        // A gate order is momentary; the value is the press, not a state.
        world.pulseGate(device.id, now);
        return true;
      case "thermostat":
        if (orderKey === "power") {
          return this.withBoolean(device, orderKey, value, (on) =>
            world.setThermostatPower(device.id, on),
          );
        }
        if (orderKey === "operationMode") {
          const mode = coerceEnum(value, declared.enumValues ?? []);
          if (!mode) return this.warnValue(device, orderKey, value);
          world.setThermostatMode(device.id, mode);
          return true;
        }
        return this.withNumber(device, orderKey, value, declared, (setpoint) =>
          world.setThermostatSetpoint(device.id, setpoint),
        );
      case "pool_heat_pump":
        return this.withNumber(device, orderKey, value, declared, (setpoint) =>
          world.setPoolSetpoint(setpoint),
        );
      default:
        this.options.logger.debug(
          { sourceDeviceId: device.id, orderKey },
          "Order on an archetype that has none",
        );
        return false;
    }
  }

  private applySimulation(
    device: DeviceSpec,
    orderKey: string,
    value: unknown,
    now: number,
  ): boolean {
    const { world, logger } = this.options;

    switch (orderKey) {
      case "sim.motion":
        world.simMotion(device.id, now);
        return true;
      case "sim.open":
        world.simDoor(device.id, true, now);
        return true;
      case "sim.close":
        world.simDoor(device.id, false, now);
        return true;
      case "sim.temperature": {
        const temperature = coerceNumber(value, -10, 40);
        if (temperature === undefined) return this.warnValue(device, orderKey, value);
        if (!device.room) return false;
        return world.simTemperature(device.room, temperature);
      }
      case "sim.weather": {
        const condition = coerceEnum(value, WEATHER_CONDITIONS);
        if (!condition) return this.warnValue(device, orderKey, value);
        world.simWeather(condition as Condition, now);
        return true;
      }
      case "sim.enter":
      case "sim.leave": {
        if (!device.occupant) return false;
        return world.simOccupant(device.occupant, orderKey === "sim.enter", now);
      }
      case "sim.ghost": {
        const target = parseGhostTarget(String(value ?? ""));
        if (!target) return this.warnValue(device, orderKey, value);
        const placed = world.simGhost(target.id, target.room, now);
        if (!placed) {
          logger.debug({ room: target.room }, "Ghost asked for a room that is not in the house");
        }
        return placed;
      }
      default:
        logger.debug({ sourceDeviceId: device.id, orderKey }, "Unknown simulation order");
        return false;
    }
  }

  private withBoolean(
    device: DeviceSpec,
    orderKey: string,
    value: unknown,
    apply: (on: boolean) => void,
  ): boolean {
    const on = coerceBoolean(value);
    if (on === undefined) return this.warnValue(device, orderKey, value);
    apply(on);
    return true;
  }

  private withNumber(
    device: DeviceSpec,
    orderKey: string,
    value: unknown,
    declared: DiscoveredOrder,
    apply: (value: number) => void,
  ): boolean {
    const number = coerceNumber(value, declared.min, declared.max);
    if (number === undefined) return this.warnValue(device, orderKey, value);
    apply(number);
    return true;
  }
}

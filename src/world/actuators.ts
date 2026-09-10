/**
 * What the house's actuators are doing (spec 001).
 *
 * In this spec these states are initialised and read; nothing ever changes them,
 * because orders arrive in spec 002. They exist here because the model already
 * depends on them: a closed shutter blocks solar gain, a running pool pump is
 * what lets the pool heat pump do anything, and a lamp that is on is watts.
 *
 * Shutters stay where they start. A shutter that closed itself at dusk would be
 * the plugin doing home automation, and that is a recipe's job — the whole point
 * of the demo is that Sowel does it, not the simulator.
 */

import type { House } from "../house/types.js";

export interface DimmerState {
  on: boolean;
  /** 0–254, the Zigbee scale — see core issue #933. */
  brightness: number;
}

export interface ThermostatState {
  power: boolean;
  setpointC: number;
  operationMode: string;
}

export interface ActuatorStates {
  /** Device id → on. Covers lights and the flexible-load relays. */
  relays: Record<string, boolean>;
  relayChannels: Record<string, boolean[]>;
  dimmers: Record<string, DimmerState>;
  /** Device id → position, 0 closed to 100 open. */
  shutters: Record<string, number>;
  thermostats: Record<string, ThermostatState>;
  heaters: Record<string, boolean>;
  gates: Record<string, boolean>;
  valves: Record<string, boolean>;
  poolSetpointC: number;
}

export function initialActuators(house: House): ActuatorStates {
  const state: ActuatorStates = {
    relays: {},
    relayChannels: {},
    dimmers: {},
    shutters: {},
    thermostats: {},
    heaters: {},
    gates: {},
    valves: {},
    poolSetpointC: house.pool.setpointC,
  };

  for (const device of house.devices) {
    switch (device.archetype) {
      case "relay":
        // A flexible load's supply relay is closed and its own programme decides
        // what it does inside that — a water heater on permanent mains heating
        // off-peak, a pool pump on its built-in timer. The water heater's *solar*
        // input starts open: nothing is forcing a surplus charge yet, and that is
        // the handle spec 002 hands the arbiter. Lights start off.
        // A water heater is genuinely on permanent mains, with its own clock
        // inside: its supply relay is closed. A pool pump is not — its hours are
        // a Sowel recipe's, so its relay starts open and waits to be told. A
        // simulator that scheduled it would be doing automation, and a load
        // running without a grant looks to the energy arbiter like a hand on a
        // wall switch.
        state.relays[device.id] = device.load === "water-heater" && !device.solarChannel;
        break;
      case "relay_4ch":
        state.relayChannels[device.id] = new Array(device.channels ?? 4).fill(false);
        break;
      case "dimmer":
        state.dimmers[device.id] = { on: false, brightness: 0 };
        break;
      case "shutter":
        state.shutters[device.id] = 100;
        break;
      case "pool_cover":
        // Rolled back, like the shutters. Closing it is a recipe's decision.
        state.shutters[device.id] = 100;
        break;
      case "thermostat": {
        const room = house.rooms.find((r) => r.id === device.room);
        state.thermostats[device.id] = {
          power: true,
          setpointC: room?.setpointC ?? 20,
          operationMode: "heat",
        };
        break;
      }
      case "heater":
        state.heaters[device.id] = true;
        break;
      case "gate":
        state.gates[device.id] = false;
        break;
      case "valve":
        state.valves[device.id] = false;
        break;
      default:
        break;
    }
  }
  return state;
}

/** A shutter's open fraction in [0, 1], for solar gain. */
export function shutterOpenFraction(state: ActuatorStates, deviceId: string): number {
  const position = state.shutters[deviceId];
  return position === undefined ? 1 : position / 100;
}

/**
 * Watts the lighting is drawing.
 *
 * A lighting relay is one with no `load`: the flexible loads name theirs, and
 * that is the only thing that tells the two apart. Reading the device id would
 * work today and break the first time a lamp is renamed.
 */
export function lightingW(house: House, state: ActuatorStates): number {
  let total = 0;
  for (const device of house.devices) {
    if (device.archetype === "relay" && device.load === undefined && state.relays[device.id]) {
      total += 9;
    }
  }
  for (const channels of Object.values(state.relayChannels)) {
    for (const on of channels) if (on) total += 12;
  }
  for (const dimmer of Object.values(state.dimmers)) {
    if (dimmer.on) total += 4 + (dimmer.brightness / 254) * 14;
  }
  return total;
}

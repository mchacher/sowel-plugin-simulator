/**
 * The shape of the house description (spec 001, FR1).
 *
 * This is data, not behaviour. Spec 003 reads it to remap the demo fixture and
 * phase 3 reads it to draw the plan, so it is a contract: renaming a room id or
 * a device id breaks bindings in an installed instance.
 */

export type Orientation = "N" | "E" | "S" | "W";

/** Azimuth each orientation faces, degrees clockwise from north. */
export const ORIENTATION_AZIMUTH: Record<Orientation, number> = { N: 0, E: 90, S: 180, W: 270 };

export interface Window {
  orientation: Orientation;
  /** Glazed area in m². Drives solar gain. */
  areaM2: number;
  /** Device id of the shutter in front of it, when there is one. */
  shutterDeviceId?: string;
}

/**
 * How a room is heated.
 *
 * `trv` is a thermostatic radiator valve: no Sowel device, it simply holds the
 * room near its setpoint the way a real valve does. Without it the whole house
 * would drift cold and the demo would look broken, which would be a worse lie
 * than the simplification.
 */
export type HeatingKind = "thermostat" | "heater" | "trv" | "none";

export interface Room {
  id: string;
  label: string;
  level: 0 | 1;
  floorAreaM2: number;
  /** Heat loss to outdoors, W per kelvin. */
  lossWPerK: number;
  /** Effective thermal capacity, J per kelvin. Divided by lossWPerK it is τ. */
  capacityJPerK: number;
  setpointC: number;
  heating: HeatingKind;
  windows: Window[];
  /** A room that is outdoors and simply tracks the outdoor model. */
  outdoor?: boolean;
}

export type OccupantKind = "adult" | "child";

export interface Occupant {
  id: string;
  label: string;
  kind: OccupantKind;
  /** Room the occupant sleeps in. */
  bedroom: string;
  /** Minutes from local midnight, on a weekday. */
  weekday: { wake: number; leave: number; back: number; sleep: number };
  weekend: { wake: number; sleep: number };
  /** 0 = Sunday. Days the occupant stays home and works in `homeWorkRoom`. */
  homeDays?: number[];
  homeWorkRoom?: string;
}

/**
 * An electrical load the energy model knows by name. Some are switchable
 * (`relay`), some are only ever observed through their clamp.
 */
export type LoadId =
  | "heat-pump"
  | "water-heater"
  | "pool-pump"
  | "pool-heat-pump"
  | "cooking"
  | "dishwasher"
  | "washing-machine";

export interface LoadSpec {
  id: LoadId;
  label: string;
  nominalW: number;
  /**
   * Spec 140's class. `background` is never arbitrated and is only seen through
   * the meter; `comfort` may be boosted but never switched off; `deferrable` is
   * fully preemptible.
   */
  arbiterClass: "background" | "comfort" | "deferrable";
}

export type Archetype =
  | "motion"
  | "motion_lux"
  | "contact"
  | "th_probe"
  | "air_quality"
  | "button"
  | "relay"
  | "relay_4ch"
  | "dimmer"
  | "shutter"
  | "gate"
  | "valve"
  | "thermostat"
  | "heater"
  | "pool_heat_pump"
  | "grid_clamp"
  | "subload_clamp"
  | "pv"
  | "metered_appliance"
  | "outdoor_module"
  | "rain_gauge"
  | "wind_gauge"
  | "forecast"
  | "occupant";

export interface DeviceSpec {
  /**
   * Becomes `friendlyName` at discovery and therefore `source_device_id`, which
   * is what a binding resolves against. Stable forever.
   */
  id: string;
  archetype: Archetype;
  /** Room the device lives in, for the archetypes that have one. */
  room?: string;
  /** Occupant the device represents, for `occupant`. */
  occupant?: string;
  /** Load the device measures (`subload_clamp`) or switches (`relay`). */
  load?: LoadId;
  /**
   * A relay driving the solar-force input of its load rather than its main
   * on/off — core spec 152. Nothing solar-specific is declared at discovery:
   * this only tells the energy model which input the relay is wired to.
   */
  solarChannel?: boolean;
  /** Number of channels, for `relay_4ch`. */
  channels?: number;
  /** Windows this shutter covers, for solar gain. */
  coversWindowOfRoom?: string;
}

export interface PoolSpec {
  /** Water volume in m³. */
  volumeM3: number;
  /** Surface area in m², for solar gain and evaporation. */
  surfaceM2: number;
  /** Heat loss to outdoors, W per kelvin. */
  lossWPerK: number;
  setpointC: number;
  /** Thermal output of the pool heat pump, W. */
  heatPumpThermalW: number;
}

export interface House {
  rooms: Room[];
  occupants: Occupant[];
  devices: DeviceSpec[];
  loads: LoadSpec[];
  pool: PoolSpec;
  pv: { peakW: number; systemLoss: number };
  /** Household floor, W, by hour of day. */
  baseLoadW: { night: number; day: number; evening: number };
}

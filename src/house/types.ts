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
 * - `thermostat` — a local unit with its own setpoint, like the living room's stove.
 * - `heater` — a local electric radiator, switched but not regulated.
 * - `trv` — a thermostatic radiator valve on the house's own heat pump. No Sowel
 *   device of its own: it follows the **house** setpoint, offset by
 *   `setpointOffsetK`, the way a real valve does. A bedroom is cooler than a
 *   living room because its valve is turned down, not because it has its own
 *   thermostat.
 * - `none` — unheated. A garage, a cellar, a workshop.
 */
export type HeatingKind = "thermostat" | "heater" | "trv" | "none";

export interface Room {
  id: string;
  label: string;
  /** −1 basement, 0 ground, 1 and 2 upstairs. `null` outdoors. */
  level: number | null;
  floorAreaM2: number;
  /** Heat loss to outdoors, W per kelvin. */
  lossWPerK: number;
  /** Effective thermal capacity, J per kelvin. Divided by lossWPerK it is τ. */
  capacityJPerK: number;
  /**
   * Where the room wants to be. On a `trv` room this is derived from the house
   * setpoint and `setpointOffsetK`, so it is a record of intent rather than a
   * control: turn the house heat pump down and every valve follows.
   */
  setpointC: number;
  /** Kelvin this room's valve sits below the house setpoint. */
  setpointOffsetK?: number;
  heating: HeatingKind;
  windows: Window[];
  /** A room that is outdoors and simply tracks the outdoor model. */
  outdoor?: boolean;
  /**
   * A room surrounded by earth rather than by air. It loses heat to the ground,
   * which keeps the annual mean and a quarter of its swing — which is why a
   * cellar sits near 12 °C in January as well as in July.
   */
  groundCoupled?: boolean;
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
  /** A pool cover. The same points as a shutter; a different thing to close. */
  | "pool_cover"
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
  | "occupant"
  /** The one device in the house that represents nothing physical (spec 002). */
  | "simulation";

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
  /**
   * The device id of the house's own heat pump (spec 003).
   *
   * It has no room: it serves every `trv` room at once, which is what a single
   * air-to-water unit with thermostatic valves actually is. Its setpoint is the
   * house setpoint, each room sits `setpointOffsetK` below it, and its
   * temperature reading is the area-weighted average of the rooms it serves —
   * which is also, correctly, what the zone aggregator folds into the house
   * average.
   */
  houseThermostatDeviceId: string;
  occupants: Occupant[];
  devices: DeviceSpec[];
  loads: LoadSpec[];
  pool: PoolSpec;
  pv: { peakW: number; systemLoss: number };
  /** Household floor, W, by hour of day. */
  baseLoadW: { night: number; day: number; evening: number };
}

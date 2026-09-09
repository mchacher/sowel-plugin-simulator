/**
 * The world (specs 001 and 002).
 *
 * Composes every model into one `WorldState` per tick and owns the only mutable
 * state in the plugin — the things that integrate. Nothing is written to disk:
 * at start the model is reconstructed by integrating from local midnight, which
 * is what makes a restart at 15:00 give a house that is at 15:00 rather than a
 * cold one, and what keeps the cumulative energy counters monotonic across it.
 *
 * Spec 002 adds the other direction: orders change the world here, and the
 * reading follows on the next tick because the model changed. Nothing publishes
 * from inside an order, so an order and the physics that follow it cannot
 * disagree.
 */

import { HOUSE } from "../house/house.js";
import type { DeviceSpec, House, LoadId, Room } from "../house/types.js";
import {
  initialActuators,
  lightingW,
  shutterOpenFraction,
  type ActuatorStates,
} from "./actuators.js";
import { initialAir, daylightLux, stepAir, type AirState } from "./air.js";
import { applianceRunning, inOffPeak, loadPowers, poolPumpScheduled } from "./appliances.js";
import { dayNumber, localMidnight, localParts } from "./clock.js";
import {
  accumulate,
  baseLoadW,
  emptyCounters,
  gridVoltageV,
  pvProductionW,
  type EnergyCounters,
} from "./energy.js";
import { AWAY, occupancyByRoom, occupantsAt, type OccupantState } from "./occupants.js";
import { initialPoolTemperatureC, poolSolarGainW, stepPool, type PoolState } from "./pool.js";
import {
  DRAW_KITCHEN_LPM,
  DRAW_SHOWER_LPM,
  initialWaterHeaterState,
  stepWaterHeater,
  WATER_HEATER,
  type WaterHeaterState,
} from "./water-heater.js";
import {
  clearSkyIrradiance,
  incidenceFactor,
  sunPosition,
  sunTimes,
  type SunPosition,
} from "./sun.js";
import {
  emitterMaxW,
  heatPumpCop,
  initialTemperatureC,
  solarGainW,
  stepRoom,
  type RoomThermalState,
} from "./thermal.js";
import { outdoorAt, outdoorRangeForDay, type OutdoorState } from "./outdoor.js";
import { ORIENTATION_AZIMUTH } from "../house/types.js";
import {
  forecast,
  weatherAt,
  type Condition,
  type ForecastDay,
  type WeatherState,
} from "./weather.js";
import {
  DIMMER_RATE_PER_S,
  GATE_PULSE_MS,
  SHUTTER_RATE_PCT_PER_S,
  Transitions,
} from "./actuation.js";
import { Ghosts } from "./ghosts.js";
import { Overrides } from "./overrides.js";

/** Integration step during warm-up and when catching up, seconds. */
const WARMUP_STEP_S = 60;
/** Longest gap we bridge by stepping; beyond it, rebuild from midnight. */
const MAX_CATCHUP_S = 900;
/** How long a PIR keeps reporting occupancy after the room empties, seconds. */
const MOTION_HOLD_S = 60;
/** How long a door stays open when someone goes through it, seconds. */
const DOOR_OPEN_S = 9;
/** Days of pool history replayed at start, comfortably past its time constant. */
const POOL_WARMUP_DAYS = 12;
/** The pool's cover, which is a thermal input and not only an actuator. */
const POOL_COVER_DEVICE_ID = "sim-pool-cover";

export interface WorldConfig {
  latitude: number;
  longitude: number;
  timezone: string;
  seed: number;
}

export interface RoomState {
  id: string;
  temperatureC: number;
  humidityPct: number;
  co2Ppm: number;
  noiseDb: number;
  illuminanceLx: number;
  occupants: number;
  /** What a PIR in the room reports, hold time included. */
  occupied: boolean;
  heatingOn: boolean;
}

export interface WorldState {
  ts: number;
  sun: SunPosition;
  sunrise: number | null;
  sunset: number | null;
  weather: WeatherState;
  outdoor: OutdoorState;
  forecast: ForecastDay[];
  rooms: Record<string, RoomState>;
  pool: {
    waterTemperatureC: number;
    setpointC: number;
    heatPumpOn: boolean;
    /** 1 rolled back, 0 closed. Evaporation, and so the whole heat balance, follows it. */
    coverOpenFraction: number;
  };
  /** The hot-water tank. Not published as a device: nothing in the demo meters it. */
  waterHeater: WaterHeaterState;
  occupants: OccupantState[];
  /** Device id → **closed**. Zigbee's `contact` is true when the door is shut. */
  contactsClosed: Record<string, boolean>;
  energy: {
    productionW: number;
    loadW: number;
    gridW: number;
    voltageV: number;
    loads: Record<LoadId, number>;
    counters: EnergyCounters;
    /** True between sunset and sunrise: the inverter reports offline (FR12). */
    inverterOffline: boolean;
  };
  actuators: ActuatorStates;
  appliancesRunning: Record<string, boolean>;
  /** Ephemeral visitors currently in the house (spec 002, FR4). */
  ghostCount: number;
}

export class World {
  private readonly house: House;
  private rooms = new Map<string, RoomThermalState>();
  private air = new Map<string, AirState>();
  private pool: PoolState = { waterTemperatureC: 20, heatPumpOn: false };
  private waterHeater: WaterHeaterState = initialWaterHeaterState(WATER_HEATER);
  private counters: EnergyCounters;
  private actuators: ActuatorStates;
  private lastTs: number | null = null;
  private currentDay = 0;
  private lastOccupiedAt = new Map<string, number>();
  private doorOpenUntil = new Map<string, number>();
  private presence = new Map<string, boolean>();
  /** Room id → the thermostat or heater in it. Scanned once, not per step. */
  private readonly heatingDevices = new Map<string, DeviceSpec>();
  /** The forecast changes once a day; it costs 120 model evaluations to build. */
  private forecastCache: { day: number; days: ForecastDay[] } | undefined;
  private readonly transitions = new Transitions();
  private readonly ghosts = new Ghosts();
  private readonly overrides = new Overrides();
  private readonly gatePulseUntil = new Map<string, number>();
  private readonly roomIds: ReadonlySet<string>;
  /** Room id → the motion sensor in it, so a pulse can be addressed by device. */
  private readonly motionSensors = new Map<string, string>();

  constructor(
    private readonly config: WorldConfig,
    house: House = HOUSE,
  ) {
    this.house = house;
    this.counters = emptyCounters(house);
    this.actuators = initialActuators(house);
    for (const device of house.devices) {
      if (device.room && (device.archetype === "thermostat" || device.archetype === "heater")) {
        this.heatingDevices.set(device.room, device);
      }
    }
    this.roomIds = new Set(house.rooms.map((room) => room.id));
    for (const device of house.devices) {
      if (device.room && (device.archetype === "motion" || device.archetype === "motion_lux")) {
        this.motionSensors.set(device.room, device.id);
      }
    }
  }

  /** The actuator states, which spec 002 will mutate from orders. */
  get actuatorStates(): ActuatorStates {
    return this.actuators;
  }

  /**
   * Rebuild the house at `now` by integrating from local midnight (FR3, FR4).
   * A few hundred coarse steps; by the time it reaches now the initial guess has
   * decayed away, which is exactly the property a first-order model has.
   */
  warmUp(now: number): void {
    const midnight = localMidnight(now, this.config.timezone);
    const weather = this.weatherAtTs(midnight);
    const outdoor = this.outdoorAtTs(midnight, weather);

    this.rooms.clear();
    this.air.clear();
    for (const room of this.house.rooms) {
      this.rooms.set(room.id, {
        temperatureC: initialTemperatureC(room, outdoor.temperatureC),
        heatingOn: room.heating !== "none",
        emittedW: 0,
      });
      this.air.set(room.id, initialAir(room, outdoor.humidityPct));
    }
    this.pool = this.warmUpPool(midnight, outdoor.temperatureC);
    this.waterHeater = initialWaterHeaterState(WATER_HEATER);
    this.counters = emptyCounters(this.house);
    this.currentDay = dayNumber(now, this.config.timezone);
    this.lastOccupiedAt.clear();
    this.doorOpenUntil.clear();
    this.presence.clear();
    this.transitions.clear();
    this.gatePulseUntil.clear();
    // A rebuild crosses a local midnight or a long gap, so the day-scoped
    // overrides go with it. Motion pulses and ghosts are short enough to keep:
    // a visitor who clicked a second before a rebuild should not see it lost.
    this.overrides.clearDayScoped();

    for (let ts = midnight; ts < now; ts += WARMUP_STEP_S * 1000) {
      const next = Math.min(ts + WARMUP_STEP_S * 1000, now);
      this.integrate(next, (next - ts) / 1000);
    }
    this.lastTs = now;
  }

  /**
   * The pool has a time constant of days, so integrating it from local midnight
   * would leave it wherever the initial guess put it. It is cheap to do properly:
   * the sun, the weather and the outdoor temperature are all pure functions of
   * the clock, so the pool can be replayed over its own time constant in a few
   * hundred quarter-hour steps.
   */
  private warmUpPool(midnight: number, outdoorC: number): PoolState {
    const stepS = 900;
    let state: PoolState = {
      waterTemperatureC: initialPoolTemperatureC(this.house.pool, outdoorC),
      heatPumpOn: false,
    };
    for (let ts = midnight - POOL_WARMUP_DAYS * 86_400_000; ts < midnight; ts += stepS * 1000) {
      const weather = weatherAt(ts, this.config.timezone, this.config.seed);
      const outdoor = this.outdoorAtTs(ts, weather);
      const sun = this.sunAt(ts);
      state = stepPool(
        this.house.pool,
        state,
        {
          outdoorC: outdoor.temperatureC,
          windKmh: weather.windKmh,
          solarGainW: poolSolarGainW(this.house.pool, sun, weather.cloudFactor),
          pumpRunning: poolPumpScheduled(localParts(ts, this.config.timezone).minutes),
          setpointC: this.actuators.poolSetpointC,
          coverOpenFraction: shutterOpenFraction(this.actuators, POOL_COVER_DEVICE_ID),
        },
        stepS,
      );
    }
    return state;
  }

  /** Advance to `now` and return what the house looks like. */
  advance(now: number): WorldState {
    if (this.lastTs === null) {
      this.warmUp(now);
      return this.snapshot(now);
    }
    if (dayNumber(now, this.config.timezone) !== this.currentDay) {
      // A new local day: counters restart at midnight, so rebuild rather than
      // carry yesterday's totals across the boundary.
      this.warmUp(now);
      return this.snapshot(now);
    }

    const gapS = (now - this.lastTs) / 1000;
    if (gapS > MAX_CATCHUP_S) {
      this.warmUp(now);
      return this.snapshot(now);
    }
    if (gapS > 0) {
      let ts = this.lastTs;
      while (ts < now) {
        const step = Math.min(WARMUP_STEP_S, (now - ts) / 1000);
        ts += step * 1000;
        this.integrate(ts, step);
      }
      this.lastTs = now;
    }
    return this.snapshot(now);
  }

  // ── The clock, bent only where a visitor bent it ───────────────────────────

  private weatherAtTs(ts: number): WeatherState {
    const { timezone, seed } = this.config;
    return weatherAt(ts, timezone, seed, this.overrides.weatherFor(dayNumber(ts, timezone)));
  }

  /** The household, with any `sim.enter` / `sim.leave` applied. */
  private occupantsAtTs(ts: number): OccupantState[] {
    const { timezone, seed } = this.config;
    const day = dayNumber(ts, timezone);
    return occupantsAt(ts, timezone, this.house, seed).map((occupant) => {
      const forced = this.overrides.occupantForced(occupant.id, day);
      if (forced === undefined || forced === occupant.present) return occupant;
      const spec = this.house.occupants.find((o) => o.id === occupant.id);
      return forced
        ? { ...occupant, place: spec?.bedroom ?? "sejour", present: true, asleep: false }
        : { ...occupant, place: AWAY, present: false, asleep: false };
    });
  }

  /** Rooms count ghosts as people: they light a PIR, breathe and warm the room. */
  private occupancyIncludingGhosts(occupants: OccupantState[], now: number): Map<string, number> {
    const counts = occupancyByRoom(occupants);
    for (const [room, ghosts] of this.ghosts.byRoom(now)) {
      counts.set(room, (counts.get(room) ?? 0) + ghosts);
    }
    return counts;
  }

  /** Advance whatever is travelling and release whatever was pulsed. */
  private stepActuators(now: number, dtS: number): void {
    for (const [deviceId, position] of this.transitions.step(dtS)) {
      if (deviceId in this.actuators.shutters) {
        this.actuators.shutters[deviceId] = position;
        continue;
      }
      const dimmer = this.actuators.dimmers[deviceId];
      if (dimmer) {
        dimmer.brightness = position;
        // A dimmer ramped to zero is a dimmer that has been switched off.
        if (position <= 0) dimmer.on = false;
      }
    }
    for (const [deviceId, until] of this.gatePulseUntil) {
      if (until > now) continue;
      this.actuators.gates[deviceId] = false;
      this.gatePulseUntil.delete(deviceId);
    }
  }

  // ── Orders (spec 002) ──────────────────────────────────────────────────────
  //
  // Each of these changes the world. Nothing publishes: the reading follows on
  // the next tick, because the model changed.

  setRelay(deviceId: string, on: boolean): void {
    if (!(deviceId in this.actuators.relays)) return;
    this.actuators.relays[deviceId] = on;
  }

  setValve(deviceId: string, open: boolean): void {
    if (!(deviceId in this.actuators.valves)) return;
    this.actuators.valves[deviceId] = open;
  }

  setRelayChannel(deviceId: string, index: number, on: boolean): void {
    const channels = this.actuators.relayChannels[deviceId];
    if (!channels || index < 0 || index >= channels.length) return;
    channels[index] = on;
  }

  setDimmerPower(deviceId: string, on: boolean): void {
    const dimmer = this.actuators.dimmers[deviceId];
    if (!dimmer) return;
    dimmer.on = on;
    // Switching a dimmer on with nothing set is a lamp at full, like every
    // real one; switching it off leaves the level alone so the next `on`
    // returns to it.
    this.transitions.start(
      deviceId,
      dimmer.brightness,
      on ? Math.max(dimmer.brightness, 254) : 0,
      DIMMER_RATE_PER_S,
    );
  }

  setDimmerBrightness(deviceId: string, brightness: number): void {
    const dimmer = this.actuators.dimmers[deviceId];
    if (!dimmer) return;
    const target = Math.max(0, Math.min(254, brightness));
    // Setting a level on a dark lamp lights it. That is what every dimmer does.
    if (target > 0) dimmer.on = true;
    this.transitions.start(deviceId, dimmer.brightness, target, DIMMER_RATE_PER_S);
  }

  setShutterPosition(deviceId: string, position: number): void {
    if (!(deviceId in this.actuators.shutters)) return;
    this.transitions.start(
      deviceId,
      this.actuators.shutters[deviceId],
      Math.max(0, Math.min(100, position)),
      SHUTTER_RATE_PCT_PER_S,
    );
  }

  moveShutter(deviceId: string, move: "OPEN" | "CLOSE" | "STOP"): void {
    if (!(deviceId in this.actuators.shutters)) return;
    if (move === "STOP") {
      const stoppedAt = this.transitions.stop(deviceId);
      if (stoppedAt !== undefined) this.actuators.shutters[deviceId] = stoppedAt;
      return;
    }
    this.setShutterPosition(deviceId, move === "OPEN" ? 100 : 0);
  }

  /** A gate order is momentary: the contact closes and releases on its own. */
  pulseGate(deviceId: string, now: number): void {
    if (!(deviceId in this.actuators.gates)) return;
    this.actuators.gates[deviceId] = true;
    this.gatePulseUntil.set(deviceId, now + GATE_PULSE_MS);
  }

  setThermostatPower(deviceId: string, on: boolean): void {
    const thermostat = this.actuators.thermostats[deviceId];
    if (thermostat) thermostat.power = on;
  }

  setThermostatSetpoint(deviceId: string, setpointC: number): void {
    const thermostat = this.actuators.thermostats[deviceId];
    if (thermostat) thermostat.setpointC = setpointC;
  }

  setThermostatMode(deviceId: string, mode: string): void {
    const thermostat = this.actuators.thermostats[deviceId];
    if (!thermostat) return;
    thermostat.operationMode = mode;
    // `off` in the mode is a stop, on the units that report it that way.
    if (mode === "off") thermostat.power = false;
  }

  setPoolSetpoint(setpointC: number): void {
    this.actuators.poolSetpointC = setpointC;
  }

  setHeater(deviceId: string, on: boolean): void {
    if (!(deviceId in this.actuators.heaters)) return;
    this.actuators.heaters[deviceId] = on;
  }

  // ── Simulation orders (spec 002, FR3) ──────────────────────────────────────

  simMotion(deviceId: string, now: number): void {
    this.overrides.pulseMotion(deviceId, now);
  }

  simDoor(deviceId: string, open: boolean, now: number): void {
    if (open) this.overrides.openDoor(deviceId, now);
    else {
      this.overrides.closeDoor(deviceId);
      this.doorOpenUntil.delete(deviceId);
    }
  }

  /**
   * Nudge a room and let the physics take it from there. Nothing is held: the
   * thermal model brings the room back on its own, which is the demonstration.
   */
  simTemperature(roomId: string, temperatureC: number): boolean {
    const thermal = this.rooms.get(roomId);
    if (!thermal) return false;
    this.rooms.set(roomId, { ...thermal, temperatureC });
    return true;
  }

  simWeather(condition: Condition, now: number): void {
    this.overrides.forceWeather(condition, dayNumber(now, this.config.timezone));
    this.forecastCache = undefined;
  }

  simOccupant(occupantId: string, present: boolean, now: number): boolean {
    if (!this.house.occupants.some((o) => o.id === occupantId)) return false;
    this.overrides.setOccupant(occupantId, present, dayNumber(now, this.config.timezone));
    return true;
  }

  simGhost(id: string, room: string, now: number): boolean {
    return this.ghosts.place(id, room, now, this.roomIds);
  }

  /** For the tests and for the 3D application's own view of who is about. */
  get ghostState(): Ghosts {
    return this.ghosts;
  }

  private outdoorAtTs(ts: number, weather: WeatherState): OutdoorState {
    return outdoorAt(
      ts,
      this.config.timezone,
      this.config.latitude,
      this.config.longitude,
      weather,
      this.config.seed,
    );
  }

  private sunAt(ts: number): SunPosition {
    return sunPosition(ts, this.config.latitude, this.config.longitude, this.config.timezone);
  }

  /** Setpoint and enablement a room's heating is running with. */
  private heatingFor(room: Room): { setpointC: number; enabled: boolean } {
    const device = this.heatingDevices.get(room.id);
    if (device?.archetype === "thermostat") {
      const state = this.actuators.thermostats[device.id];
      return { setpointC: state?.setpointC ?? room.setpointC, enabled: state?.power ?? true };
    }
    if (device?.archetype === "heater") {
      return { setpointC: room.setpointC, enabled: this.actuators.heaters[device.id] ?? true };
    }
    return { setpointC: room.setpointC, enabled: room.heating === "trv" };
  }

  /** Beam landing on a room's glazing, W — daylight as well as heat. */
  private beamOnWindowsW(room: Room, sun: SunPosition, cloudFactor: number): number {
    if (!sun.isDay) return 0;
    const beam = clearSkyIrradiance(sun.elevationDeg) * cloudFactor;
    let total = 0;
    for (const window of room.windows) {
      const open = window.shutterDeviceId
        ? shutterOpenFraction(this.actuators, window.shutterDeviceId)
        : 1;
      total +=
        beam * incidenceFactor(ORIENTATION_AZIMUTH[window.orientation], sun) * window.areaM2 * open;
    }
    return total;
  }

  /** One physical step. Everything mutable in the plugin changes here and nowhere else. */
  private integrate(ts: number, dtS: number): void {
    const { timezone, seed } = this.config;
    const { minutes } = localParts(ts, timezone);
    const sun = this.sunAt(ts);
    const weather = this.weatherAtTs(ts);
    const outdoor = this.outdoorAtTs(ts, weather);
    const occupants = this.occupantsAtTs(ts);
    const byRoom = this.occupancyIncludingGhosts(occupants, ts);

    this.stepActuators(ts, dtS);

    this.trackDoors(ts, occupants, outdoor);

    let heatPumpThermalW = 0;
    let electricHeatingW = 0;

    for (const room of this.house.rooms) {
      const thermal = this.rooms.get(room.id);
      const air = this.air.get(room.id);
      if (!thermal || !air) continue;
      const occupantsHere = byRoom.get(room.id) ?? 0;
      if (occupantsHere > 0) this.lastOccupiedAt.set(room.id, ts);

      const heating = this.heatingFor(room);
      const next = stepRoom(
        room,
        thermal,
        {
          outdoorC: outdoor.temperatureC,
          solarGainW: solarGainW(room, sun, weather.cloudFactor, (id) =>
            shutterOpenFraction(this.actuators, id),
          ),
          occupants: occupantsHere,
          setpointC: heating.setpointC,
          heatingEnabled: heating.enabled,
        },
        dtS,
      );
      this.rooms.set(room.id, next);

      if (room.heating === "heater") electricHeatingW += next.emittedW;
      else if (room.heating !== "none") heatPumpThermalW += next.emittedW;

      // A shower puts a lot of water in the air of a small room; a pan puts less
      // in a bigger one.
      const showering = room.id === "salle-de-bain" && occupantsHere > 0;
      const cooking = room.id === "cuisine" && occupantsHere > 0 && minutes >= 18 * 60 + 50;
      this.air.set(
        room.id,
        stepAir(
          room,
          air,
          {
            occupants: occupantsHere,
            outdoorHumidityPct: outdoor.humidityPct,
            moistureBoostPct: (showering ? 38 : 0) + (cooking ? 12 : 0),
          },
          dtS,
        ),
      );
    }

    const poolPumpOn =
      (this.actuators.relays["sim-relay-pool-pump"] ?? true) && poolPumpScheduled(minutes);
    const coverOpen = shutterOpenFraction(this.actuators, POOL_COVER_DEVICE_ID);
    this.pool = stepPool(
      this.house.pool,
      this.pool,
      {
        outdoorC: outdoor.temperatureC,
        windKmh: weather.windKmh,
        solarGainW: poolSolarGainW(this.house.pool, sun, weather.cloudFactor, coverOpen),
        pumpRunning: poolPumpOn,
        setpointC: this.actuators.poolSetpointC,
        coverOpenFraction: coverOpen,
      },
      dtS,
    );

    // The tank is a temperature, not a schedule: the morning showers empty it and
    // the off-peak window has closed by then, which is what leaves the sunny part
    // of the day with something for a surplus to do.
    const showering = byRoom.get("salle-de-bain") ?? 0;
    const inKitchen = byRoom.get("cuisine") ?? 0;
    this.waterHeater = stepWaterHeater(
      WATER_HEATER,
      this.waterHeater,
      {
        ambientC: this.rooms.get("garage")?.temperatureC ?? 15,
        drawLitresPerMinute: showering * DRAW_SHOWER_LPM + (inKitchen > 0 ? DRAW_KITCHEN_LPM : 0),
        suppliedByMains: this.actuators.relays["sim-relay-water-heater"] ?? false,
        solarForced: this.actuators.relays["sim-relay-water-heater-solar"] ?? false,
        offPeak: inOffPeak(minutes),
      },
      dtS,
    );

    const loads = loadPowers({
      ts,
      tz: timezone,
      house: this.house,
      actuators: this.actuators,
      poolHeatPumpOn: this.pool.heatPumpOn,
      waterHeaterHeating: this.waterHeater.heating,
      houseHeatingThermalW: heatPumpThermalW,
      heatPumpCop: heatPumpCop(outdoor.temperatureC),
    });

    const productionW = pvProductionW(this.house, sun, weather.cloudFactor);
    const loadW =
      baseLoadW(this.house, ts, timezone, seed) +
      lightingW(this.house, this.actuators) +
      electricHeatingW +
      Object.values(loads).reduce((sum, w) => sum + w, 0);
    const gridW = loadW - productionW;

    this.counters = accumulate(this.counters, productionW, gridW, loads, dtS);
  }

  /**
   * Doors are opened by people, not by the plugin. The entrance opens on every
   * arrival and departure; the garage opens for the car, which is the first adult
   * out and the last one back; the living-room window is opened on a warm
   * afternoon by whoever is sitting there.
   */
  private trackDoors(ts: number, occupants: OccupantState[], outdoor: OutdoorState): void {
    for (const occupant of occupants) {
      const wasPresent = this.presence.get(occupant.id);
      if (wasPresent !== undefined && wasPresent !== occupant.present) {
        this.doorOpenUntil.set("sim-contact-entree", ts + DOOR_OPEN_S * 1000);
        if (occupant.id === "adulte-1") {
          this.doorOpenUntil.set("sim-contact-garage", ts + 2 * DOOR_OPEN_S * 1000);
        }
      }
      this.presence.set(occupant.id, occupant.present);
    }
    const someoneInSejour = occupants.some((o) => o.place === "sejour");
    if (someoneInSejour && outdoor.temperatureC > 22) {
      this.doorOpenUntil.set("sim-contact-sejour", ts + 60_000);
    }
  }

  private forecastFor(now: number): ForecastDay[] {
    const { timezone, seed, latitude, longitude } = this.config;
    const day = dayNumber(now, timezone);
    if (this.forecastCache?.day === day) return this.forecastCache.days;
    const days = forecast(now, timezone, seed, (dayTs) =>
      outdoorRangeForDay(
        dayTs,
        timezone,
        latitude,
        longitude,
        weatherAt(dayTs, timezone, seed),
        seed,
      ),
    );
    this.forecastCache = { day, days };
    return days;
  }

  private snapshot(now: number): WorldState {
    const { timezone, seed, latitude, longitude } = this.config;
    const sun = this.sunAt(now);
    const weather = this.weatherAtTs(now);
    const outdoor = this.outdoorAtTs(now, weather);
    const occupants = this.occupantsAtTs(now);
    const byRoom = this.occupancyIncludingGhosts(occupants, now);
    const times = sunTimes(now, latitude, longitude, timezone);

    const rooms: Record<string, RoomState> = {};
    for (const room of this.house.rooms) {
      const thermal = this.rooms.get(room.id);
      const air = this.air.get(room.id);
      if (!thermal || !air) continue;
      const here = byRoom.get(room.id) ?? 0;
      const lastSeen = this.lastOccupiedAt.get(room.id) ?? -Infinity;
      const sensor = this.motionSensors.get(room.id);
      const pulsed = sensor !== undefined && this.overrides.motionForced(sensor, now);
      rooms[room.id] = {
        id: room.id,
        temperatureC: thermal.temperatureC,
        humidityPct: air.humidityPct,
        co2Ppm: air.co2Ppm,
        noiseDb: air.noiseDb,
        illuminanceLx: daylightLux(room, this.beamOnWindowsW(room, sun, weather.cloudFactor)),
        occupants: here,
        occupied: pulsed || here > 0 || now - lastSeen < MOTION_HOLD_S * 1000,
        heatingOn: thermal.heatingOn,
      };
    }

    const contactsClosed: Record<string, boolean> = {};
    for (const device of this.house.devices) {
      if (device.archetype !== "contact") continue;
      const openedByTheHousehold = (this.doorOpenUntil.get(device.id) ?? 0) > now;
      contactsClosed[device.id] = !openedByTheHousehold && !this.overrides.doorOpen(device.id, now);
    }

    const loads = loadPowers({
      ts: now,
      tz: timezone,
      house: this.house,
      actuators: this.actuators,
      poolHeatPumpOn: this.pool.heatPumpOn,
      waterHeaterHeating: this.waterHeater.heating,
      houseHeatingThermalW: this.house.rooms
        .filter((r) => r.heating === "thermostat" || r.heating === "trv")
        .reduce((sum, r) => sum + (this.rooms.get(r.id)?.emittedW ?? 0), 0),
      heatPumpCop: heatPumpCop(outdoor.temperatureC),
    });
    const electricHeatingW = this.house.rooms
      .filter((r) => r.heating === "heater")
      .reduce((sum, r) => sum + (this.rooms.get(r.id)?.emittedW ?? 0), 0);

    const productionW = pvProductionW(this.house, sun, weather.cloudFactor);
    const loadW =
      baseLoadW(this.house, now, timezone, seed) +
      lightingW(this.house, this.actuators) +
      electricHeatingW +
      Object.values(loads).reduce((sum, w) => sum + w, 0);
    const gridW = loadW - productionW;

    const appliancesRunning: Record<string, boolean> = {};
    for (const device of this.house.devices) {
      if (device.archetype === "metered_appliance" && device.load) {
        appliancesRunning[device.id] = applianceRunning(now, timezone, device.load);
      }
    }

    return {
      ts: now,
      sun,
      sunrise: times.sunrise,
      sunset: times.sunset,
      weather,
      outdoor,
      forecast: this.forecastFor(now),
      rooms,
      pool: {
        waterTemperatureC: this.pool.waterTemperatureC,
        setpointC: this.actuators.poolSetpointC,
        heatPumpOn: this.pool.heatPumpOn,
        coverOpenFraction: shutterOpenFraction(this.actuators, POOL_COVER_DEVICE_ID),
      },
      waterHeater: this.waterHeater,
      occupants,
      contactsClosed,
      energy: {
        productionW,
        loadW,
        gridW,
        voltageV: gridVoltageV(gridW),
        loads,
        counters: this.counters,
        inverterOffline: !sun.isDay,
      },
      actuators: this.actuators,
      appliancesRunning,
      ghostCount: this.ghosts.count(now),
    };
  }
}

export { AWAY, emitterMaxW, MOTION_HOLD_S };

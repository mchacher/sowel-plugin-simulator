# Spec 001 — Implementation plan

Branch: `feat/world-model`. Conventional commits, scopes from `CLAUDE.md`
(`world`, `occupants`, `environment`, `thermal`, `energy`, `devices`, `manifest`, `ci`).

Steps run in order. Each one leaves `npm run validate` green — the world model is
written before anything touches Sowel, which is the point of the module boundary.

## Steps

- [ ] **S1 — `house/`**: the types and the house description. No behaviour, just the
      data of `architecture.md`. Rooms, windows, occupants, device instances.
- [ ] **S2 — `world/random.ts` + `world/clock.ts`**: seeded PRNG with per-subject
      derivation; local midnight and timezone helpers; the tick scheduler with its
      overrun-skip rule.
- [ ] **S3 — `world/sun.ts`**: solar elevation, azimuth, sunrise, sunset.
- [ ] **S4 — `world/weather.ts` + `world/outdoor.ts`**: daily condition, cloud factor,
      rain, wind, five-day forecast; outdoor temperature and humidity.
- [ ] **S5 — `world/occupants.ts`**: agendas to positions, entrance transitions.
- [ ] **S6 — `world/thermal.ts`**: the per-room integration and the midnight warm-up.
- [ ] **S7 — `world/air.ts`**: CO₂, indoor humidity, noise.
- [ ] **S8 — `world/energy.ts`**: PV, base load, appliances, flexible loads with
      their relays and their clamps, grid, counters integrated from midnight. Sizing
      from `architecture.md` — the arbiter needs a surplus larger than its loads.
- [ ] **S8b — `world/pool.ts`**: the pool's water temperature, integrating on a time
      constant of days from sun, outdoor, evaporation and the pool heat pump.
- [ ] **S9 — `world/world.ts`**: compose into `WorldState`.
- [ ] **S10 — `publish/catalogue.ts`**: the archetype declarations, with the two audit
      constraints commented against their issues.
- [ ] **S11 — `publish/instances.ts`**: house description to the concrete instance list.
- [ ] **S12 — `publish/publisher.ts`**: discovery at start, first values, then the
      cadence- and change-gated updates; PV inverter status at the two crossings.
- [ ] **S13 — `src/index.ts`**: wiring and the tick. `executeOrder` stays a `debug` log.
- [ ] **S14 — `manifest.json`**: the seed and fallback-location settings.
- [ ] **S15 — docs**: `docs/specs-index.md` row (same commit as the spec folder), and
      phase 1 flipped to 🚧 in the showroom project map.
- [x] **S16 — core issue**: `"simulator"` missing from `DeviceSource` in
      `mchacher/sowel` — filed as [#937](https://github.com/mchacher/sowel/issues/937).
      Not blocking; the plugin passes `"simulator"` and does not wait for it.

## Test plan

Every scenario below gets a Vitest test next to its module. The `world/` tests need no
Sowel and no clock beyond an injected instant.

| Module       | Scenario                                                 | Expected                                                                                           |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `random`     | Same seed and subject, twice                             | Identical sequences                                                                                |
| `random`     | Two subjects, same day                                   | Independent, uncorrelated sequences                                                                |
| `clock`      | Local midnight across a DST boundary in `home.timezone`  | 23 h and 25 h days handled, no drift                                                               |
| `clock`      | A tick handler that overruns its interval                | Next tick skipped, one `debug` line, no queue                                                      |
| `sun`        | Known date and location against published almanac values | Elevation within a degree, sunrise within a couple of minutes                                      |
| `sun`        | Polar latitude in winter                                 | Elevation stays negative all day; no NaN                                                           |
| `weather`    | Same day, twice                                          | Same condition and cloud series                                                                    |
| `weather`    | Condition vs. rain probability                           | `sunny` near 0, `rainy` between 60 and 95 (AC via catalogue)                                       |
| `weather`    | Forecast                                                 | Five entries, starting tomorrow; no day 0                                                          |
| `outdoor`    | A clear day                                              | Minimum near sunrise, maximum around 15:00                                                         |
| `outdoor`    | Overcast vs. clear, same day                             | Overcast has the smaller amplitude                                                                 |
| `occupants`  | A weekday morning                                        | Everyone leaves within their window; entrance contact opens each time                              |
| `occupants`  | Wednesday                                                | `adulte-2` is home, in `bureau`                                                                    |
| `occupants`  | Saturday                                                 | Nobody leaves for work; wake-up is later                                                           |
| `thermal`    | A step change in outdoor temperature                     | Room follows with its own τ, gradually — **AC4**                                                   |
| `thermal`    | Sun on a south window, shutter open then closed          | Solar gain present, then absent                                                                    |
| `thermal`    | Warm-up from midnight vs. an already-running model       | Converge to within a tenth of a degree by mid-morning                                              |
| `thermal`    | A thermostat's room                                      | Temperature chases the setpoint with overshoot, never snaps — **AC4/FR6**                          |
| `air`        | An occupied closed room                                  | CO₂ climbs into 900–1400 ppm                                                                       |
| `air`        | The room empties                                         | CO₂ decays to baseline over roughly half an hour — **AC5 neighbour**                               |
| `air`        | After the morning shower                                 | Bathroom humidity spikes then decays                                                               |
| `energy`     | Clear summer day                                         | PV energy in a plausible band of nominal peak — **AC6**                                            |
| `energy`     | Overcast winter day                                      | A small fraction of it — **AC6**                                                                   |
| `energy`     | Night                                                    | Production exactly 0 — **AC6**                                                                     |
| `energy`     | Every tick of a simulated day                            | `grid === load − production`; negative when exporting — **AC7**                                    |
| `energy`     | A simulated day                                          | `energy_forward` never decreases; `energy` is always a delta — **AC8**                             |
| `energy`     | Restart at 15:00                                         | Counters continue rather than reset — **AC8/FR3**                                                  |
| `energy`     | A flexible load switched on                              | Grid moves by its draw within one tick; its own clamp reports that draw — **AC7b**                 |
| `energy`     | Clear day at nominal peak                                | Export exceeds the largest flexible load for a usable window — **AC7c**                            |
| `energy`     | The water heater                                         | Two distinct relay instances, main and solar, neither declaring anything solar-specific — **FR9b** |
| `pool`       | An hour of pool heat pump                                | Water moves by a fraction of a degree, never a degree — **AC7d**                                   |
| `pool`       | A clear summer week, heat pump off                       | Water still warms, from surface solar gain alone                                                   |
| `pool`       | A cold night                                             | Water loses to outdoors and evaporation, slowly                                                    |
| `catalogue`  | Every archetype declaration                              | Matches `docs/devices.md` key for key, category for category — **AC2**                             |
| `catalogue`  | Every declaration                                        | No key from `PROHIBITED_KEYS` — **AC10**                                                           |
| `catalogue`  | The dimmable light                                       | `brightness` bounded 0–254, not 0–100 (#933)                                                       |
| `catalogue`  | The metered appliance                                    | `appliance_state` has exactly two values (#936)                                                    |
| `publisher`  | `start()` with a fake `DeviceManager`                    | Every instance declared, then every instance carries a value, before the first tick — **AC1**      |
| `publisher`  | An unchanged reading within its cadence                  | Not republished                                                                                    |
| `publisher`  | Live power                                               | Every second; counters every minute — **FR10**                                                     |
| `publisher`  | Sunset then sunrise                                      | PV inverter goes `offline` then `online` — **AC9**                                                 |
| `publisher`  | A payload with an undeclared key                         | Refused, logged, never sent                                                                        |
| `index`      | A world model that throws mid-tick                       | Logged with `{ err }`, the tick loop survives — **FR13**                                           |
| `index`      | An order arriving                                        | `debug` line, nothing published — **spec 002 boundary**                                            |
| whole plugin | Two starts at the same instant, same seed                | Identical published payloads — **AC3**                                                             |

## Manual gate, before the PR is presented

Installed on a local stock Sowel instance through a personal source (core spec 136):

1. The device list fills within a second of enabling the plugin.
2. Bind a handful by hand: a probe, a PIR, the grid clamp, the PV inverter.
3. Zone aggregation shows a temperature and a motion state.
4. Energy Live moves, and the grid goes negative around midday on a clear simulated day.
5. The water heater, the pool pump and their clamps are all present and bindable — the
   arbiter has loads to arbitrate as soon as spec 002 lets them be switched.

That is the phase-1 gate in the project map, minus the parts specs 002 and 003 carry.

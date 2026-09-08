# Spec 001 — Architecture

## The shape in one paragraph

A **pure world model** that, given an instant and a seed, returns a `WorldState` — every
temperature, every occupancy, every watt in the house. Around it, a thin **publication
layer** that maps that state onto the devices of `docs/devices.md` and pushes them
through Sowel's `DeviceManager`. The model imports nothing from Sowel and is tested
without it; the publication layer is where the plugin API lives, and it holds no
physics.

The plugin's own tick is one second. What is published at any given tick is decided by
cadence and by change, not by the tick.

## Module map

```
src/
  index.ts                 plugin lifecycle, wiring, the tick loop
  sowel-api.ts             the API slice (already present)

  house/
    types.ts               Room, Window, Occupant, DeviceSpec, House
    house.ts               THE HOUSE — the description itself (FR1)

  world/
    random.ts              seeded PRNG, derived per day and per subject
    clock.ts               tick scheduling, local midnight, timezone handling
    sun.ts                 elevation, azimuth, sunrise, sunset
    weather.ts             daily condition, cloud factor, rain, wind, 5-day forecast
    outdoor.ts             outdoor temperature and humidity
    occupants.ts           agendas → which room each occupant is in at t
    thermal.ts             per-room first-order integration
    air.ts                 CO₂, indoor humidity, noise
    energy.ts              PV, base load, appliances, flexible loads, grid
    world.ts               composes all of the above into a WorldState

  publish/
    catalogue.ts           archetype → discovery declaration (the catalogue, in code)
    instances.ts           house description → the concrete device instance list
    publisher.ts           discovery at start; cadence- and change-gated updates
```

`world/` never imports from `publish/` or `sowel-api.ts`. That rule is what makes
every physical claim in the spec testable in milliseconds.

## The house description (FR1)

`house/house.ts` exports one `House` object. It is the contract spec 003 reads to
remap the fixture, and the contract phase 3 reads to draw the plan.

### Rooms

Twelve, over two levels, plus the outdoors. Each carries a floor area, a thermal time
constant, an initial setpoint, and its windows with their orientation.

| id                | Name            | Level | Windows      | Note                                    |
| ----------------- | --------------- | ----- | ------------ | --------------------------------------- |
| `entree`          | Entrée          | 0     | —            | the way in and out                      |
| `sejour`          | Séjour          | 0     | S, W (large) | the room the demo opens on              |
| `cuisine`         | Cuisine         | 0     | E            | cooking, dishwasher                     |
| `bureau`          | Bureau          | 0     | N            | one adult works from home on Wednesdays |
| `wc`              | WC              | 0     | —            |                                         |
| `garage`          | Garage          | 0     | —            | unheated, laundry lives here            |
| `palier`          | Palier          | 1     | —            |                                         |
| `chambre-parents` | Chambre parents | 1     | S            |                                         |
| `chambre-1`       | Chambre 1       | 1     | E            |                                         |
| `chambre-2`       | Chambre 2       | 1     | W            |                                         |
| `salle-de-bain`   | Salle de bain   | 1     | N (small)    | humidity spike after the shower         |
| `terrasse`        | Terrasse        | 0     | —            | outdoor, tracks the outdoor model       |

`jardin` is not a room: it is the outdoors, and it is where an occupant is when
they are neither home nor away. **The pool is not a room either** — it is a body of
water with its own thermal model, described below.

### Occupants

Two adults and two children, on weekday and weekend agendas with a few minutes of
seeded variation per day. Leaving and returning passes through `entree` and opens the
entrance contact.

| id         | Weekday                                                       | Weekend          |
| ---------- | ------------------------------------------------------------- | ---------------- |
| `adulte-1` | leaves ≈ 08:10, back ≈ 18:30                                  | home, late riser |
| `adulte-2` | leaves ≈ 08:40, back ≈ 17:15; home all Wednesday, in `bureau` | home             |
| `enfant-1` | leaves ≈ 07:50, back ≈ 17:00                                  | home             |
| `enfant-2` | leaves ≈ 08:00, back ≈ 16:45                                  | home             |

Inside the house, an occupant's room follows a routine: bedroom overnight, kitchen at
breakfast, bathroom for the shower, living room in the evening. The routine is a
function of the hour and the occupant, not a state machine — FR3 forbids state that
cannot be recomputed from the clock.

### Devices

Around sixty instances, every one of them an archetype from `docs/devices.md`.

| Archetype                                | Instances                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Motion sensor                            | `entree`, `cuisine`, `palier`, `salle-de-bain`, `garage`, `wc`                   |
| Motion + light level                     | `sejour`, `bureau`                                                               |
| Door / window contact                    | entrance door, living-room French window, garage door                            |
| Temperature / humidity probe             | `sejour`, `bureau`, `chambre-parents`, `chambre-1`, `chambre-2`, `salle-de-bain` |
| Indoor air quality                       | `sejour`                                                                         |
| Button / remote                          | `entree`                                                                         |
| Relay / light                            | one per room (12)                                                                |
| Multi-channel relay                      | terrace and garden lighting (4 channels)                                         |
| Dimmable light                           | `sejour`, `chambre-parents`                                                      |
| Shutter                                  | `sejour` ×2, `cuisine`, `bureau`, `chambre-parents`, `chambre-1`, `chambre-2`    |
| Gate                                     | the driveway gate                                                                |
| Water valve                              | garden irrigation                                                                |
| Heat pump / thermostat                   | `sejour`                                                                         |
| Electric heater                          | `salle-de-bain`, `bureau`                                                        |
| Pool heat pump                           | the pool                                                                         |
| Grid clamp                               | the mains                                                                        |
| PV inverter                              | the roof                                                                         |
| Relay — flexible load                    | water heater (main), water heater (**solar input**, spec 152), pool pump         |
| Sub-load clamp                           | heat pump, water heater, pool pump, pool heat pump, kitchen                      |
| Metered appliance                        | dishwasher, washing machine                                                      |
| Outdoor module / rain gauge / wind gauge | the weather station                                                              |
| Forecast                                 | `Weather Forecast`                                                               |
| Occupant                                 | the four occupants                                                               |

Nothing in the code depends on those counts. The catalogue is written per archetype,
so one shutter or ten cost the same.

### Device identity

A device's identity, for Sowel, is `discovered.friendlyName` — it becomes
`source_device_id`, and that is what a binding resolves against. So it must be stable
forever, and it is a **technical slug**: `sim-<archetype>-<room>`, e.g. `sim-pir-sejour`,
`sim-shutter-chambre-1`, `sim-grid`, `sim-pv`.

Display names are not the plugin's business. `upsertFromDiscovery` preserves the name
of a device that already exists, so the fixture (spec 003) carries "Détecteur Séjour"
and the plugin never overwrites it. On a bare instance with no fixture, the slug shows,
which is the correct trade: legible bindings beat a pretty first screen.

## The world model

### Determinism (FR2)

`random.ts` is a seeded PRNG (mulberry32 over a FNV hash). Seeds are derived, never
shared: `seed(dayNumber, subject)`. Today's weather, today's occupant jitter and
today's cloud noise are three independent streams that each replay identically.

There is one global seed, a plugin setting, defaulting to a fixed value. Changing it
gives a different but equally reproducible house.

### Reconstruction rather than persistence (FR3)

Nothing is written to disk. Two consequences shape the code:

- **Room temperatures** are a state that integrates, and integration needs a start.
  At `start()`, `thermal.ts` runs a warm-up: it integrates from local midnight to now
  in coarse steps, from a seasonal initial guess. A few hundred steps, well under a
  second, and by the time it reaches "now" the initial guess has decayed away — which
  is exactly the property a first-order model has.
- **Cumulative energy counters** (`energy_forward`, `energy_reverse`) are integrated
  from local midnight the same way, so they are monotonic within a day across a
  restart. The `energy` category is a per-interval delta and needs no such care.

### Sun and weather

`sun.ts` implements the standard solar position algorithm — declination, equation of
time, hour angle — from `home.latitude` / `home.longitude`, read through
`settingsManager`. Spec 111 lists those in `GLOBAL_READABLE_KEYS`, so a plugin may
read them; it does not guarantee they are set, hence the documented fallback.

`weather.ts` draws a condition for the day from a season-weighted distribution over
the catalogue's closed vocabulary, then walks it through the day so a `cloudy` morning
can become a `rainy` afternoon. It exposes a **cloud factor** in [0, 1] that `energy.ts`
multiplies PV by and `outdoor.ts` subtracts amplitude from. One source, so the sky, the
temperature and the production always agree — a demo showing full production under
reported rain is worse than no demo.

### Thermal

Per room, per step:

```
dT/dt = (T_out − T_in) / τ + solarGain / C + occupantGain / C + heatingInput / C
```

`τ` and `C` come from the house description. `solarGain` is non-zero only when the sun
is above the horizon, its azimuth faces one of the room's windows, and that room's
shutter is open — shutters are read from the actuator state, which in this spec is
always the initial one and in spec 002 becomes live. `occupantGain` is a flat watt
figure per occupant present.

A thermostat's own measured temperature is its room's temperature, so the chase and
overshoot of FR6 fall out of the model rather than being faked on top of it.

### Energy

```
production = pvPeak · bell(sunElevation) · cloudFactor
load       = baseLoad(hour) + lighting + Σ appliances + heatPump + Σ flexibleLoads
grid       = load − production            (signed; negative is export)
```

Appliances are agenda-driven intervals with a power profile, publishing `power`,
`energy` and `appliance_state` — binary, two values, while core issue
[#936](https://github.com/mchacher/sowel/issues/936) is open.

#### Sizing, so that there is something to arbitrate

These figures are in the house description and they are not decoration: an arbiter with
no surplus, or with a surplus smaller than its smallest load, demonstrates nothing.

|                              | Nominal                           | Why this value                                                                                                                                                                                    |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PV inverter                  | **6 kWc**                         | A clear midday must export well past the largest single flexible load, with room for two grants at once. 3 kWc would make the whole arbitration surface a flat line.                              |
| Base load                    | ~300 W floor, ~600 W evening      | A plausible French household floor.                                                                                                                                                               |
| Water heater                 | **2 400 W**                       | The reference deferrable load of spec 140.                                                                                                                                                        |
| Pool pump                    | **750 W**                         | The load whose synchronised yo-yo against the water heater is the exact failure spec 140 exists to fix. Two loads at 3 150 W against a 4 kW midday surplus is a real contest, which is the point. |
| Pool heat pump               | **1 500 W**                       | Comfort-ish, and slow: it is what makes the pool water move.                                                                                                                                      |
| House heat pump              | 0–2 000 W, from the thermal model | Draw follows the model rather than a schedule.                                                                                                                                                    |
| Dishwasher / washing machine | ~2 000 W in bursts                | Background load: never arbitrated, only seen through the meter.                                                                                                                                   |

#### Flexible loads, and why each has both a relay and a clamp

Spec 140 reserves a granted load's **measured** draw when a `power` binding exists,
and falls back to a learned or declared nominal when it does not. The demo should show
the first path, so every flexible load carries its own sub-load clamp.

And it carries a relay, because a load that cannot be switched is not flexible. The
first draft of this spec metered the water heater and the pool pump and gave neither a
way to be turned off, which would have produced a convincing bar chart and an arbiter
with nothing to arbitrate.

The water heater carries **two** relays. Core spec 152 models the real case — the
appliance stays on permanent mains and its own programme decides normal heating, while
a separate dry-contact input forces it to heat on surplus. Those are two distinct
physical relays, and spec 152 is explicit that nothing at discovery tells them apart,
so the solar role is assigned by hand. The plugin therefore publishes two ordinary
relays and declares nothing solar-specific; the fixture binds one as the equipment's
main on/off and the other to its "Solaire" role.

In this spec the relays exist, are published, and are read by the energy model. They
are never switched — spec 002 delivers that, and with it the whole arbitration story.

### The pool

The pool is a body of water, not a room, and it integrates like one with a very long
time constant:

```
dT/dt = (T_out − T_water) / τ_pool + solarSurface / C_pool + heatPump / C_pool − evaporation / C_pool
```

`τ_pool` is measured in **days**. That is the property worth showing: an hour of heat
pump on surplus moves the water by a fraction of a degree, and an afternoon of it is
visible on the chart. A pool that warmed a degree an hour would be a swimming pool
nobody has ever owned, and it would quietly teach a visitor the wrong thing about
what an arbiter does.

Its devices are the pool heat pump (`pool_water_temperature`, outdoor temperature,
`pool_temperature_setpoint`) and the pool pump, which is a plain relay with a clamp —
the textbook deferrable load, and the one spec 140 opens on.

## The publication layer

### Catalogue in code

`publish/catalogue.ts` holds one function per archetype returning its
`DiscoveredDevice` — keys, categories, types, units, bounds, enum vocabularies — exactly
as `docs/devices.md` specifies. It is the only place those literals appear.

The two constraints the plugin audit left on the catalogue are encoded here, each with
its issue in a comment so it is removed rather than forgotten:

- brightness on the Zigbee **0–254** scale while [#933](https://github.com/mchacher/sowel/issues/933) is open;
- `appliance_state` **binary** while [#936](https://github.com/mchacher/sowel/issues/936) is open.

### Publishing (FR4, FR10)

`start()` declares every instance through `upsertFromDiscovery`, then immediately
publishes a first `updateDeviceData` for each. Only then does the tick begin.

The tick computes a `WorldState` and hands it to the publisher, which emits a reading
when **either** its cadence has elapsed **or** it changed past a per-category
threshold. Motion, contacts, buttons and appliance state are change-only; live power
is every second; counters every minute; the environment every few minutes.

The PV inverter's status is driven through `updateDeviceStatus` at the sunset and
sunrise crossings (FR12).

### Guard rails

- A published payload is asserted against the archetype's declaration in development
  and in tests: an undeclared key is a bug, not a surprise reading.
- A `PROHIBITED_KEYS` list (`linkquality`, `power_on_behavior`, `nanoe`, …) is asserted
  empty by a test, so FR11 cannot rot.

## Contracts with Sowel

| What the plugin uses                                                          | Notes                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `deviceManager.upsertFromDiscovery(integrationId, source, discovered)`        | Called for every instance during `start()`.                                              |
| `deviceManager.updateDeviceData(integrationId, sourceDeviceId, payload, ts?)` | The one publication path.                                                                |
| `deviceManager.updateDeviceStatus(integrationId, sourceDeviceId, status)`     | Only for the PV inverter, only at the two crossings.                                     |
| `settingsManager.get("home.latitude" \| "home.longitude" \| "home.timezone")` | The three keys spec 111 lets a plugin read outside its own namespace.                    |
| `settingsManager.get("integration.simulator.*")`                              | Seed and a small number of knobs.                                                        |
| Spec 111 scoped deps                                                          | Every device written has `integrationId === "simulator"`. Nothing here fights the Proxy. |

### One cross-repository item

`DeviceSource` in the core's `src/shared/types.ts` is a closed union and has no
`"simulator"` member. At runtime this is harmless — the column is plain `TEXT` with no
constraint, and the UI's label map falls back to the raw string — so the plugin passes
`"simulator"` and it works today. It is nevertheless a value the core should name.

Filed as [mchacher/sowel#937](https://github.com/mchacher/sowel/issues/937). It does not
block this spec and the plugin does not wait for it.

## What the file changes look like

| File                                          | Change                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/house/*`, `src/world/*`, `src/publish/*` | New.                                                                                                |
| `src/index.ts`                                | Wires the model to the publisher, owns the tick, keeps `executeOrder` a `debug` log until spec 002. |
| `src/sowel-api.ts`                            | Unchanged — the slice already carries everything needed.                                            |
| `manifest.json`                               | The seed setting and the fallback location; version bump at release.                                |
| `docs/specs-index.md`                         | The row for this spec.                                                                              |
| Showroom project map                          | Phase 1 flips to 🚧.                                                                                |

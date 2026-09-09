# Spec 001 — The house that lives

**Status**: ✅ Implemented
**Phase**: 1 of the [showroom project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md) — first of its three specs
**Depends on**: [`docs/devices.md`](../../docs/devices.md) (the device catalogue, merged in #6)

## Context

The showroom needs a Sowel instance whose data belongs to nobody and is nevertheless
alive: temperatures that move, people who come home, a sun that rises, panels that
produce. Phase 1 of the project map builds that as an ordinary integration plugin.

Phase 1 is split into three specs, because it carries most of the project's weight:

| Spec    | What it delivers                                         | Its gate                                                                 |
| ------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **001** | The world model and the devices it publishes. Read-only. | Zones fill up, Energy Live moves, on a stock instance.                   |
| 002     | Order execution, `sim.*` orders, per-target debounce.    | The motion-light recipe fires on a simulated occupant.                   |
| 003     | The fixture remap script.                                | The demo fixture imports on a stock instance and every binding resolves. |

This one is the world. It publishes; it does not yet listen.

## Goals

- A deterministic, real-time model of one house: sun, weather, outdoor temperature,
  a thermal model per room, occupants on an agenda, air quality, PV and household
  loads.
- Publication of that model as ordinary Sowel devices, exactly to the catalogue in
  `docs/devices.md` — right keys, right categories, right cadence.
- A house that is **already alive at t = 0**: everything declared and carrying a
  plausible value within a second of `start()`, from any moment of any day.
- A world model that is **pure and testable without Sowel**: given a clock and a
  seed, it returns numbers. The Sowel-facing layer is a thin adapter over it.

## Non-goals

| Not here                                                               | Where                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Executing orders — a light that turns on, a shutter that moves         | Spec 002. Orders arriving now are logged at `debug` and ignored.                                                                  |
| `sim.*` simulation orders, ephemeral presence, ghosts                  | Spec 002.                                                                                                                         |
| Per-target debounce                                                    | Spec 002 — it only means something once orders act.                                                                               |
| Rewriting the anonymised fixture                                       | Spec 003.                                                                                                                         |
| Simulated hardware faults: flat batteries, offline devices, stale data | Project map, later phase. The one exception is the PV inverter going offline at night, which is normal behaviour and not a fault. |
| Writing InfluxDB history, backfilling the past                         | Impossible from a plugin and not wanted — project map decision.                                                                   |
| Any accelerated or replayed clock                                      | Project map decision: real time only.                                                                                             |

## Functional requirements

### FR1 — One house description, one source of truth

The house — its rooms, their thermal properties, their windows and orientations, the
devices in them, and the household living there — is declared in **one place in the
repository**, as data. Nothing else in the plugin hard-codes a room name, a device
name or a device key.

That description is what spec 003 reads to remap the fixture, and what the 3D
application will read in phase 3. It is a contract, not an implementation detail.

The initial house is roughly a dozen zones over two levels, described in
`architecture.md`. Adding a room or a lamp must be an edit to that description alone.

### FR2 — Deterministic given the clock

Given the same wall-clock instant and the same seed, the model returns the same
values. Randomness exists — an occupant leaves a few minutes early, a cloud passes —
but it is drawn from a seeded generator keyed on the day, never from `Math.random()`.

The same calendar day replays identically. A restart mid-afternoon reconstructs the
same afternoon rather than a different one.

### FR3 — The model reconstructs itself from the clock, and holds no persistent state

There is no state file and no database. At `start()`, the model is computed for the
current instant: rooms at their plausible temperature, occupants where the agenda puts
them, energy counters integrated from local midnight.

This is what makes FR4 possible and what makes a nightly restart harmless.

### FR4 — Alive at t = 0

Every device is declared through discovery **during `start()`**, not on the first
poll, and carries a first published value immediately after.

This is deliberate and it is the opposite of what most integrations do: five of the
six polled plugins in the fleet declare their devices inside the first poll, so
nothing exists until it succeeds. A demo cannot open on an empty house.

### FR5 — Environment

- **Sun**: elevation and azimuth from `home.latitude`, `home.longitude` and the
  current instant. Those three settings are readable by a plugin under spec 111; when
  absent, a documented fallback location is used and the fact is logged once at `warn`.
- **Weather**: a condition drawn per day from the season, evolving through the day,
  taken from the catalogue's closed vocabulary. It drives a cloud factor that
  modulates PV and outdoor temperature, and a rain series that agrees with it.
- **Outdoor temperature**: a seasonal baseline plus a diurnal cycle whose minimum is
  near sunrise and whose maximum is around three in the afternoon, shifted by the
  weather.
- **Forecast**: five days from tomorrow, consistent with today's season. There is no
  day 0.

### FR6 — Thermal model per room

Each room has a first-order model: it loses heat towards outdoors at a rate set by its
own inertia, gains it from the sun through its windows when they face the sun, gains
it from occupants, and gains it from its heating when that heating is on.

For this spec no heating is ever on — orders arrive in 002 — so the model runs with
its heating input held at the value the house description gives as an initial
setpoint. What matters here is that the **plumbing is in place**: a room's temperature
is a state that integrates, not a number drawn from a curve.

A thermostat device's measured temperature **chases** its setpoint with lag and slight
overshoot; it never snaps to it. When its unit is off, the room drifts towards
outdoors.

### FR7 — Occupants, and how presence reaches Sowel

The household follows weekday and weekend agendas, with small seeded variation.
Leaving and returning goes through the entrance, which opens its door contact.

**Presence reaches Sowel through the motion sensors, not through the occupant
devices.** An occupant device is not in a zone — it moves between them — so it is not
something a person binds to an equipment. What a person binds is a PIR in a room, and
that PIR fires because an occupant is in that room. Occupant devices are published as
well, for the 3D application and for debugging, under the `generic` category.

A PIR reports occupancy while a room is occupied, and clears it after a hold time
once the room empties, like a real one.

### FR8 — Air quality follows occupation

CO₂ sits near outdoor level in an empty closed room and climbs while it is occupied,
decaying over roughly half an hour once it empties. Humidity spikes in the bathroom
after a shower. Noise follows occupation. Ranges are in the catalogue.

### FR9 — Energy

```
production = pvPeak · bell(sunElevation) · cloudFactor
load       = baseLoad(hour) + lighting + Σ appliances + heatPump + Σ flexibleLoads
grid       = load − production            (signed; negative is export)
```

- **PV**: a bell tied to sun elevation, zero before sunrise and after sunset, clipped
  at the inverter's nominal peak, multiplied by the weather's cloud factor. The peak
  is sized so the house **actually exports** on a clear day — see FR9b.
- **Base load**: a household floor with a plausible daily shape.
- **Appliances**: driven by the agenda — cooking in the evening, the dishwasher after
  it, laundry on Saturday. Each publishes its own power, its own energy and its
  `appliance_state`.
- **Flexible loads**: a water heater, a pool pump and a pool heat pump, each with its
  own sub-load clamp. FR9b says why each one is there and what it takes to make it
  arbitrable.
- **Grid**: load minus production, **signed** — negative means export.
- **The `energy` category carries a delta, never a cumulative counter.** Cumulative
  totals go under `energy_forward` and `energy_reverse`, which are monotonic within a
  day because they are integrated from local midnight (FR3).

### FR9b — What the capacity arbiter needs, and which spec provides it

The energy arbiter (core spec 140) is the hardest thing in Sowel to show and the best
reason for the demo to exist. It is worth naming exactly what it needs from the
simulated world, because two of the four items were missing from the first draft of
this spec.

The arbiter is **the only reader of the grid meter**. It smooths the signed power over
sixty seconds and keeps `availableSurplusW = smoothedExport + Σ granted`, so that the
collapse in export caused by its own grant does not read as the surplus disappearing.
Recipes claim watts; the user's priority list orders them; the arbiter grants; the
**recipes** act — in phase 1 of spec 140 the arbiter issues no orders itself.

| What the arbiter needs                                                                                                                                                                                    | Where it comes from                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A grid clamp publishing **signed** power every second, that reacts within its EMA window when a load switches                                                                                             | **This spec.** The grid is computed from the model each tick, so switching a load moves it immediately.                                                         |
| A **per-load power clamp** on every flexible load — the arbiter reserves a granted load's _measured_ draw when a `power` binding exists, and falls back to a learned or declared nominal when it does not | **This spec.** One sub-load clamp per flexible load, which is the difference between the arbiter demonstrating reservation accounting and the arbiter guessing. |
| Loads that are actually **switchable**, and whose draw changes when they are switched                                                                                                                     | **Spec 002.** This spec publishes the relays and the model reads their state; it just never receives an order to change it.                                     |
| Consumer **recipes** that claim capacity, and a user priority list                                                                                                                                        | **The demo fixture** (spec 003 and phase 2). Open question 1 of the project map.                                                                                |

Two consequences for the device list, both corrections to the first draft:

- **A flexible load needs its relay, not only its clamp.** The first draft metered the
  water heater and the pool pump and gave neither a way to be switched. Measuring a
  load nobody can turn off is not a flexible load; it is a bar chart. Each one now has
  a relay device of its own.
- **The water heater carries two relays, not one.** Core spec 152 models the real case:
  the appliance stays on permanent mains and its own programme decides normal heating,
  while a _separate_ dry-contact input forces it to heat on surplus. Those are two
  distinct physical relays, and nothing at discovery distinguishes them — the spec is
  explicit that the solar role is assigned by hand and never guessed. So the plugin
  publishes two ordinary relays and declares nothing solar-specific; the fixture binds
  one to the equipment's main on/off and the other to its "Solaire" role. This is the
  catalogue's own principle holding up under pressure: the category is the contract,
  and the meaning is the equipment layer's business.

### FR9c — The pool

The pool is in the house because it is the clearest demonstration of a deferrable load
and because its physics are unusually legible on a chart: tens of cubic metres of water
have a time constant measured in **days**, not minutes.

- **Pool water temperature** is a state that integrates like any room, with a very long
  time constant: it loses heat to outdoors and to evaporation, gains it from direct sun
  on the surface, and gains it from the pool heat pump when that is running.
- **The pool heat pump** publishes `pool_water_temperature`, its outdoor temperature
  and its `pool_temperature_setpoint`, per the catalogue.
- **The pool pump** is a plain relay with its own clamp — the textbook deferrable load
  of spec 140's own examples, and the one that made the case for the arbiter in the
  first place.

A visitor watching the pool warm by a fraction of a degree over an afternoon of surplus
sees, in one number, what an arbiter is for.

### FR10 — Cadence, taken from the real installation

| What                                                        | How often         |
| ----------------------------------------------------------- | ----------------- |
| Live power (`power`, `voltage`, `current`)                  | every second      |
| Energy counters                                             | every minute      |
| Temperature, humidity, CO₂, noise, pressure, outdoor module | every few minutes |
| Forecast                                                    | a few times a day |
| Motion, contacts, buttons, appliance state                  | on the event      |

Anything faster is noise the WebSocket carries to every visitor, multiplied by the
number of visitors.

### FR11 — Publish nothing a user would not look at

No `linkquality`, no `power_on_behavior`, no `keep_time`, no vendor vocabulary — the
catalogue's two prohibitions, restated because they are the easiest to violate by
accident. Roughly half the readings in the reference installation are that noise.

### FR12 — A PV inverter goes offline at night

Rather than publishing 0 W, it reports `offline` after sunset and `online` at sunrise.
That is what the real one does and what the energy pages are written for.

### FR13 — Never throw, never block

No handler and no tick throws. Failures are logged with `{ err }` and the tick
continues; a tick that overruns is skipped, never queued.

## Acceptance criteria

- [x] AC1 — Installed on a stock Sowel instance, the plugin declares its full device
      list within a second of start, each with a value.
- [x] AC2 — Every published key, category, type, unit and bound matches
      `docs/devices.md`. A test asserts the declarations against the catalogue.
- [x] AC3 — Starting the plugin twice at the same simulated instant with the same seed
      produces identical readings.
- [x] AC4 — Room temperatures integrate: a step change in outdoor temperature moves
      them gradually, with a time constant per room, not instantly.
- [x] AC5 — Occupancy in a room is true while the agenda puts an occupant there and
      clears after the hold time once it does not.
- [x] AC6 — Over a simulated clear summer day, PV energy is within a plausible band of
      the inverter's nominal peak; over a simulated overcast winter day it is a small
      fraction of it. Both are zero at night.
- [x] AC7 — Grid power equals load minus production at every tick, and is negative
      when production exceeds load.
- [x] AC7b — Switching a flexible load on moves grid power by that load's draw within
      one tick, and its own sub-load clamp reports that draw. This is what the
      arbiter's reservation accounting reads.
- [x] AC7c — On a clear day at the nominal peak, export exceeds the largest flexible
      load's nominal draw for a usable window — otherwise there is nothing to arbitrate.
- [x] AC7d — Pool water temperature integrates on a time constant of days: an hour of
      heat pump moves it by a fraction of a degree, never by a degree.
- [x] AC8 — `energy_forward` never decreases within a day, and `energy` is always a
      per-interval delta.
- [x] AC9 — The PV inverter's device status is `offline` between sunset and sunrise.
- [x] AC10 — No published key appears in the catalogue's prohibition list.
- [x] AC11 — `npm run validate` is green; the world model's tests need no Sowel.

## Edge cases

| Case                                                     | Expected                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.latitude` / `home.longitude` unset                 | Fall back to the documented default location, log once at `warn`, keep running. Spec 111 allows reading them; it does not guarantee they exist.                             |
| Plugin restarted at 15:00                                | The house is at 15:00: rooms warm, occupants placed by the agenda, counters integrated from midnight. Not a cold house at 20 °C everywhere.                                 |
| Restart crossing local midnight                          | Daily counters reset at local midnight, computed in `home.timezone`.                                                                                                        |
| A tick takes longer than its interval                    | Skip, log at `debug`, never queue. A backlog of ticks is a slow-motion house.                                                                                               |
| A day with no sun above the horizon, or a polar latitude | PV stays at zero and the inverter stays offline. No division by zero, no NaN.                                                                                               |
| Two occupants in the same room                           | One PIR, occupancy true. CO₂ climbs faster.                                                                                                                                 |
| An order arrives                                         | Logged at `debug`, ignored. Spec 002 gives it meaning.                                                                                                                      |
| A device the catalogue does not define                   | Refused at declaration by the catalogue assertion, not published.                                                                                                           |
| An overcast winter week                                  | Export may never occur. The arbiter correctly grants nothing; the demo is dull but not wrong. The seed and the fallback location are chosen so this is not the common case. |
| The pool heat pump and the pool pump both drawing        | Both appear on their own clamps and both in the grid. The arbiter's job is exactly to order them; the simulator never arbitrates on its behalf.                             |

---

## Amendment — 2026-09-09: the pool cover and the thermodynamic tank

Two of the physical models were built from a reading of the reference fixture.
The maintainer corrected them against the installation they describe. Both
corrections make the demo less dramatic and more true, which is the trade this
project is supposed to make.

### The water heater is a heat pump, not a resistance

FR9b sized it at 2 400 W on the assumption of a resistive element. It is a
**thermodynamic tank**: roughly 600 W drawn for 1 800 W of heat.

And its surplus input does not switch it on — it **raises its target**, from 55 °C
to 62 °C. Those seven kelvin are the storage: about 2 kWh of heat for 0.7 kWh
drawn, reached in some ninety minutes of surplus. The separate 230 V contact that
does it is exactly the dry contact core spec 152 models, and exactly the second
relay the plugin already publishes.

This shrinks the arbiter's largest deferrable load from 2 400 W to 600 W, so
**AC7c is re-read rather than failed**: the surplus has to exceed the largest
flexible load, and at 6 kWc it exceeds all of them together. The contest the
arbiter arbitrates is now the pool heat pump (1 500 W), the pool pump (750 W) and
the tank (600 W) — 2 850 W against a midday surplus above 4 kW. Still a contest,
and a truer one.

### The pool has a cover, and a cover is a thermal input

FR9c gave the pool water, a heat pump and a pump. It is missing the thing that
dominates its heat balance: **evaporation**, and the cover that stops it.

A new `pool_cover` archetype declares exactly what a shutter declares — the core
resolves a `pool_cover` equipment through the same branch of
`computeBindingCandidates` and aliases `pool_cover_move` to the same `state`, so
there is nothing to add on the contract side. It is a separate archetype only
because it is a separate thing in the model:

| Closed cover | Effect                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Evaporation  | Down to 15 %, and the surface is sheltered from the wind as well as the air                                        |
| Convection   | Down to 60 % — the cover itself still radiates                                                                     |
| Solar gain   | Down to 45 % — a translucent cover is a greenhouse, which is why a covered pool in July warms rather than stalling |

Measured: a ten-hour night at 13 °C with a 14 km/h wind costs the water **2.1 K
uncovered and 0.9 K covered**, as evaporation falls from about 5 000 W to under
600 W. That is what makes closing the cover at dusk an energy decision rather than
a tidy one, and it gives the demo a recipe worth watching.

Nothing else in the spec changes. The acceptance criteria hold, with AC7d now read
against a cover whose position the model honours.

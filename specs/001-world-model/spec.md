# Spec 001 — The house that lives

**Status**: 📝 Draft
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

- **PV**: a bell tied to sun elevation, zero before sunrise and after sunset, clipped
  at the inverter's nominal peak, multiplied by the weather's cloud factor.
- **Base load**: a household floor with a plausible daily shape.
- **Appliances**: driven by the agenda — cooking in the evening, the dishwasher after
  it, laundry on Saturday. Each publishes its own power, its own energy and its
  `appliance_state`.
- **Flexible loads**: a water heater and a pool pump, which the capacity arbiter
  (core spec 140) can be given surplus to allocate in a later spec.
- **Grid**: load minus PV, **signed** — negative means export.
- **The `energy` category carries a delta, never a cumulative counter.** Cumulative
  totals go under `energy_forward` and `energy_reverse`, which are monotonic within a
  day because they are integrated from local midnight (FR3).

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

- [ ] AC1 — Installed on a stock Sowel instance, the plugin declares its full device
      list within a second of start, each with a value.
- [ ] AC2 — Every published key, category, type, unit and bound matches
      `docs/devices.md`. A test asserts the declarations against the catalogue.
- [ ] AC3 — Starting the plugin twice at the same simulated instant with the same seed
      produces identical readings.
- [ ] AC4 — Room temperatures integrate: a step change in outdoor temperature moves
      them gradually, with a time constant per room, not instantly.
- [ ] AC5 — Occupancy in a room is true while the agenda puts an occupant there and
      clears after the hold time once it does not.
- [ ] AC6 — Over a simulated clear summer day, PV energy is within a plausible band of
      the inverter's nominal peak; over a simulated overcast winter day it is a small
      fraction of it. Both are zero at night.
- [ ] AC7 — Grid power equals load minus production at every tick, and is negative
      when production exceeds load.
- [ ] AC8 — `energy_forward` never decreases within a day, and `energy` is always a
      per-interval delta.
- [ ] AC9 — The PV inverter's device status is `offline` between sunset and sunrise.
- [ ] AC10 — No published key appears in the catalogue's prohibition list.
- [ ] AC11 — `npm run validate` is green; the world model's tests need no Sowel.

## Edge cases

| Case                                                     | Expected                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.latitude` / `home.longitude` unset                 | Fall back to the documented default location, log once at `warn`, keep running. Spec 111 allows reading them; it does not guarantee they exist. |
| Plugin restarted at 15:00                                | The house is at 15:00: rooms warm, occupants placed by the agenda, counters integrated from midnight. Not a cold house at 20 °C everywhere.     |
| Restart crossing local midnight                          | Daily counters reset at local midnight, computed in `home.timezone`.                                                                            |
| A tick takes longer than its interval                    | Skip, log at `debug`, never queue. A backlog of ticks is a slow-motion house.                                                                   |
| A day with no sun above the horizon, or a polar latitude | PV stays at zero and the inverter stays offline. No division by zero, no NaN.                                                                   |
| Two occupants in the same room                           | One PIR, occupancy true. CO₂ climbs faster.                                                                                                     |
| An order arrives                                         | Logged at `debug`, ignored. Spec 002 gives it meaning.                                                                                          |
| A device the catalogue does not define                   | Refused at declaration by the catalogue assertion, not published.                                                                               |

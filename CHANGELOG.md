# Changelog

All notable changes to this plugin. Versions follow semver; the registry in `mchacher/sowel` carries the SHA256 of each released tarball.

## Unreleased

**A cloud passes.** `sim.cloud` (seconds) shades the sun for a while and gives the day
its sky back: production, daylight and solar gains dip and return. For the showroom's
"un nuage passe".

**A radiator is on a pilot wire.** The fixture's heater recipe releases the relay for
comfort and energises it for eco; the simulator took the relay for an on/off switch,
so walking into a child's room turned its radiator off. The relay now signals the
mode (eco = comfort − 3.5 K, no signal = comfort), and the heater publishes
`heating`, its run state.

**The demo's timeouts, for the second journeys.** Dimmable motion lights off in 5 s,
presence heaters back to eco in 30 s; each radiator equipment binds `heating`. The
fixture no longer carries the legacy `history.influx.*` settings, a token among them.

## v0.4.1

**A sensor and a recipe in the bathroom.** For the showroom's first guided journey: a
visitor walks into the bathroom and a motion-light recipe switches the lamp on,
whatever the time of day. 85 equipments, 22 recipe instances.

**Motion lights go off in seconds.** The plain motion-light instances time out after
5 s, and the simulated PIR clears 5 s after a room empties: a visitor sees the lamp go
off behind them instead of two minutes later. A ghost sent `away` leaves at once
instead of lingering in its last room until it expires.

## v0.4.0

**History, at last.** Live readings no longer carry a source timestamp: the plugin
passed the world's clock in milliseconds where the core reads seconds, and InfluxDB
refused every point — the showroom had accrued no history since phase 1. And the grid
meter's `energy` delta is signed, drawn minus returned (core spec 086), so the core's
self-consumption split sees what is exported.

**The house's past.** `node dist/history/cli.js` computes thirty days of the house
as a Sowel backup's history files, from the same model, with habits standing in for
Sowel's automation, in about six seconds (spec 004). The showroom restores them with
the fixture, so a visitor opens full charts. A test pins the output against a backup
a live Sowel exported.

**6 kWc.** Twelve 500 W panels, back to the architecture's first sizing; 4 kWc was
weak on the running demo.

## v0.3.0

**A pavilion, not a tower.** The demo house is now a ground floor and one storey
with the garage attached at the side — fourteen rooms instead of sixteen, and the
cellar and the workshop are gone with their six devices. The real house has four
levels; drawn in three dimensions that is a tower nobody can read, and the 3D view
(`sowel-house-3d`) is the drawing of _this_ house. `scripts/fixture/reshape.ts`
does it to the backup before anything is derived: two zones dropped with
everything in them, two level zones folded into the one above, the stairwell
filed under the ground floor. Areas and window orientations in `layout.ts` are
the plan's, so the physics runs on the rooms a visitor sees.

The device ids of every remaining room are unchanged, and so are the bindings.

**4 kWc, not 6.** Eight 500 W panels on the south slope — the array the 3D view
draws. Still more than the three deferrable loads together at midday, which is the
contest the arbiter is there to show.

**Doors that say where they are.** The gate and the garage door each carry a
contact on their own equipment, which is where the core reads a gate's state from:
the motor's pulse opens or shuts them, an open gate closes itself after ninety
seconds, and the car takes the gate when an adult drives in or out.

**A WC, and three lights.** A WC off the hall with a lamp, a motion sensor and the
motion-light instance the cellar lost. A light in the study, the first child's
bedroom and the bathroom, where the real house has none. 84 equipments, 21 recipe
instances.

**A house that answers like hardware.** One debounce window of 300 ms for every
target — three seconds swallowed a visitor's second click. An order's echo goes out
at once rather than on the next tick, and a dimmer switched off keeps its level:
both were letting a motion-light recipe mistake its own orders for a hand on the
switch.

## v0.2.0

The first version that simulates anything. Phase 1 of the
[showroom project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md),
across three specs.

**A house that lives.** Sixteen rooms over four levels, four occupants on weekday
and weekend agendas, a pool, and ninety-two devices — every one an archetype from
[`docs/devices.md`](docs/devices.md). Sun and weather, a first-order thermal model
per room, a thermodynamic water heater, PV and household loads. It is alive at
t = 0 and holds no state on disk: the model is rebuilt by integrating from local
midnight, so a restart at three in the afternoon gives a house that is at three in
the afternoon.

**A house that obeys.** Every order in the catalogue, with the echo coming from
the next tick rather than from inside the order — a shutter travels, a dimmer
ramps, a gate pulses. Plus the `sim.*` orders a visitor acts through
(`sim.motion`, `sim.open`/`sim.close`, `sim.temperature`, `sim.weather`,
`sim.enter`/`sim.leave`, `sim.ghost`), ghosts that count as people and expire two
minutes after the last click, and a three-second per-target debounce so ten hands
cannot make one lamp flicker.

**A demo house.** `scripts/fixture/build.ts` turns the core's anonymised showroom
backup into a fixture this plugin drives: archetypes and rooms derived from the
fixture itself, bindings re-pointed by category, the vendor vocabulary dropped,
the `sim.*` orders bound so something can call them, and the energy arbiter
enrolled with three flexible loads and a recipe to claim them.

Walked on a stock Sowel 1.68.0: `sim.motion` in the cellar fires the motion-light
recipe and the journal attributes the lamp to it; a forced sunny sky has the
arbiter grant the water heater its surplus and the recipe close its 230 V contact.

### For anyone installing it

The device ids are the contract — `friendlyName` becomes `source_device_id`, which
is what a binding resolves against. They are stable from this version on.

- Repository scaffold: plugin skeleton, CI, release workflow, hooks, skills.

# Changelog

All notable changes to this plugin. Versions follow semver; the registry in `mchacher/sowel` carries the SHA256 of each released tarball.

## Unreleased

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

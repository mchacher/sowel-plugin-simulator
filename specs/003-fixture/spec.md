# Spec 003 — The demo house

**Status**: ✅ Implemented — built, restored on a stock Sowel 1.68.0, phase 1 gate walked
**Phase**: 1 of the [showroom project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md) — last of its three specs
**Builds on**: [001](../001-world-model/) (the world and its devices), [002](../002-orders/) (orders and the `sim.*` orders)

## Context

Specs 001 and 002 give a house that lives and obeys, but a bare Sowel with the
plugin installed has sixty-seven devices and nothing bound to them: no zones, no
equipments, no recipes, no modes. Every screenshot in this project so far was
taken after binding five things by hand.

The project map decided where the demo home comes from: **the core's anonymised
showroom fixture**, so that the demo _is_ the shape of a real Sowel home — same
zones, same equipment types, same recipes and modes. This spec is the script that
turns that fixture into one the simulator can drive.

## What the fixture actually contains

Measured, not assumed (`scripts/analyse-fixture.py`):

|                                            |                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Zones                                      | 22, four levels deep — RDC, Étage 1, Étage 2, Sous-sol, Extérieur |
| Equipments                                 | 74                                                                |
| Devices                                    | 96, across ten integrations                                       |
| Data / order bindings                      | 206 / 69                                                          |
| Recipe instances                           | 21, over ten recipe types                                         |
| Modes                                      | 3 — Lumière jour / soir / nuit                                    |
| Dashboard widgets, charts, button bindings | 12 / 2 / 10                                                       |

**Every one of the seventy-four equipments now maps onto a simulator archetype
mechanically**, from its type and from the categories its bindings actually resolve
to — seventy-three onto a device, and the TV onto the decision to drop it. Nothing
is guessed:

```
relay 15 · motion 14 · button 10 · shutter 10 · motion_lux 4 · dimmer 3
subload_clamp 2 · thermostat 2 · heater 2 · gate 2 · valve 2
pv 1 · grid_clamp 1 · forecast 1 · outdoor_module 1 · pool_heat_pump 1 · th_probe 1
```

That derivation is the whole reason this spec is small. A `sensor` is a PIR when
its bindings carry `motion`, a PIR with a light level when they also carry
`luminosity`, and a probe when they carry `temperature` — the fixture says which,
so no one has to remember.

## Goals

- One command turns the core's `showroom-fr.zip` into a backup that restores onto
  a stock Sowel and comes up **fully alive**, driven by the simulator, with every
  binding resolved.
- The house description grows to mirror the fixture, so the physics and the
  fixture describe the same building.
- The `sim.*` orders are bound to equipments, because that is the only way they
  can be called (spec 002).
- Nothing personal survives that the core's own anonymiser did not already remove.

## Non-goals

| Not here                                           | Where                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Anonymising a production backup                    | The core's `scripts/doc/build-fixtures.py` already does it, and this consumes its output.                                        |
| Hosting, the proxy, guest login, the nightly reset | Phase 2, `sowel-showroom`.                                                                                                       |
| The 3D plan and its room mapping                   | Phase 3. This spec makes the equipment ids it will need stable.                                                                  |
| Rewriting the recipes                              | They are kept as they are. Shortening their timeouts for demonstration is the map's open question 1 and a tuning pass, not this. |

## Functional requirements

### FR1 — The house description grows to the fixture

`src/house/house.ts` gains the rooms the fixture has and this house does not:
`cave`, `atelier`, `escalier`, a third child's bedroom, `piscine`, `jardin`, and
the `sous-sol` level. Its device list grows to one device per fixture equipment.

This is the direction the map already chose, and spec 001 was built for it: the
catalogue is written per archetype, so one shutter or ten cost the same, and
adding a room is an edit to the description alone.

**The physics must stay honest through the growth.** A cellar is cold and stable,
a workshop is unheated, a staircase is a corridor. Each new room needs its own
loss coefficient and capacity, not a copy of the living room's.

### FR2 — The remap is derived, never hand-listed

The script reads the fixture and, for every equipment:

1. resolves its **archetype** from its type and its bindings' categories;
2. resolves its **room** from the zone tree;
3. allocates the matching simulator device id;
4. rewrites the fixture's `devices`, `device_data` and `device_orders` rows to the
   simulator's keys and categories;
5. re-points `data_bindings` and `order_bindings` at the rewritten rows.

A hand-written mapping table of seventy-four rows would be wrong within a month.
A derivation that fails loudly on anything it cannot place is right for ever.

### FR3 — Nothing is left dangling

The script **fails** rather than producing a fixture that half works:

- an equipment whose archetype it cannot derive;
- a binding whose device row it did not rewrite;
- a recipe instance or a button binding naming an equipment that no longer exists;
- a device with no bindings left pointing at it.

A demo that comes up with three broken cards teaches the visitor that Sowel is
broken.

### FR4 — The vendor vocabulary goes

The fixture's thermostat bindings name `targetTemperature`, `insideTemperature`,
`nanoe` and `ignitionCount`. Reused unchanged they would force the simulator to
publish Panasonic and MCZ vocabulary to make them resolve.

The rewrite maps every key to the catalogue's and **drops the bindings with no
counterpart**. A simulated Panasonic that does not talk to Panasonic is a lie
about what is being demonstrated.

### FR5 — The simulation orders are bound

Spec 002 established that Sowel has no device-level order route: the only way to
reach a plugin is `POST /equipments/:id/orders/:alias`. So the fixture must carry
the order bindings, or the 3D application has nothing to call.

Every motion sensor gets `sim.motion`, every contact `sim.open` / `sim.close`,
every probe and thermostat `sim.temperature`, the weather station `sim.weather`,
each occupant `sim.enter` / `sim.leave`, and a house-level equipment `sim.ghost`.

### FR6 — The rest of the backup

| Table                                                          | What happens                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `zones`, `modes`, `zone_mode_impacts`, `calendar_*`            | Kept as they are. This is the shape of a real home and the reason for using the fixture at all.                                 |
| `recipe_instances`, `recipe_state`                             | Kept, with their equipment references re-pointed.                                                                               |
| `dashboard_widgets`, `chart_configs`, `button_action_bindings` | Kept and re-pointed; dropped individually when they name something that is gone.                                                |
| `plugins`                                                      | Everything replaced by the simulator alone. Twenty integration rows for hardware that is not there would show twenty red cards. |
| `users`, `api_tokens`, `refresh_tokens`                        | Empty. The showroom's proxy owns the guest session (phase 2).                                                                   |
| `settings`                                                     | Kept, minus every `integration.*`; `home.latitude` / `longitude` / `timezone` kept, because the simulator reads them.           |
| `mqtt_*`, `notification_*`                                     | Empty already, and stay so.                                                                                                     |

## Acceptance criteria

- [x] AC1 — `npx tsx scripts/fixture/build.ts <showroom-fr.zip>` produces a
      backup that restores onto a stock Sowel without error.
- [x] AC2 — After restore with the plugin installed, every equipment reports
      `online` and carries data within a minute.
- [x] AC3 — Zero orphaned bindings, recipes, widgets or button bindings.
- [x] AC4 — No published key is vendor vocabulary; the catalogue's prohibition
      list is empty across the whole fixture.
- [x] AC5 — Ordering a light from the interface changes it; ordering a shutter
      makes it travel.
- [x] AC6 — `sim.motion` on a living-room sensor fires the motion-light recipe,
      and the journal says why the lamp came on. **This is the phase 1 gate.**
- [x] AC7 — Energy Live shows production, consumption and a signed grid, and the
      arbiter has at least two flexible loads to contend over.
- [x] AC8 — The script fails loudly on a fixture it cannot fully map.

## Decisions, answered 2026-09-09

**The pool cover is simulated.** It costs about twenty lines on the contract side —
a `pool_cover` equipment resolves through the same branch of
`computeBindingCandidates` as a shutter, and the core aliases `pool_cover_move` to
the same `state`, so the archetype declares exactly what a shutter declares. The
work that mattered was the physics: a closed cover cuts the pool's evaporation to
15 % and more than halves its overnight loss. Done in the
[spec 001 amendment](../001-world-model/spec.md).

**The demo house gains a water heater**, and it is a thermodynamic tank modelled on
the maintainer's own: 600 W drawn for 1 800 W of heat, target 55 °C, and a separate
230 V surplus contact that takes the target to 62 °C rather than switching the tank
on. Also done in that amendment.

That one has a consequence for this spec. **The fixture must gain a `water_heater`
equipment the real house does not have** — a deliberate, recorded departure from
"the shape of the real home", taken so the demo can show the spec 152 solar channel
and the clearest deferrable load there is. It is the one equipment in the demo house
that is not in the real one, and it should stay the only one.

**The TV is dropped.** `docs/devices.md` already put media players out of scope —
cheap to fake, demonstrates nothing about a home-automation engine — and core issue
[#932](https://github.com/mchacher/sowel/issues/932) says a freshly bound one has no
power control anyway. The fixture's `media_player` equipment and its device go, and
the simulator gains no archetype for it.

## Still open

One.

### The recipe timeouts

The map's own open question 1. Twenty-one recipe instances carry production
timeouts — a motion light that holds for ten minutes is right in a house and far
too slow in a demo where a visitor watches for thirty seconds. Shortening them is
a tuning pass over the fixture, and which ones to shorten is a judgement about
what the demo should show.

## Edge cases

| Case                                                         | Expected                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| The core's fixture changes shape                             | The derivation adapts; anything it cannot place fails the build (FR3).                            |
| Two fixture equipments in one room map to the same archetype | Both get devices — `sim-pir-garage-1`, `sim-pir-garage-2`. The garage really does have four PIRs. |
| A binding whose device row was dropped                       | The binding is dropped with it, and its absence is reported, not silent.                          |
| A recipe instance left with no equipment                     | The whole instance is dropped and named in the report.                                            |
| Restoring onto an instance that already has data             | The core's restore replaces everything; that is its contract, not this script's.                  |

---

## Amendments

### 2026-09-09 — TypeScript, not Python

`architecture.md` chose Python, by analogy with the core's own
`scripts/doc/build-fixtures.py`. Written in TypeScript instead, for one reason that
outweighs matching the core's choice of language: the builder has to know the
catalogue — every archetype's keys, categories, bounds and vocabularies — and in
TypeScript it **imports** it. In Python it would have had a second copy, and a
second copy of the thing this whole project exists to keep single is the one
mistake worth avoiding here.

The zip is read by shelling out to `unzip -p`, so no dependency was added.

### 2026-09-09 — the arbiter had to be enrolled, not preserved

The fixture was exported in May; core spec 140 is dated August. Its `equipments`
table has no `energy_profile` column, so preserving it faithfully meant shipping a
demo whose arbitration surface was switched off.

Three things were therefore **added**, in the same spirit as the occupants and the
`sim.*` bindings:

- energy profiles on the three deferrable loads, and the arbiter enabled, with a
  priority order that puts the water heater first (its stored kelvin are the only
  surplus still there tomorrow) and the pool pump above the pool heat pump (which
  is interlocked on it, so granting the heat pump first would buy nothing);
- the `water-heater-solar` recipe and one instance on the tank, because spec 140
  is explicit that the arbiter issues no orders — without a claimant the enrolled
  loads sit idle for ever and the surface lists things that never happen;
- uniform columns on every table, because the core's restore reads its column list
  from the first row of each table and silently drops the rest
  ([#939](https://github.com/mchacher/sowel/issues/939)).

The verifier refuses to emit a fixture missing any of the three.

### 2026-09-09 — what the real instance found

Two defects, neither visible without restoring onto a running Sowel.

**Three profiles restored as three nulls**, for the reason above. The arbiter came
up `enabled: true, state: active, loads: []` — on, with nothing to arbitrate, and
nothing anywhere saying why.

**The pool pump looked like a hand on a wall switch.** The arbiter's journal read
`suspended | Pompe Piscine | wall-switch-on`, and it was right to: the simulator
was running the pump on an internal schedule, and a load drawing power the arbiter
never granted is indistinguishable from a human override. The schedule was mine to
remove — the pump's hours in this house are a Sowel recipe's — and it is gone
(spec 001's own amendment).

### 2026-09-11 — the demo house is a pavilion

The fixture describes a real house: four levels, a cellar and a workshop under the
garage, two children's rooms on a second floor. Drawn in three dimensions that is
a tower, and phase 3 found that a tower cannot be read — the storey above hides the
one below, and a visitor asking what the kitchen is doing has to peel three floors
off first. The user's call: a simple house, a ground floor and one storey, with a
garage door worth showing.

So the builder reshapes the backup **before** deriving anything
(`scripts/fixture/reshape.ts`):

- `Atelier` and `Cave` go, with their six equipments, their bindings and the two
  motion-light instances that named them. A motion light with its lamp removed is
  not a recipe with fewer lamps.
- `Sous-sol` folds into `RDC` and `Etage 2` into `Etage 1`: children re-parented,
  every `zone_id` and every zone id inside a recipe's params or a widget's config
  rewritten, duplicate mode impacts collapsed, the level zone deleted.
- `Escalier` moves under `RDC`, because the stairs start in the hall.

Fourteen rooms, 68 equipments, 20 recipe instances. `layout.ts` now carries the 3D
plan's areas and orientations (`sowel-house-3d/scripts/plan/showroom.ts`), so the
house the physics runs on and the house a visitor sees are one house. FR1's "the
house description grows to the fixture" still holds — it grows to the fixture
_as reshaped_, and the reshape is the one place the demo house departs from the
real one, on record.

## The phase 1 gate, walked

On a stock Sowel 1.68.0 in Docker: instance wiped, plugin installed, fixture
restored, recipe packages sideloaded (the container sits behind a TLS-intercepting
proxy and cannot reach GitHub; the host can).

|                                |                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices / equipments           | 92 / 86, all `online`, zero bindings without a value                                                                                                                                                                                                                   |
| Recipe instances               | 21 of 22 started — the twenty-second is disabled in the fixture                                                                                                                                                                                                        |
| A light ordered                | changes; a shutter ordered travels 100 → 0 over 25 s                                                                                                                                                                                                                   |
| **`sim.motion` in the cellar** | occupancy true → **the motion-light recipe fires** → the lamp comes on, attributed to `Motion Light` in the journal, and released 105 s later by the recipe's own timeout                                                                                              |
| **Solar surplus**              | sky forced sunny → surplus climbs −85 → 808 W → arbiter **grants** the tank → the recipe closes the 230 V contact → the compressor draws 600 W → export falls −832 → −235 W while `availableSurplusW` only moves 808 → 696, because the arbiter reserved its own grant |

That last row is the one worth keeping. The reservation accounting spec 140 exists
for is legible in four numbers, on a house that belongs to nobody.

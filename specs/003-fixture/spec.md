# Spec 003 — The demo house

**Status**: 📝 Draft — the design is derived, three decisions are open
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

**Seventy-two of the seventy-four equipments map onto a simulator archetype
mechanically**, from their type and from the categories their bindings actually
resolve to. Nothing is guessed:

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

- [ ] AC1 — `python3 scripts/build-demo-fixture.py <showroom-fr.zip>` produces a
      backup that restores onto a stock Sowel without error.
- [ ] AC2 — After restore with the plugin installed, every equipment reports
      `online` and carries data within a minute.
- [ ] AC3 — Zero orphaned bindings, recipes, widgets or button bindings.
- [ ] AC4 — No published key is vendor vocabulary; the catalogue's prohibition
      list is empty across the whole fixture.
- [ ] AC5 — Ordering a light from the interface changes it; ordering a shutter
      makes it travel.
- [ ] AC6 — `sim.motion` on a living-room sensor fires the motion-light recipe,
      and the journal says why the lamp came on. **This is the phase 1 gate.**
- [ ] AC7 — Energy Live shows production, consumption and a signed grid, and the
      arbiter has at least two flexible loads to contend over.
- [ ] AC8 — The script fails loudly on a fixture it cannot fully map.

## Open decisions

Three, and none of them is mine to take.

### 1. The two equipments that do not map

| Equipment                        | Situation                                                                                                                                                                                                                                  | Options                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Volet Piscine** (`pool_cover`) | It has no bindings at all in the fixture — an equipment with nothing behind it.                                                                                                                                                            | Give the simulator a `pool_cover` archetype (a second shutter, essentially), or drop the equipment. |
| **TV** (`media_player`)          | `docs/devices.md` puts media players out of scope: cheap to fake, demonstrates nothing about a home-automation engine. Core issue [#932](https://github.com/mchacher/sowel/issues/932) also says a freshly bound one has no power control. | Drop it, or add the archetype and let the demo show the bug.                                        |

### 2. There is no water heater in the fixture

The arbitration story in spec 001 (FR9b) is built on a water heater: 2 400 W,
deferrable, with the separate solar input core spec 152 models. **The real house
has no water heater equipment**, so the fixture has none either.

Without one, the arbiter has the pool pump and the pool heat pump to contend over,
which works but loses the clearest case — and loses the spec 152 solar channel
entirely, since that only exists on `water_heater` and `switch`.

Options: add a water heater to the demo house (a small, deliberate departure from
"the shape of the real home"), or accept a thinner arbitration story.

### 3. The recipe timeouts

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

# Spec 003 — Implementation plan

Blocked on the three open decisions in `spec.md`. The analysis is done and shipped
(`scripts/analyse-fixture.py`); the rest waits on the pool cover, the media player,
and whether the demo house gains a water heater.

## Steps

- [x] **S0 — the analyser**: read a backup, derive each equipment's archetype and
      room, report what does not map. Shipped with this spec.
- [ ] **S1 — the house generator**: fixture → rooms and devices, written into the
      generated half of `src/house/house.ts`, with the hand-written half (thermal
      properties, windows, occupants, sizing) left alone.
- [ ] **S2 — the device rewrite**: `devices`, `device_data`, `device_orders` to the
      catalogue, keeping row ids where a key survives.
- [ ] **S3 — the binding re-point**: keep what survives, drop what does not, report
      every drop by key.
- [ ] **S4 — the additions**: occupants and `sim-house`, their equipments, and the
      `sim.*` order bindings without which nothing can call them.
- [ ] **S5 — the prune**: plugins, users, tokens, integration settings.
- [ ] **S6 — the verifier**: fail on an orphaned binding, recipe, widget or button
      binding, and on any prohibited key.
- [ ] **S7 — the physics pass**: thermal properties for the rooms the fixture adds
      — a cellar is cold and stable, a workshop is unheated, a staircase is a
      corridor. Not a copy of the living room's.
- [ ] **S8 — the real instance**: restore onto a stock Sowel in Docker with the
      plugin installed, and walk the phase 1 gate.

## Test plan

| Module      | Scenario                                 | Expected                                                                                                             |
| ----------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `analyse`   | The current fixture                      | 72 of 74 derived, the two named ones reported                                                                        |
| `derive`    | A `sensor` with motion and luminosity    | `motion_lux`                                                                                                         |
| `derive`    | A `sensor` with temperature and humidity | `th_probe`                                                                                                           |
| `derive`    | An equipment type it has never seen      | Fails, names it — **AC8**                                                                                            |
| `rewrite`   | The thermostat                           | `targetTemperature` → `setpoint`, `insideTemperature` → `temperature`, `nanoe` and `ignitionCount` dropped — **FR4** |
| `rewrite`   | Every device row                         | `source` = `simulator`, no `ieee_address`, no `raw_expose`                                                           |
| `bindings`  | Every surviving binding                  | Resolves to a rewritten row — **AC3**                                                                                |
| `bindings`  | A dropped key                            | The binding goes, and the report names it                                                                            |
| `additions` | Motion sensors                           | Each carries a `sim.motion` order binding — **FR5**                                                                  |
| `prune`     | The output                               | No users, no tokens, no integration settings, one plugin                                                             |
| `verify`    | A deliberately broken input              | Fails rather than emitting — **AC8**                                                                                 |
| whole       | The output backup                        | No key from `PROHIBITED_KEYS` anywhere — **AC4**                                                                     |

## The gate, on a real instance

1. `docker compose -f docker-compose.docs.yml down -v && up -d`, install the
   plugin, restore the built fixture.
2. Every equipment `online` and carrying data within a minute — **AC2**.
3. Order a light: it changes. Order a shutter: it travels — **AC5**.
4. Fire `sim.motion` in the living room: the motion-light recipe runs, the lamp
   comes on, and the journal says why — **AC6, the phase 1 gate**.
5. Energy Live shows production, consumption and a signed grid — **AC7**.

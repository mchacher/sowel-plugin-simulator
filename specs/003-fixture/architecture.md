# Spec 003 — Architecture

## Two scripts, one of which already exists

```
scripts/
  analyse-fixture.py       shipped with this spec — reads a backup and reports
                           what it holds in simulator terms. The derivation,
                           printed, so nobody has to remember it.
  build-demo-fixture.py    NEW — the same derivation, applied
```

Python, not TypeScript. It is a build-time tool over a JSON document, it runs on a
maintainer's machine and never inside Sowel, and the core's own
`scripts/doc/build-fixtures.py` — whose output this consumes — is Python too.

## The derivation

For each equipment in the fixture:

```
archetype = f(equipment.type, categories its data bindings resolve to)
room      = the leaf zone of its zone path
deviceId  = sim-<archetype>-<room>[-n]
```

`f` is the table in `analyse-fixture.py`, and it is total over the fixture except
for the two equipments named in the spec's open decisions. A `sensor` is a PIR
when its bindings carry `motion`, a PIR with a light level when they also carry
`luminosity`, and a probe when they carry `temperature`.

Nothing about this is a list somebody typed. A list of seventy-four rows would be
wrong the first time the fixture is regenerated.

## The rewrite, in order

1. **Derive** every equipment's archetype and room; fail on anything unplaced.
2. **Generate the house description** — rooms with their thermal properties, and
   one device per equipment — and write it to `src/house/house.ts`.
3. **Rewrite `devices`**: `source` and `integration_id` become `simulator`,
   `mqtt_name` / `name` become the allocated slug, `manufacturer` becomes `Sowel`,
   `model` becomes the archetype, `ieee_address` and `raw_expose` go.
4. **Rewrite `device_data` and `device_orders`**: replaced wholesale by what the
   catalogue declares for that archetype, keeping the row **ids** where a key
   survives so the bindings still resolve.
5. **Re-point the bindings**: a binding whose key survived keeps its id and alias;
   one whose key did not is dropped and reported.
6. **Add** the devices with no fixture counterpart — the occupants and `sim-house`
   — with their equipments and the `sim.*` order bindings of FR5.
7. **Prune**: plugins, users, tokens, integration settings.
8. **Verify**: every binding resolves, every recipe and widget names something that
   exists, no prohibited key anywhere. Fail otherwise.

Step 4 is the one worth care. The fixture's thermostat carries
`targetTemperature`, `insideTemperature`, `nanoe` and `ignitionCount`; the
catalogue carries `setpoint`, `temperature`, `state`, `operationMode` and
`outsideTemperature`. `targetTemperature` → `setpoint` and `insideTemperature` →
`temperature` are the same reading under two names, so the binding survives with
its alias. `nanoe` and `ignitionCount` have no counterpart and their bindings go.

## Why the house description is generated, not hand-edited

It is the contract three things read: the physics (spec 001), the fixture (this
spec) and the 3D plan (phase 3). If the fixture and the description are written
separately they will disagree, and the disagreement will show up as a binding that
resolves to nothing on a demo nobody is watching.

Generating it from the fixture makes them the same statement. The parts a fixture
cannot know — a room's thermal capacity, its windows and their orientation, the
household's agenda — stay hand-written, in a block the generator does not touch.

**That split has to be explicit in the file**, or the next person to edit the
generated half will lose their work on the next run.

## What the report says

The script prints what it did and what it dropped, because the dropped things are
the interesting ones:

```
74 equipments → 74 devices          72 derived, 2 by rule
206 data bindings → 189             17 dropped: nanoe (2), ignitionCount (1), …
69 order bindings → 69              + 41 simulation bindings added
21 recipe instances → 21
0 orphans
```

A silent build is a build nobody checks.

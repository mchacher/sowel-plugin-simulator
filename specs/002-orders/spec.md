# Spec 002 — The house that obeys

**Status**: 📝 Draft
**Phase**: 1 of the [showroom project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md) — second of its three specs
**Builds on**: [spec 001](../001-world-model/) (the world model and its devices)

## Context

Spec 001 publishes a house. It does not listen: an order arriving is logged at
`debug` and ignored. This spec makes it listen, which turns the demo from a
picture into something a visitor can act on — and turns the energy arbiter from a
surface with nothing to allocate into the thing the showroom exists to show.

Three pieces, and they are separable only on paper:

1. **Real orders.** The ones a real integration would execute — a light switched,
   a shutter moved, a setpoint changed — each fed back into the physical model and
   echoed on the reading.
2. **Simulation orders.** `sim.*` orders that no real device has, so a visitor can
   walk into a room, open a door, or make it rain, through the ordinary order path.
3. **Per-target debounce.** The "ten hands on one lamp" rule, which has to live
   here because the core has no demo mode.

## Goals

- Every order the catalogue declares is executed, feeds the model, and is echoed
  on the reading the interface is watching.
- A visitor can trigger presence, open a door, nudge a probe, change the weather
  and place a ghost, all through ordinary `DeviceOrder`s.
- Concurrent visitors cannot make the house flicker.
- Nothing throws, ever, whatever arrives.

## Non-goals

| Not here                                      | Why                                                              |
| --------------------------------------------- | ---------------------------------------------------------------- |
| The fixture remap                             | Spec 003.                                                        |
| Visitor identity, quotas, one-pilot-at-a-time | The proxy's job (phase 2) and the 3D app's (phase 4).            |
| Simulated hardware faults                     | A later phase of the project map.                                |
| Recipes, modes, arbitration                   | Sowel's, not the simulator's. The point is that they run on top. |

## Functional requirements

### FR1 — Every declared order executes

For each archetype, the orders in `docs/devices.md`:

| Archetype            | Order                                | Effect                                                                                |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Relay, valve, heater | `state`                              | The relay closes or opens. A heater's room stops being heated when its relay is open. |
| Multi-channel relay  | `power1`…`power4`                    | That channel only.                                                                    |
| Dimmer               | `state`, `brightness`                | Brightness ramps rather than jumping; setting a brightness on a dark lamp lights it.  |
| Shutter              | `position`, `state`                  | The shutter **travels**; `OPEN` / `CLOSE` / `STOP` drive and interrupt the travel.    |
| Gate                 | `R1`                                 | A pulse: the contact closes and releases on its own.                                  |
| Thermostat           | `power`, `setpoint`, `operationMode` | Its room's heating follows.                                                           |
| Pool heat pump       | `setpoint`                           | The pool's target.                                                                    |

**An order changes the world, not the reading.** The reading follows because the
model changed — a shutter's `position` is reported from where the shutter actually
is, mid-travel included. Anything else would be a display that agrees with itself
and disagrees with the house.

### FR2 — Echo, because nothing else will

Nothing in the core synthesises the confirmation. When an order arrives the device
is expected to republish the affected reading on the same key; without it the
interface sends the command and sits on the old value.

The echo is not instant, because no actuator is: a relay within a tick, a dimmer
over about a second, a shutter over the twenty-odd seconds it takes to travel.

### FR3 — Simulation orders

Orders no real device has, declared on the archetypes that make sense, so the whole
existing plumbing — bindings, aliases, audit log, WebSocket — applies unchanged.

| Order                     | On                              | Value               | Effect                                                                                     |
| ------------------------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `sim.motion`              | motion sensors                  | —                   | A motion pulse. The PIR reports occupancy for a hold time, and a recipe watching it fires. |
| `sim.open` / `sim.close`  | contacts                        | —                   | The door opens for a few seconds, or closes now.                                           |
| `sim.temperature`         | probes, thermostats             | number              | Nudges the room's temperature and lets the model take it from there.                       |
| `sim.weather`             | the outdoor module              | enum                | Forces the sky to a condition for the rest of the day.                                     |
| `sim.enter` / `sim.leave` | occupants                       | —                   | Sends a household member home or out, through the entrance.                                |
| `sim.ghost`               | a house-level simulation device | `room` or `id:room` | Places or moves an ephemeral occupant.                                                     |

**They carry no category.** A category is what every core consumer keys off; these
are not any of the categories the core knows, and giving them one would make a
motion sensor look like an actuator to the binding dialog. Uncategorised, they are
extras: bound by hand when someone wants them, invisible otherwise.

### FR4 — Ghosts

A ghost is a visitor's own presence: an occupant that exists because someone
clicked, walks where told, and disappears when they stop.

- Placed or moved by `sim.ghost`, addressed by id so several visitors do not fight
  over one.
- **Expires two minutes after its last order.**
- **At most ten at a time.** The oldest is dropped rather than the newest refused —
  a visitor who has just arrived should not be the one told no.
- Ghosts count as occupants for motion, CO₂ and thermal gain. They are not
  published as occupant devices: they are not the household.

**Visitors never move the household.** `sim.enter` / `sim.leave` exist for
completeness and for the 3D application's own controls, but the ordinary way a
visitor makes presence is a ghost of their own.

### FR5 — Per-target debounce

An order on a target that changed less than a few seconds ago is ignored and logged
at `debug`. The target is the device and the order key together, so two visitors in
two rooms never contend.

This is where the "ten hands on one lamp" rule lives, because the core has no demo
mode. It is deliberately short: long enough that a lamp cannot strobe, short enough
that a visitor never feels the house ignoring them.

A `STOP` on a moving shutter is exempt. Debouncing a stop is how a shutter ends up
somewhere nobody asked for.

### FR6 — Never throw, whatever arrives

An order for an unknown device, an unknown key, a value of the wrong type, a value
out of range: logged at `debug` or `warn`, ignored. `executeOrder` is one of the
methods the core rethrows from, so a throw here surfaces as a failed order in a
visitor's face.

Values arrive as the core's wire values. Booleans are accepted as `true`, `"ON"`,
`"true"`, `1` and their opposites, because being strict about a shape we do not
control buys nothing.

### FR7 — The arbiter can finally arbitrate

With FR1 in place the water heater's solar input and the pool pump's relay are
switchable, which is the third of the four things core spec 140 needs (spec 001,
FR9b). Switching one moves the grid clamp within a tick, and its own sub-load clamp
reports the draw the arbiter reserves.

Nothing in this spec knows the arbiter exists. That is the point: it is a recipe
and a core engine acting through the ordinary order path.

## Acceptance criteria

- [ ] AC1 — Every order in `docs/devices.md` has an effect on the model and an echo
      on the reading. A test walks the catalogue and asserts both.
- [ ] AC2 — A shutter ordered to 0 travels there over seconds and reports
      intermediate positions; `STOP` leaves it where it is.
- [ ] AC3 — `sim.motion` makes the PIR report occupancy, and it clears after the
      hold time.
- [ ] AC4 — A ghost placed by `sim.ghost` shows as occupancy in that room, expires
      after two minutes, and the eleventh ghost drops the oldest rather than itself.
- [ ] AC5 — Two orders on the same target inside the debounce window: the second is
      ignored. The same two on different targets both apply.
- [ ] AC6 — `STOP` is never debounced.
- [ ] AC7 — An unknown device, an unknown key and a wrong-typed value each resolve
      without throwing and without changing anything.
- [ ] AC8 — Closing the water heater's solar relay by order moves the grid clamp by
      its draw within one tick, and its clamp reports it.
- [ ] AC9 — `npm run validate` is green.

## Edge cases

| Case                                                       | Expected                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `brightness` ordered on a lamp that is off                 | The lamp lights. That is what every real dimmer does.                                  |
| `position` ordered while the shutter is already travelling | The new target wins; the travel continues from where it is.                            |
| A setpoint outside the declared bounds                     | Clamped, logged at `debug`. Refusing would be a worse demo than clamping.              |
| `sim.ghost` naming a room that does not exist              | Ignored, logged at `debug`.                                                            |
| Two visitors moving the same ghost id                      | Last one wins. Ghost identity is the 3D application's to allocate.                     |
| An order arriving before `start()` finished                | Ignored; the world is not there yet.                                                   |
| A mode or a recipe ordering the same target as a visitor   | Debounced like any other order. The house does not know who is asking, and should not. |

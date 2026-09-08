# Spec 002 — Architecture

## Where it goes

```
src/
  world/
    actuation.ts     NEW  in-flight transitions: a shutter travelling, a dimmer
                          ramping, a gate pulsing. Pure, stepped by the tick.
    ghosts.ts        NEW  ephemeral occupants: place, move, expire, cap.
    world.ts         +    owns actuation and ghost state; folds ghosts into
                          occupancy; applies overrides from sim orders
    occupants.ts     +    an override that sends a household member home or out
    weather.ts       +    a forced condition for the rest of the local day
  publish/
    catalogue.ts     +    the `sim.*` orders, uncategorised
    orders.ts        NEW  parse, validate, debounce, dispatch
  index.ts           +    executeOrder wired to orders.ts
```

`world/` stays free of Sowel imports. `publish/orders.ts` is the only new file that
knows what a `DeviceOrder` is.

## An order's path

```
Sowel dispatches an order
  → index.ts executeOrder(device, key, value)
    → OrderRouter.execute(sourceDeviceId, key, value)
      → resolve the device in the house description        unknown → debug, done
      → resolve the order in the catalogue                 unknown → debug, done
      → coerce the value to the declared type              bad     → warn, done
      → debounce on (deviceId, key)                        recent  → debug, done
      → apply: mutate ActuatorStates, or start a transition,
               or push a simulation override
  → the next tick integrates it and the publisher echoes the reading
```

Nothing publishes from inside `executeOrder`. The echo comes from the ordinary
tick, so an order and the physics that follow it cannot disagree.

## Transitions, because no actuator is instant

`actuation.ts` holds the transitions in flight and steps them with the tick.

| Transition            | Rate                       | Note                                                                                     |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Shutter travel        | 4 % per second             | 25 seconds end to end, which is a real shutter. `STOP` drops the transition where it is. |
| Dimmer ramp           | 254 steps per second       | About a second, and visibly a ramp.                                                      |
| Gate pulse            | closes, releases after 2 s | A gate order is momentary; the relay is not a state.                                     |
| Relay, setpoint, mode | next tick                  | Nothing to travel.                                                                       |

A transition is `{ deviceId, from, to, startedAt, ratePerSecond }`. Re-targeting
replaces it and keeps the current position as the new `from`, so a shutter ordered
somewhere else mid-travel carries on from where it is rather than jumping.

## Simulation overrides

The world model is a function of the clock (spec 001, FR3). A simulation order is
the one thing that is not, so overrides are held apart, with an expiry, and folded
in at the edges rather than smeared through the model:

| Override             | Held as                                     | Expires                                   |
| -------------------- | ------------------------------------------- | ----------------------------------------- |
| Motion pulse         | `deviceId → until`                          | the hold time                             |
| Door open / close    | `deviceId → until`                          | a few seconds, or immediately for `close` |
| Temperature nudge    | applied once to the room's state, then gone | not held at all                           |
| Weather              | `condition` for the local day               | at local midnight                         |
| Occupant home / away | `occupantId → { present, until }`           | end of the local day                      |
| Ghosts               | see below                                   | two minutes after the last order          |

They are deliberately short-lived. The house has to converge back on its agenda,
because the alternative is a demo that drifts further from itself with every
visitor and needs the nightly reset to mean something.

A temperature nudge is not held at all: it moves the room's integrated state once
and the thermal model takes it from there. That is both simpler and truer — pushing
a room to 26 °C and watching it come back down is the physics working.

## Ghosts

```ts
interface Ghost {
  id: string;
  room: string;
  lastSeenAt: number;
}
```

A ring of at most ten, keyed by id. `sim.ghost` with `"sejour"` addresses the
default ghost; with `"g7:sejour"` addresses ghost `g7`. Placing an eleventh drops
the **oldest**, because a visitor who has just arrived should not be the one told no.

Ghosts are folded into `occupancyByRoom`, so they light up a PIR, raise CO₂ and warm
a room exactly like a person. They are **not** published as occupant devices: the
household is four people on an agenda, and a visitor's ghost is not one of them.

## Debounce

`Map<string, number>` keyed `deviceId:orderKey`, holding the last accepted instant.
Three seconds. `shutter_move` with value `STOP` bypasses it — debouncing a stop is
how a shutter ends up somewhere nobody asked for.

The map is bounded by the number of targets in the house, so it needs no eviction.

## Value coercion

The core sends its wire value (spec 150 `resolveWireValue`). This plugin declares
booleans with no wire literals, so it should receive real booleans — but being
strict about a shape we do not control buys nothing:

| Declared  | Accepted                                                         |
| --------- | ---------------------------------------------------------------- |
| `boolean` | `true`, `"true"`, `"ON"`, `"on"`, `1`, `"1"` and their opposites |
| `number`  | a number, or a string that parses as one; clamped to `min`/`max` |
| `enum`    | a declared value, case-insensitively                             |

Anything else is a `warn` and no change.

## What the catalogue gains

`sim.*` orders, with **no category**. A category is what every core consumer keys
off; these are none of the categories the core knows, and giving them one would make
a motion sensor look like an actuator in the binding dialog. Uncategorised, they are
extras — bound by hand when someone wants them, invisible otherwise.

One new archetype, `simulation`: a single house-level device carrying `sim.ghost`
and reporting `ghosts` (a count) so the 3D application can see how many are about.
It has no room, and it is the only device in the house that represents nothing
physical — which is exactly why it is one device and not a flag on sixty-six others.

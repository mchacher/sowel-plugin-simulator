# Spec 002 — Implementation plan

Branch: `feat/orders`. Scopes: `orders`, `world`, `devices`, `manifest`.

## Steps

- [ ] **S1 — `world/actuation.ts`**: transitions in flight (shutter travel, dimmer
      ramp, gate pulse), stepped by the tick, re-targetable mid-travel.
- [ ] **S2 — `world/ghosts.ts`**: place, move, expire, cap at ten dropping the oldest.
- [ ] **S3 — overrides**: motion pulse, door, weather and occupant overrides, each
      with its expiry; the temperature nudge applied once to the room's state.
- [ ] **S4 — `world/world.ts`**: own the actuation and ghost state, fold ghosts into
      occupancy, apply the overrides at the edges.
- [ ] **S5 — `publish/catalogue.ts`**: the `sim.*` orders and the `simulation`
      archetype, all uncategorised.
- [ ] **S6 — `publish/orders.ts`**: resolve, coerce, debounce, apply.
- [ ] **S7 — `src/index.ts`**: wire `executeOrder`; it still never throws.
- [ ] **S8 — docs**: `docs/devices.md` gains the simulation orders; `docs/specs-index.md`
      gains the row.
- [ ] **S9 — the real instance**: install on a stock Sowel in Docker, bind a light, a
      shutter and a thermostat, order them from the API, and watch the readings echo.

## Test plan

| Module      | Scenario                                   | Expected                                                             |
| ----------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `actuation` | Shutter ordered 100 → 0                    | Travels at 4 %/s, reports intermediate positions — **AC2**           |
| `actuation` | `STOP` mid-travel                          | Stops where it is, and stays — **AC2**                               |
| `actuation` | Re-targeted mid-travel                     | Continues from the current position, never jumps                     |
| `actuation` | Dimmer ramp                                | Reaches the target in about a second, monotonically                  |
| `actuation` | Gate pulse                                 | Closes, releases on its own after two seconds                        |
| `ghosts`    | Place one                                  | Counts as an occupant in that room — **AC4**                         |
| `ghosts`    | No order for two minutes                   | Gone — **AC4**                                                       |
| `ghosts`    | An eleventh                                | The oldest is dropped, not the newest — **AC4**                      |
| `ghosts`    | `id:room` twice                            | One ghost moved, not two placed                                      |
| `ghosts`    | An unknown room                            | Ignored, nothing thrown                                              |
| `orders`    | Every order in the catalogue               | Has an effect and an echo — **AC1**                                  |
| `orders`    | Unknown device, unknown key, wrong type    | No throw, no change — **AC7**                                        |
| `orders`    | Setpoint above `max`                       | Clamped, not refused                                                 |
| `orders`    | `"ON"`, `1`, `"true"` on a boolean order   | All accepted                                                         |
| `orders`    | Two orders on one target inside the window | Second ignored — **AC5**                                             |
| `orders`    | Two orders on different targets            | Both applied — **AC5**                                               |
| `orders`    | `STOP` inside the window                   | Applied — **AC6**                                                    |
| `world`     | `sim.motion`                               | PIR occupied, then clear after the hold — **AC3**                    |
| `world`     | `sim.open` then the timer                  | Contact opens then closes on its own                                 |
| `world`     | `sim.temperature`                          | Room moves, then drifts back on its own                              |
| `world`     | `sim.weather`                              | Condition forced for the day, cloud and production follow            |
| `world`     | `sim.leave` then `sim.enter`               | The occupant goes and comes back through the entrance                |
| `world`     | Heater relay opened by order               | Its room stops being heated                                          |
| `world`     | Solar relay closed by order                | Grid moves by the draw within a tick; the clamp reports it — **AC8** |
| `index`     | An order before `start()`                  | Ignored, no throw                                                    |
| `index`     | An order that makes the world throw        | Logged with `{ err }`, `executeOrder` still resolves                 |

# Sowel plugin: simulator

A simulated home for Sowel: occupants on an agenda, sun and weather, a thermal model per room, PV production and household loads, published as **ordinary devices**. Motion lighting, presence heating, shutters at dusk and energy arbitration are Sowel's own recipes running on top; the plugin only simulates the physical world.

Uses:

- the public showroom ([`sowel-showroom`](https://github.com/mchacher/sowel-showroom)), where the house lives in real time and visitors act on it;
- documentation screenshots, which need a live instance rather than an inert fixture;
- testing recipes and engines without hardware.

Sensors also expose **simulation orders** no real device has — `sim.motion`, `sim.open` / `sim.close`, `sim.temperature`, `sim.weather`, `sim.enter` / `sim.leave`, `sim.ghost` — so a client triggers presence in a room through the ordinary order path, with bindings, the audit log and the WebSocket all applying unchanged. A visitor's presence is a **ghost**: it counts as a person for motion, CO₂ and warmth, and expires two minutes after their last click.

## What it publishes

A pavilion — a ground floor and one storey, the garage attached at the side — with fourteen rooms, five occupants on weekday and weekend agendas, a pool, and around ninety devices — every one of them an archetype from [`docs/devices.md`](docs/devices.md), which is the contract this plugin implements. The 3D view ([`sowel-house-3d`](https://github.com/mchacher/sowel-house-3d)) draws the same rooms at the same sizes; its plan and `src/house/layout.ts` describe one house.

The house is **alive at t = 0**: everything is declared and carries a plausible value within a second of starting, from any moment of any day. It holds no state on disk — the model is reconstructed by integrating from local midnight — so a restart at three in the afternoon gives a house that is at three in the afternoon rather than a cold one, and the day's energy counters stay monotonic across it.

Given the same clock and the same seed it replays identically. Real time only: no accelerated clock, because the history has to stay coherent with what a visitor sees.

## Status

| Spec                          | What                                                                        | State |
| ----------------------------- | --------------------------------------------------------------------------- | ----- |
| [001](specs/001-world-model/) | The world model and the devices it publishes.                               | ✅    |
| [002](specs/002-orders/)      | Order execution with echo, the `sim.*` orders, ghosts, per-target debounce. | ✅    |
| [003](specs/003-fixture/)     | The demo fixture, derived from the real house.                              | ✅    |

The three are phase 1 of the [project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md), and it is **done**: on a stock Sowel with this plugin and the built fixture, `sim.motion` in the cellar fires the motion-light recipe and the journal says why the lamp came on, and a forced sunny sky has the energy arbiter grant the water heater its surplus.

## The demo fixture

```bash
npx tsx scripts/fixture/build.ts ../sowel/docs/fixtures/showroom-fr.zip
```

Turns the core's anonymised showroom backup into one this plugin drives — the house reshaped to the pavilion first (`scripts/fixture/reshape.ts`: the cellar and workshop dropped, the basement and second floor folded away), then 68 equipments in, 67 devices out, the vendor vocabulary dropped, the bindings re-pointed by category, and the `sim.*` orders bound so something can call them. It fails rather than emitting a fixture that half works. `scripts/analyse-fixture.py` reports what a backup holds in simulator terms without writing anything.

## Development

```bash
npm install
npm run validate        # typecheck, lint, format, tests, build — what CI runs
npm run dev             # tsc --watch
```

Install on a Sowel instance through a personal source (core spec 136), or copy `manifest.json`, `package.json` and `dist/` into `plugins/simulator/`.

Releases: tag `vX.Y.Z` on main; the workflow publishes `sowel-plugin-simulator-X.Y.Z.tar.gz`. The registry in `mchacher/sowel` must then be bumped with the tarball's SHA256 (spec 089).

## License

AGPL-3.0, like Sowel.

# Sowel plugin: simulator

A simulated home for Sowel: occupants on an agenda, sun and weather, a thermal model per room, PV production and household loads, published as **ordinary devices**. Motion lighting, presence heating, shutters at dusk and energy arbitration are Sowel's own recipes running on top; the plugin only simulates the physical world.

Uses:

- the public showroom ([`sowel-showroom`](https://github.com/mchacher/sowel-showroom)), where the house lives in real time and visitors act on it;
- documentation screenshots, which need a live instance rather than an inert fixture;
- testing recipes and engines without hardware.

Sensors also expose **simulation orders** no real device has (`sim.motion`, `sim.open`, `sim.temperature`, `sim.weather`, `sim.ghost`…), so a client can trigger presence in a room through the normal order path.

## Status

Skeleton: the plugin starts, stops and reports its status. The world model is phase 1 of the [project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md).

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

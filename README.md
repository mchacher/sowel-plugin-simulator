# Sowel plugin: simulator

A simulated home for Sowel: occupants on an agenda, sun and weather, a thermal model per room, PV production and household loads, published as **ordinary devices**. Motion lighting, presence heating, shutters at dusk and energy arbitration are Sowel's own recipes running on top; the plugin only simulates the physical world.

Uses:

- the public showroom ([`sowel-showroom`](https://github.com/mchacher/sowel-showroom)), where the house lives in real time and visitors act on it;
- documentation screenshots, which need a live instance rather than an inert fixture;
- testing recipes and engines without hardware.

Sensors also expose **simulation orders** no real device has (`sim.motion`, `sim.open`, `sim.temperature`, `sim.weather`, `sim.ghost`…), so a client can trigger presence in a room through the normal order path.

## Status

Not implemented. See the [project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md), phase 1.

## License

AGPL-3.0, like Sowel.

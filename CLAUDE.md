# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on `sowel-plugin-simulator`. First file to read. Same method as the Sowel core: spec with gates, feature branch, tests, agent review, PR, explicit merge approval.

## What this is

A Sowel **integration plugin** that simulates a home — occupants on an agenda, sun and weather, a thermal model per room, PV and household loads — and publishes it as **ordinary devices**. Sowel's own recipes and engines do the automation on top. Nothing here knows what a recipe is.

Uses: the public showroom, the docs screenshot pipeline, testing recipes without hardware.

## Where to find context

| You want to know...                        | Read this                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Why this exists, the decisions, the phases | [sowel-showroom/docs/project-map.md](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md) |
| How Sowel loads and isolates a plugin      | `mchacher/sowel`: `docs/technical/plugin-development.md`, `src/plugins/scoped-deps.ts` (spec 111)              |
| The API slice this plugin relies on        | `src/sowel-api.ts` (hand-synced with the core's `src/shared/plugin-api.ts`)                                    |
| What exactly to simulate, device by device | [docs/devices.md](docs/devices.md) — the catalogue, decided before phase 1                                     |
| Every feature specified here               | [docs/specs-index.md](docs/specs-index.md) — one row per spec, CI-gated                                        |
| Feature history in this repo               | `specs/NNN-name/{spec,architecture,plan}.md`                                                                   |

The core repo is expected as a sibling directory (`../sowel`) for cross-reference and for the registry bump at release time.

## Non-negotiable rules

- **This plugin publishes devices, never equipment types.** The plugin API has no notion of one: a device declares readings and orders, each with a `category`, and **the category is the contract**. Whether a reading ends up on a thermostat or a sensor is decided later, by a person binding an equipment. The catalogue is [docs/devices.md](docs/devices.md).
- **Simulate the archetype, not the vendor.** The cost here is per archetype, never per instance: one thermostat or ten cost the same. An archetype is implemented to the catalogue and to nothing else — a thermostat is `temperature`, `setpoint`, `power`, `operationMode`, not the fifteen readings the reference installation carries, which are two vendor vocabularies merged into one device. An order outside the catalogue is logged at debug and ignored, never an error.
- **The plugin simulates the physical world, not the sensors.** Presence, temperature, power are computed from a model and published as readings. It never decides to turn a light on; that is a recipe's job.
- **Occupants are devices.** Position is a `zone` enum reading. No side channel: a plugin has no other way to publish state, and it is the right way.
- **Two kinds of presence**: scheduled occupants, and ephemeral presence triggered by `sim.*` orders (a visitor's click). Both from the start.
- **Real time only.** No accelerated clock. History must stay coherent with what a visitor sees.
- **Deterministic given the clock**, with small seeded randomness. The same day replays the same way.
- **Spec 111 isolation**: this plugin can only write devices whose `integrationId === "simulator"`, read settings under `integration.simulator.*` plus `home.latitude/longitude/timezone`, and emit only `system.integration.*` / `system.alarm.*` events. Do not fight the Proxy; design within it.
- **Never throw** from a handler or from `executeOrder`. Log with `{ err }` and degrade.
- **Per-target debounce** lives here: an order on a target that changed less than a few seconds ago is ignored (and logged at debug).
- **No InfluxDB writes, no backfill.** Not possible from a plugin, and not wanted.

## Tech

Node 24, TypeScript strict, ESM (`NodeNext`), no runtime dependency. Vitest. ESLint + Prettier as in the core. `console.*` is an error: use the injected pino logger, structured context first, message second.

```bash
npm install
npm run validate        # typecheck, typecheck:tests, lint, format:check, test, build — exactly what CI runs
npx vitest run <file>   # one test file
```

Local loop against a Sowel instance: build, then install through a personal source (core spec 136), or copy `manifest.json`, `package.json` and `dist/` into the instance's `plugins/simulator/`.

## Git workflow

- Feature branches for anything non-trivial: `feat/`, `fix/`, `refactor/`, `docs/`. Main is protected (PR required, linear history, CI green).
- Conventional commits. Scopes: `world`, `occupants`, `environment`, `thermal`, `energy`, `devices`, `orders`, `manifest`, `ci`.
- **Never merge a PR without explicit user approval** ("oui", "merge", "go").
- Every new `specs/NNN-name/` folder needs `spec.md`, `architecture.md`, `plan.md` **and a row in `docs/specs-index.md`** (two CI gates). A spec that starts a phase also flips that phase's status in the showroom's project map.
- A release is a PR (version bump in `package.json` **and** `manifest.json`, changelog entry) then a tag on main, then the **registry hash bump in the core** (spec 089). See the `simulator-release` skill.

## Skills

| Skill               | When                                                         |
| ------------------- | ------------------------------------------------------------ |
| `simulator-feature` | Implementing a feature or a phase: spec, branch, tests, PR.  |
| `simulator-release` | Bumping, tagging, publishing, and bumping the registry hash. |

## Answering the user

Short and ordered. One or two lines for the what, one bullet per finding or decision. French or English, whichever the user uses.

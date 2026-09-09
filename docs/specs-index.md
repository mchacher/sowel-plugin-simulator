# Specs index — sowel-plugin-simulator

Every feature ever specified in this repository, one row each, newest last. A
CI check (`scripts/check-specs-index.sh`) fails a pull request that creates a
`specs/NNN-name/` folder without its row here.

The seven cross-repository phases live in the showroom's
[project map](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md).
This index is the detail below them: a phase can take several specs, and a spec
here says which phase it serves.

Status: 📝 Draft · 🚧 In progress · ✅ Shipped

| #   | Title                | Status | Summary                                                                                                                                                                              |
| --- | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001 | The house that lives | ✅     | Phase 1, first of three. The deterministic world model — sun, weather, thermal, occupants, energy — published as the devices of `docs/devices.md`. Read-only.                        |
| 002 | The house that obeys | ✅     | Phase 1, second of three. Order execution with echo, the `sim.*` simulation orders, ghosts, and the per-target debounce.                                                             |
| 003 | The demo house       | 📝     | Phase 1, last of three. Derives the demo fixture from the core's anonymised showroom backup: archetypes, rooms, rewritten keys, re-pointed bindings, and the `sim.*` order bindings. |

## How to use this index after context loss

1. Read the showroom's project map first — the decisions there are not reopened.
2. Scan this table for a spec that already covers what you are about to do.
3. Open `specs/NNN-name/spec.md` for the requirements, `architecture.md` for the
   shape, `plan.md` for the steps and the test plan.

# Plan — spec 004

| Step | What                                                            | Test                                    | State |
| ---- | --------------------------------------------------------------- | --------------------------------------- | ----- |
| 0    | `CLAUDE.md`: the backfill rule amended, pointing here.          | review                                  | ✅    |
| 1    | `habits.ts`; the warm-up uses it.                               | `habits.test.ts`; `world.test.ts` green | ✅    |
| 2    | `bindings.ts`: historized bindings from the fixture.            | against `demo-fr.zip`                   | ✅    |
| 3    | `replay.ts`: days → readings, through the live publish mapping. | a replayed hour equals a live one       | ✅    |
| 4    | `writers.ts`, `aggregate.ts`.                                   | unit tests; the pin test (FR4)          | ✅    |
| 5    | `cli.ts`, shipped in the tarball.                               | thirty days < 1 min                     | ✅    |
| 6    | Restore into a fresh Sowel; month view full.                    | seen, with showroom spec 003            | 📝    |
| 7    | Release; registry bump.                                         | release workflow                        | 📝    |

## Found by the pin (FR4)

The first run of the pin against a live backup failed on one series: the house heat
pump's meter binds power only, and the core integrates it into energy itself
(`power-submeter-integrator.ts`). The generator had not restated that writer. It
does now, and the pin passes. That is what the pin is for.

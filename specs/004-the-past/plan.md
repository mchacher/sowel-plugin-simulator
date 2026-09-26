# Plan — spec 004

| Step | What                                                            | Test                                    | State |
| ---- | --------------------------------------------------------------- | --------------------------------------- | ----- |
| 1    | `habits.ts`; the warm-up uses it.                               | `habits.test.ts`; `world.test.ts` green | 📝    |
| 2    | `bindings.ts`: historized bindings from the fixture.            | against `demo-fr.zip`                   | 📝    |
| 3    | `replay.ts`: days → readings, through the live publish mapping. | a replayed hour equals a live one       | 📝    |
| 4    | `writers.ts`, `aggregate.ts`.                                   | unit tests; the pin test (FR4)          | 📝    |
| 5    | `cli.ts`, shipped in the tarball.                               | thirty days < 1 min                     | 📝    |
| 6    | Restore into a fresh Sowel; month view full.                    | seen, with showroom spec 003            | 📝    |
| 7    | Release; registry bump.                                         | release workflow                        | 📝    |

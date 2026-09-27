# Architecture — spec 004

```
src/world/world.ts        the step function, unchanged
src/world/habits.ts       NEW — what the replay (and the warm-up) assumes Sowel did
src/history/replay.ts     NEW — days → a stream of (deviceId, key, value, ts),
                          through the same publish mapping the live plugin uses
src/history/bindings.ts   NEW — the fixture's bindings: device data → equipment,
                          alias, category, zone, type; which are historized
src/history/writers.ts    NEW — the core's writers mirrored: raw on change, energy
                          per minute, HP/HC split, self-consumption pairs
src/history/aggregate.ts  NEW — hourly mean/min/max, daily, energy sums, aligned
src/history/cli.ts        NEW — arguments, files out
```

## One model

The replay drives the same `World` the plugin runs, with habits applied through the
same entry points orders use. A reading published live and a reading replayed come
from the same code, so the seeded past and the live present meet without a seam.

## Mirroring the core, and holding the mirror honest

`writers.ts` and `aggregate.ts` restate a few hundred lines of the core
(`history-writer.ts`, `self-consumption-writer.ts`, `tariff-classifier.ts`, the
downsampling tasks' Flux). That is a copy, and a copy drifts. FR4's pin test is what
makes the copy safe: it holds the output against a real backup, and the core version
it was taken from is written next to it.

## Cost

A day is 1 440 steps; thirty days, 43 200. The live world does one step per second
and has headroom; the replay has no clock to wait on.

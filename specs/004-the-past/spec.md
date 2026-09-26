# Spec 004 — The house's past

**Status**: 📝 Draft, for review. Serves showroom spec 003 (_a house with a past_).

## Context

The showroom must open with thirty days of charts (showroom spec 003). The core's
backup format carries InfluxDB history as line protocol, one file per bucket, and
its restore writes them; what is missing is the history itself.

This plugin can compute it. Spec 001 made the world a pure function of the clock:
the weather and the household's agenda come from `(seed, day)`, and a restart at
15:00 already rebuilds the day by integrating from midnight in 60 s steps. Any past
day can be rebuilt the same way.

What the plugin cannot know is what **Sowel** did in those days — which recipe
switched which lamp, when the schedule ran the pool pump, what the arbiter granted.
Since the 2026-09-09 amendment the plugin does no automation: a relay stays open
until someone closes it. A past computed with nobody closing anything would be a
house where nothing ever runs. So the past is played with **habits** — the simplest
version of what the fixture's own automation does — and says so.

### A rule this amends

`CLAUDE.md` says: _no InfluxDB writes, no backfill — not possible from a plugin, and
not wanted._ The first half stands: the plugin still writes nothing but its devices'
readings, live. The second half is what the owner has now asked for, and this spec is
where it changes. The generator is not the plugin at runtime: it is an offline tool
shipped in the same package, it writes files, and the core's own restore is what puts
them in InfluxDB. `CLAUDE.md` is amended to say so. "Real time only" stands untouched:
nothing here speeds up a clock; the past is computed, the present is still lived.

## Goals

- A generator that writes, for the demo fixture, the history the core would have
  written over the last _n_ days, as the five line-protocol files of a Sowel backup.
- The same physics as the live plugin: the same code, not a second model.
- Shapes identical to what the core writes, and a test that fails when they drift.
- Fast: thirty days in under a minute on the showroom's host.

## Non-goals

- The arbiter's history. Its decisions are the product's, not the model's (showroom
  spec 003, FR4).
- Recipe logs, the activity journal, events. Only time series.
- Writing to InfluxDB. The generator writes files; the core's restore writes them.

## Functional requirements

### FR1 — The past is replayed, not invented

Days are rebuilt with the world's own step function from local midnight, 60 s at a
time, the pool warmed up as at a restart. The weather, the occupants, the sun, the
thermal model, PV, the water heater and the pool are exactly what the live plugin
would have computed for those days.

### FR2 — Habits stand in for Sowel

Where the live house waits for an order, the replay applies a habit, all of them in
one module and all of them named as assumptions:

| Actuator     | Habit                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Pool pump    | Its schedule recipe's hours, as the pool's warm-up already assumes              |
| Lamps        | On in an occupied room after sunset, off when it empties or the house sleeps    |
| Shutters     | Open at the home's daylight, closed after it                                    |
| Heating      | The fixture's mode calendar: comfort by day, eco at night and when away         |
| Water heater | Its night-rate clock; the surplus contact stays open — no arbiter in the replay |
| Appliances   | Their agenda, as live                                                           |

A habit is never used live. It exists for the replay and for the warm-up, and the
warm-up switches to it rather than keeping its own guess.

### FR3 — The output is a backup's history

For the fixture's bindings that the core historizes (its defaults, by alias and
category, and any per-binding override in the fixture), the generator writes:

| File                      | Bucket                | Range           | Content                                                                  |
| ------------------------- | --------------------- | --------------- | ------------------------------------------------------------------------ |
| `influx-raw.lp`           | `sowel`               | the last 7 days | what the history writer writes live: values on change, energy per minute |
| `influx-hourly.lp`        | `sowel-hourly`        | all of it       | per hour: `mean`, `min`, `max`                                           |
| `influx-daily.lp`         | `sowel-daily`         | all of it       | per day, from the hours                                                  |
| `influx-energy-hourly.lp` | `sowel-energy-hourly` | all of it       | per hour: energy sums, the HP/HC split, self-consumption                 |
| `influx-energy-daily.lp`  | `sowel-energy-daily`  | all of it       | per local day, from the hours                                            |

Measurement `equipment_data`, tags `equipmentId`, `alias`, `category`, `zoneId`,
`type`, fields as the core writes them. The HP/HC split follows the fixture's
`energy.tariff`. Hours are aligned on their start, days on local midnight, as the
core's tasks align them.

### FR4 — Pinned to the core

A test compares the generator's lines for one hour against a backup exported from a
live showroom over the same kind of hour (`test/fixtures/core-backup-sample.zip`):
same buckets, measurement, tag keys, aliases, fields and timestamp alignment. A core
upgrade that changes any of them fails this test, not the demo.

### FR5 — It stops where the real history starts

`--until` is the instant to stop at, exclusive — the showroom passes the earliest
real point. Nothing at or after it is written, so a seed can never overwrite a real
value.

### FR6 — A command, from the released package

`node dist/history/cli.js --fixture <zip> --until <iso> --days <n> --out <dir>`,
shipped in the tarball, runnable without Sowel.

## Acceptance criteria

- Thirty days generate in under a minute; the five files are written.
- Restored into a fresh Sowel, the Energy page's month view shows thirty full days,
  and the production curve of a clear day in the seed looks like one from the live
  plugin.
- The pin test passes against the core version the showroom runs.
- No line has a timestamp at or after `--until`.

## Edge cases

- **`--days` longer than the raw bucket's seven.** The older days go to the
  aggregate files only; the raw file holds the last seven, as a real instance would.
- **A daylight-saving change inside the range.** Local days of 23 or 25 hours, as the
  core counts them.
- **A binding historized off in the fixture.** Not written.

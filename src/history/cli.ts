/**
 * `node dist/history/cli.js --fixture <sowel-backup.json> --out <dir>
 *   [--until <iso>] [--days 30]` (spec 004, FR6).
 *
 * Writes the five history files of a Sowel backup for the fixture's house, from
 * `--days` before `--until` up to it. Runs without Sowel; the showroom's reset puts
 * the files in the fixture's zip and the core's restore writes them to InfluxDB.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BackupTables } from "./bindings.js";
import { generateHistory, historyFiles } from "./generate.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const fixture = arg("fixture");
const out = arg("out");
if (!fixture || !out) {
  fail("usage: cli.js --fixture <sowel-backup.json> --out <dir> [--until <iso>] [--days <n>]");
}
const until = arg("until") ? Date.parse(arg("until") as string) : Date.now();
const days = Number(arg("days") ?? 30);
if (!Number.isFinite(until) || !Number.isFinite(days) || days <= 0) fail("bad --until or --days");

const backup = JSON.parse(readFileSync(fixture, "utf8")) as { tables?: BackupTables };
const tables = backup.tables ?? (backup as unknown as BackupTables);
const started = Date.now();
const files = historyFiles(generateHistory(tables, { until, days }));
mkdirSync(out, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), body);
const counts = Object.entries(files)
  .map(([name, body]) => `${name} ${body ? body.split("\n").length : 0}`)
  .join(", ");
process.stdout.write(
  `${days} days until ${new Date(until).toISOString()} in ${Date.now() - started} ms: ${counts}\n`,
);

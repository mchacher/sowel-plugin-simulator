/**
 * The pin (spec 004, FR4): the generator's output held against a backup a live
 * Sowel exported, so the restated writers and tasks cannot drift silently.
 *
 * `__fixtures__/core-backup-sample.json` holds a few lines of each history file of
 * a real backup, taken from the showroom running this plugin, and says which core
 * version wrote them. When the core changes a measurement, a tag, a field, an alias
 * or an alignment, this test fails — not the demo. Refresh the sample from a backup
 * of the showroom after a core upgrade, and read the diff.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BackupTables } from "./bindings.js";
import { generateHistory, historyFiles } from "./generate.js";

interface Sample {
  coreVersion: string;
  exportedAt: string;
  files: Record<string, string[]>;
}

const SAMPLE = JSON.parse(
  readFileSync(new URL("./__fixtures__/core-backup-sample.json", import.meta.url), "utf8"),
) as Sample;

const TABLES = (
  JSON.parse(
    execFileSync("unzip", ["-p", "docs/fixtures/demo-fr.zip", "sowel-backup.json"], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString("utf8"),
  ) as { tables: BackupTables }
).tables;

interface Parsed {
  measurement: string;
  tags: Record<string, string>;
  field: string;
  ns: bigint;
}

function parse(line: string): Parsed {
  const [head, fieldPart, ts] = line.split(" ");
  const [measurement, ...tagParts] = head.split(",");
  const tags = Object.fromEntries(tagParts.map((t) => t.split("=") as [string, string]));
  return { measurement, tags, field: fieldPart.split("=")[0], ns: BigInt(ts) };
}

const signature = (p: Parsed) =>
  `${p.measurement}|${Object.keys(p.tags).sort().join(",")}|${p.field}`;

const until = Date.parse(SAMPLE.exportedAt);
const generated = historyFiles(generateHistory(TABLES, { until, days: 2, now: until }));
const parsedGenerated: Record<string, Parsed[]> = Object.fromEntries(
  Object.entries(generated).map(([name, body]) => [name, body ? body.split("\n").map(parse) : []]),
);

describe(`the generator against a backup core ${SAMPLE.coreVersion} wrote`, () => {
  for (const [file, lines] of Object.entries(SAMPLE.files)) {
    const real = lines.map(parse);
    const ours = parsedGenerated[file] ?? [];

    it(`${file}: the same measurement, tag keys and fields`, () => {
      const oursSignatures = new Set(ours.map(signature));
      for (const p of real) expect(oursSignatures, file).toContain(signature(p));
    });

    it(`${file}: every alias a real equipment has, ours has`, () => {
      const oursAliases = new Set(ours.map((p) => `${p.tags.equipmentId}|${p.tags.alias}`));
      for (const p of real) {
        expect(oursAliases, `${file} ${p.tags.alias}`).toContain(
          `${p.tags.equipmentId}|${p.tags.alias}`,
        );
      }
    });

    it(`${file}: timestamps aligned as the core aligns them`, () => {
      const alignment = (p: Parsed) =>
        p.ns % 3_600_000_000_000n === 0n
          ? "hour"
          : p.ns % 60_000_000_000n === 0n
            ? "minute"
            : "free";
      const realAlignments = new Set(real.map(alignment));
      const oursAlignments = new Set(ours.map(alignment));
      for (const a of realAlignments) {
        // A free timestamp in the real file allows anything; an aligned one does not.
        if (a !== "free") expect(oursAlignments, file).toContain(a);
      }
    });
  }
});

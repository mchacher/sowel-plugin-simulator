/**
 * Reading and writing Sowel backups (spec 003).
 *
 * A backup is a zip holding one `sowel-backup.json`. Rather than take a zip
 * dependency for a build script, shell out to `unzip` and `zip`, which are on
 * every machine this runs on — a maintainer's laptop and CI.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backup } from "./derive.js";

const ENTRY = "sowel-backup.json";

export function readBackup(path: string): Backup {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8")) as Backup;
  const raw = execFileSync("unzip", ["-p", path, ENTRY], { maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(raw.toString("utf8")) as Backup;
}

export function writeBackup(path: string, backup: Backup): void {
  if (path.endsWith(".json")) {
    writeFileSync(path, `${JSON.stringify(backup, null, 2)}\n`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "sowel-fixture-"));
  try {
    writeFileSync(join(dir, ENTRY), `${JSON.stringify(backup, null, 2)}\n`);
    rmSync(path, { force: true });
    // -j so the archive holds the file at its root, as Sowel's own export does.
    execFileSync("zip", ["-j", "-q", path, join(dir, ENTRY)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

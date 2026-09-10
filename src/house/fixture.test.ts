import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_DEVICES } from "./devices.generated.js";
import { HOUSE } from "./house.js";

const FIXTURE = "docs/fixtures/demo-fr.zip";

/** Read the single JSON out of a backup zip without taking on a zip dependency. */
function readBackup(path: string): Record<string, Record<string, unknown>[]> {
  const raw = execFileSync("unzip", ["-p", path, "sowel-backup.json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw).tables;
}

describe("the built fixture stays in step with the house", () => {
  it("is committed", () => {
    expect(existsSync(FIXTURE), `${FIXTURE} is missing — run scripts/fixture/build.ts`).toBe(true);
  });

  it("registers the version this plugin actually is", async () => {
    // The builder stamps `manifest.json`'s version into the fixture's plugins
    // table. Bump the manifest without rebuilding and the demo installs a plugin
    // row for a version that does not exist — which fails at install with a
    // checksum mismatch, a long way from the edit that caused it.
    const manifest = (await import("../../manifest.json", { with: { type: "json" } })).default;
    const tables = readBackup(FIXTURE);
    const simulator = tables.plugins.find((row) => row.id === "simulator");
    expect(simulator, "the fixture does not register the simulator").toBeDefined();
    expect(simulator?.version).toBe(manifest.version);
  });

  it("names only devices the house declares", () => {
    // A device row the house does not know is a binding that resolves to nothing
    // the moment the plugin starts.
    const known = new Set(HOUSE.devices.map((device) => device.id));
    const tables = readBackup(FIXTURE);
    const unknown = tables.devices
      .map((row) => String(row.mqtt_name ?? row.name))
      .filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
    expect(known.size).toBeGreaterThanOrEqual(GENERATED_DEVICES.length);
  });

  it("hands the restore rows of uniform shape", () => {
    // The core reads its column list from the first row of each table and drops
    // the rest in silence (mchacher/sowel#939).
    const tables = readBackup(FIXTURE);
    for (const [name, rows] of Object.entries(tables)) {
      if (rows.length < 2) continue;
      const shape = Object.keys(rows[0]).join(",");
      const ragged = rows.findIndex((row) => Object.keys(row).join(",") !== shape);
      expect(ragged, `${name} row ${ragged} has a different shape`).toBe(-1);
    }
  });

  it("carries what the arbiter needs to do anything at all", () => {
    const tables = readBackup(FIXTURE);
    const profiled = tables.equipments.filter((row) => row.energy_profile);
    expect(profiled.length).toBeGreaterThanOrEqual(2);
    expect(tables.settings.find((row) => row.key === "energy.arbiter.enabled")?.value).toBe("true");
    // Enrolled loads with no claimant sit idle for ever: the arbiter issues no
    // orders of its own (core spec 140).
    const claimants = tables.recipe_instances.filter(
      (row) => row.recipe_id === "water-heater-solar" && row.enabled,
    );
    expect(claimants.length).toBeGreaterThan(0);
  });
});

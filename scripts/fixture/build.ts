/**
 * Build the demo fixture (spec 003).
 *
 *     npx tsx scripts/fixture/build.ts ../sowel/docs/fixtures/showroom-fr.zip \
 *       --out docs/fixtures/demo-fr.zip
 *
 * Reads the core's anonymised showroom backup and writes one the simulator can
 * drive: every device re-pointed at the simulator, every key rewritten to the
 * catalogue, every binding re-resolved by category, the vendor vocabulary gone,
 * and the `sim.*` order bindings added without which nothing can call them.
 *
 * It **fails** rather than emitting a fixture that half works. A demo that comes
 * up with three broken cards teaches the visitor that Sowel is broken.
 *
 * `--devices-only` stops after writing `src/house/devices.generated.ts`, which is
 * what the first run of a regenerated fixture wants: look at the house before
 * rewriting anything into it.
 */

import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { LAYOUT } from "../../src/house/layout.js";
import type { DeviceSpec } from "../../src/house/types.js";
import {
  additionalDevices,
  derive,
  type Backup,
  type Equipment,
  type Row,
  type Zone,
} from "./derive.js";
import { emitDevices } from "./emit.js";
import { readBackup } from "./io.js";

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

function main(argv: string[]): void {
  const input = argv[0];
  if (!input)
    fail("usage: build.ts <showroom-backup.zip|.json> [--out <demo.zip>] [--devices-only]");
  const devicesOnly = argv.includes("--devices-only");

  const backup: Backup = readBackup(input);
  const tables = backup.tables;

  const zones = new Map<string, Zone>(
    (tables.zones as unknown as Zone[]).map((zone) => [zone.id, zone]),
  );
  const equipments = tables.equipments as unknown as Equipment[];
  const deviceData = new Map(tables.device_data.map((row) => [row.id as string, row]));

  const dataBindingsByEquipment = new Map<string, Row[]>();
  for (const binding of tables.data_bindings) {
    const key = binding.equipment_id as string;
    const list = dataBindingsByEquipment.get(key) ?? [];
    list.push(binding);
    dataBindingsByEquipment.set(key, list);
  }

  const categoriesOf = (equipmentId: string): Set<string> => {
    const found = new Set<string>();
    for (const binding of dataBindingsByEquipment.get(equipmentId) ?? []) {
      const entry = deviceData.get(binding.device_data_id as string);
      const category = entry?.category as string | undefined;
      if (category) found.add(category);
    }
    return found;
  };

  const result = derive(equipments, zones, categoriesOf);

  if (result.unmapped.length > 0) {
    for (const equipment of result.unmapped) {
      process.stderr.write(
        `  unmapped: ${equipment.name} (${equipment.type}) — ${[...categoriesOf(equipment.id)].sort().join(", ") || "no categories"}\n`,
      );
    }
    fail(
      `${result.unmapped.length} equipment(s) could not be derived. Each one is a decision: ` +
        "extend archetypeFor, or record the drop in spec 003.",
    );
  }

  // Every room a device lives in has to exist in the hand-written layout, or the
  // physics has nothing to say about it and the binding resolves to nothing.
  const known = new Set(LAYOUT.rooms.map((room) => room.id));
  const missing = result.rooms.filter((room) => !known.has(room));
  if (missing.length > 0) {
    fail(
      `layout.ts has no room for: ${missing.join(", ")}. A room needs its inertia, ` +
        "its glazing and which way its windows face — facts the fixture does not carry.",
    );
  }

  const devices: DeviceSpec[] = [
    ...result.devices.map((derived): DeviceSpec => ({
      id: derived.deviceId,
      archetype: derived.archetype,
      ...(derived.room ? { room: derived.room } : {}),
      ...(derived.load ? { load: derived.load } : {}),
    })),
    ...additionalDevices(LAYOUT.occupants.map((occupant) => occupant.id)),
  ];

  // A room that says it has a local heater or thermostat must actually have one,
  // or the thermal model leaves it unheated and nobody finds out until a visitor
  // wonders why the study is at 9 °C in January.
  const localHeating = new Map<string, string>();
  for (const device of devices) {
    if (device.room && (device.archetype === "heater" || device.archetype === "thermostat")) {
      localHeating.set(device.room, device.archetype);
    }
  }
  for (const room of LAYOUT.rooms) {
    if (room.heating !== "heater" && room.heating !== "thermostat") continue;
    if (localHeating.get(room.id) === room.heating) continue;
    fail(
      `layout.ts says ${room.id} is heated by a local ${room.heating}, but the fixture ` +
        `has no ${room.heating} in it. Either it is on the house heat pump (\`trv\`) or ` +
        "the fixture is missing the equipment.",
    );
  }

  const duplicates = devices
    .map((device) => device.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length > 0) fail(`duplicate device ids: ${[...new Set(duplicates)].join(", ")}`);

  writeFileSync("src/house/devices.generated.ts", emitDevices(devices, basename(input)));

  process.stdout.write(
    `${equipments.length} equipments → ${result.devices.length} devices ` +
      `(+${devices.length - result.devices.length} the fixture does not imply, ` +
      `${result.dropped.length} dropped by decision)\n` +
      `${result.rooms.length} rooms referenced, all present in layout.ts\n` +
      `wrote src/house/devices.generated.ts\n`,
  );
  for (const equipment of result.dropped) {
    process.stdout.write(`  dropped: ${equipment.name} (${equipment.type})\n`);
  }

  if (devicesOnly) return;
  process.stdout.write("\n(--devices-only not given, but the rewrite is not wired yet)\n");
}

main(process.argv.slice(2));

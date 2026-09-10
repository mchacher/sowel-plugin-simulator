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

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
  slug,
} from "./derive.js";
import { emitDevices } from "./emit.js";
import { readBackup, writeBackup } from "./io.js";
import { INTEGRATION_ID } from "../../src/index.js";
import { declare, PROHIBITED_KEYS } from "../../src/publish/catalogue.js";
import {
  ATTACH_TO_EQUIPMENT_NAMED,
  buildAdditions,
  NEW_EQUIPMENTS,
  occupantEquipments,
} from "./additions.js";
import {
  columnsOf,
  rewrite,
  shape,
  stableId,
  type RewriteTarget,
  type TableColumns,
} from "./rewrite.js";

const SIMULATOR_MANIFEST = JSON.parse(readFileSync("manifest.json", "utf8")) as {
  version: string;
};
const SIMULATOR_VERSION = SIMULATOR_MANIFEST.version;

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

  const generatedPath = "src/house/devices.generated.ts";
  writeFileSync(generatedPath, emitDevices(devices, basename(input)));
  // A generated file still has to pass the repository's own format gate, or
  // every regeneration breaks the build for a reason nobody caused.
  execFileSync("npx", ["prettier", "--write", "--log-level", "warn", generatedPath], {
    stdio: "inherit",
  });

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

  // ── The rewrite ──────────────────────────────────────────────────────────
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const equipmentByName = new Map(equipments.map((equipment) => [equipment.name, equipment]));
  const roomIds = LAYOUT.rooms.map((room) => room.id);

  const occupantLabels = new Map(LAYOUT.occupants.map((o) => [o.id, o.label]));
  const newEquipments = [...NEW_EQUIPMENTS, ...occupantEquipments(occupantLabels)];
  const devicesInNewEquipments = new Set(newEquipments.flatMap((e) => e.deviceIds));

  const targets: RewriteTarget[] = [
    ...result.devices.map((derived) => ({
      equipmentId: derived.equipment.id,
      device: devicesById.get(derived.deviceId) as DeviceSpec,
    })),
    ...devices
      .filter((device) => !result.devices.some((d) => d.deviceId === device.id))
      .map((device) => {
        const attach = ATTACH_TO_EQUIPMENT_NAMED[device.id];
        const equipmentId =
          attach && !attach.startsWith("__") ? equipmentByName.get(attach)?.id : undefined;
        return { equipmentId, device };
      }),
  ];

  const columns: TableColumns = {
    devices: columnsOf(tables.devices, []),
    deviceData: columnsOf(tables.device_data, []),
    deviceOrders: columnsOf(tables.device_orders, []),
    dataBindings: columnsOf(tables.data_bindings, []),
    orderBindings: columnsOf(tables.order_bindings, []),
    equipments: columnsOf(tables.equipments, []),
  };

  const rewritten = rewrite({
    targets,
    roomIds,
    columns,
    integrationId: INTEGRATION_ID,
    fixture: {
      devices: tables.devices,
      deviceData: tables.device_data,
      deviceOrders: tables.device_orders,
      dataBindings: tables.data_bindings,
      orderBindings: tables.order_bindings,
    },
  });

  const zoneByName = new Map([...zones.values()].map((zone) => [slug(zone.name), zone.id]));
  const rootZone = [...zones.values()].find((zone) => zone.parent_id === null)?.id ?? null;
  const additions = buildAdditions(
    newEquipments,
    devicesById,
    roomIds,
    columns,
    (room) => (room ? (zoneByName.get(room) ?? rootZone) : rootZone),
    new Map(equipments.map((equipment) => [equipment.name, equipment.id])),
  );

  // ── The simulation order bindings, on every equipment that can carry one ──
  const simBindings = buildSimulationBindings(
    targets,
    roomIds,
    devicesInNewEquipments,
    columns.orderBindings,
  );

  // ── Assemble ─────────────────────────────────────────────────────────────
  tables.devices = rewritten.devices;
  tables.device_data = rewritten.deviceData;
  tables.device_orders = rewritten.deviceOrders;
  tables.data_bindings = [...rewritten.dataBindings, ...additions.dataBindings];
  tables.order_bindings = [...rewritten.orderBindings, ...additions.orderBindings, ...simBindings];
  tables.equipments = [
    ...equipments.filter((e) => !result.dropped.some((d) => d.id === e.id)),
    ...additions.equipments,
  ] as unknown as Row[];

  prune(tables);
  enrolFlexibleLoads(tables);
  addSurplusRecipe(tables);
  uniformColumns(tables);
  const problems = verify(
    tables,
    result.dropped.map((e) => e.id),
  );

  process.stdout.write(
    `\n${tables.device_data.length} data rows, ${tables.device_orders.length} order rows\n` +
      `${rewritten.dataBindings.length} data bindings kept (${rewritten.dropped.filter((d) => d.kind === "data").length} dropped), ` +
      `+${additions.dataBindings.length} added\n` +
      `${rewritten.orderBindings.length} order bindings kept (${rewritten.dropped.filter((d) => d.kind === "order").length} dropped), ` +
      `+${additions.orderBindings.length + simBindings.length} added (${simBindings.length} simulation)\n` +
      `${tables.equipments.length} equipments, ${tables.recipe_instances.length} recipe instances\n`,
  );
  // Named by equipment, because a drop is only reviewable if you can see whose it
  // was: `operationMode` on a thermostat is a defect, `nanoe` on one is the point.
  const nameOf = new Map(equipments.map((equipment) => [equipment.id, equipment.name]));
  const byEquipment = new Map<string, string[]>();
  for (const drop of rewritten.dropped) {
    const where = nameOf.get(drop.equipmentId) ?? drop.equipmentId;
    byEquipment.set(where, [
      ...(byEquipment.get(where) ?? []),
      `${drop.key}${drop.category ? `:${drop.category}` : ""}`,
    ]);
  }
  for (const [where, keys] of [...byEquipment].sort()) {
    process.stdout.write(`  dropped from ${where}: ${keys.sort().join(", ")}\n`);
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    fail(`${problems.length} problem(s): the fixture would come up broken.`);
  }

  const out = outPath(argv);
  writeBackup(out, backup);
  process.stdout.write(`\nwrote ${out}\n`);
}

function outPath(argv: string[]): string {
  const index = argv.indexOf("--out");
  return index >= 0 && argv[index + 1] ? argv[index + 1] : "docs/fixtures/demo-fr.zip";
}

/**
 * An order binding for every `sim.*` order in the house (FR5).
 *
 * Without these the simulation orders are unreachable: Sowel has no device-level
 * order route, so the only path that reaches a plugin is
 * `POST /equipments/:id/orders/:alias`.
 */
function buildSimulationBindings(
  targets: RewriteTarget[],
  roomIds: readonly string[],
  alreadyBound: Set<string>,
  columns: readonly string[],
): Row[] {
  const out: Row[] = [];
  for (const target of targets) {
    // The ones in NEW_EQUIPMENTS got theirs when their equipment was built.
    if (alreadyBound.has(target.device.id) || !target.equipmentId) continue;
    for (const order of declare(target.device, roomIds).orders) {
      if (!order.key.startsWith("sim.")) continue;
      out.push(
        shape(columns, {
          id: stableId(`sim-binding:${target.equipmentId}:${target.device.id}:${order.key}`),
          equipment_id: target.equipmentId,
          device_order_id: stableId(`order:${target.device.id}:${order.key}`),
          alias: order.key,
        }),
      );
    }
  }
  return out;
}

/** Everything that has no place in a public demo (FR6). */
function prune(tables: Record<string, Row[]>): void {
  tables.users = [];
  tables.api_tokens = [];
  tables.refresh_tokens = [];
  tables.mqtt_brokers = [];
  tables.mqtt_publishers = [];
  tables.mqtt_publisher_mappings = [];
  tables.notification_publishers = [];
  tables.notification_publisher_mappings = [];
  // The twelve integration rows go: hardware that is not there would show twelve
  // red cards, and the simulator installs itself. **The ten recipe rows stay** —
  // they are the demo. Without them the engine has no recipe definitions and the
  // twenty-one instances in this fixture are twenty-one rows pointing at nothing,
  // which is the difference between a house that automates itself and a house that
  // only answers when clicked. The packages are public, and a fresh instance
  // downloads the ones it is missing on startup (core spec 058).
  const recipes = tables.plugins.filter((row) => row.type === "recipe");
  // The fixture registers the simulator itself, so restoring it is one step and
  // not two. A missing package is downloaded on startup (core spec 058), which is
  // how the recipes above already arrive, so a restore onto a bare instance comes
  // up complete.
  tables.plugins = [
    ...recipes,
    shape(columnsOf(tables.plugins, []), {
      id: INTEGRATION_ID,
      version: SIMULATOR_VERSION,
      enabled: 1,
      manifest: JSON.stringify(SIMULATOR_MANIFEST),
      type: "integration",
      source: "registry",
      // Borrowed from a row the fixture already has, so the format is the
      // restore's own and the output stays byte-stable between runs.
      installed_at: recipes[0]?.installed_at ?? "2026-01-01 00:00:00",
      pinned_sha256: null,
    }),
  ];
  tables.settings = tables.settings.filter(
    (row) => !String(row.key ?? "").startsWith("integration."),
  );
}

/**
 * Enrol the flexible loads with the capacity arbiter (spec 003, FR6 amended).
 *
 * The fixture was exported in May, before core spec 140 existed, so its
 * `equipments` table has no `energy_profile` column and nothing in it is
 * claimable. Preserving the fixture faithfully therefore means shipping a demo
 * whose arbiter is switched off — and the arbiter is the hardest thing in Sowel
 * to show and one of the better reasons for the showroom to exist.
 *
 * So the profiles are **added**, like the occupants and the `sim.*` bindings, and
 * the arbiter is switched on. Three deferrable loads, which is a real contest
 * against a midday surplus above 4 kW rather than a single load that always wins.
 *
 * Only `deferrable` loads are enrolled. Spec 140's `comfort` class arbitrates a
 * *boost* over a baseline, and this simulator has no notion of boosting a heat
 * pump — declaring one would have the arbiter grant capacity for behaviour the
 * model does not exhibit.
 */
function enrolFlexibleLoads(tables: Record<string, Row[]>): void {
  // Order matters: the list is read top-down to grant and bottom-up to revoke.
  // The water heater first, because the seven kelvin it stores are the only
  // surplus in the house that is still there tomorrow. Then the pool pump, then
  // the pool heat pump — that way round because the heat pump is interlocked on
  // the pump, so granting the heat pump first would buy nothing until the pump
  // got its turn.
  const profiles: { name: string; profile: Record<string, unknown> }[] = [
    {
      name: "Ballon Thermodynamique",
      profile: { class: "deferrable", nominalPowerW: 600, minOnS: 900, minOffS: 600 },
    },
    {
      name: "Pompe Piscine",
      profile: { class: "deferrable", nominalPowerW: 750, minOnS: 1800, minOffS: 900 },
    },
    {
      name: "PAC Piscine",
      profile: { class: "deferrable", nominalPowerW: 1500, minOnS: 1800, minOffS: 900 },
    },
  ];

  const byName = new Map(tables.equipments.map((row) => [row.name as string, row]));
  const priority: string[] = [];
  for (const { name, profile } of profiles) {
    const equipment = byName.get(name);
    if (!equipment) fail(`cannot enrol ${name}: no such equipment in the fixture`);
    equipment.energy_profile = JSON.stringify(profile);
    priority.push(equipment.id as string);
  }

  const meter = tables.equipments.find((row) => row.type === "main_energy_meter");
  if (!meter) fail("cannot enrol the arbiter: the fixture has no main energy meter");

  const columns = columnsOf(tables.settings, []);
  const settings = new Map(tables.settings.map((row) => [row.key as string, row]));
  for (const [key, value] of [
    ["energy.arbiter.enabled", "true"],
    ["energy.arbiter.priority", JSON.stringify(priority)],
    ["energy.arbiter.meterEquipmentId", meter.id as string],
  ] as const) {
    settings.set(key, shape(columns, { key, value }));
  }
  tables.settings = [...settings.values()];
  process.stdout.write(
    `${priority.length} flexible loads enrolled, arbiter on, meter ${String(meter.name)}\n`,
  );
}

/**
 * The surplus recipe (spec 003, FR6 amended).
 *
 * Enrolling the flexible loads is not enough: spec 140 is explicit that the
 * arbiter **issues no orders** — recipes claim capacity, the user's priority list
 * orders the claims, the arbiter grants, and the **recipe** acts. Without a
 * claimant the three enrolled loads sit at `idle` whatever the surplus, and the
 * arbitration surface is a list of things that never happen.
 *
 * The fixture has no surplus-aware recipe because it was exported before the
 * arbiter existed. So one is added: `water-heater-solar`, whose description is
 * this demo's case word for word — it closes the heater's dedicated solar contact
 * on granted surplus and leaves the off-peak heating to the appliance.
 *
 * One instance, on the one load whose stored kelvin are still there tomorrow.
 */
const SURPLUS_RECIPE = {
  id: "water-heater-solar",
  version: "0.2.0",
  manifest: {
    id: "water-heater-solar",
    type: "recipe",
    name: "Water Heater on Solar Surplus",
    version: "0.2.0",
    description:
      "Heats your water heater on solar surplus through its dedicated solar contact, coordinated by the energy arbiter. Off-peak heating stays owned by the appliance.",
    icon: "Sun",
    repo: "mchacher/sowel-recipe-water-heater-solar",
    author: "mchacher",
    sowelVersion: ">=1.52.0",
  },
} as const;

function addSurplusRecipe(tables: Record<string, Row[]>): void {
  const heater = tables.equipments.find((row) => row.name === "Ballon Thermodynamique");
  if (!heater) fail("cannot add the surplus recipe: the water heater is not in the fixture");

  const template = tables.plugins.find((row) => row.type === "recipe");
  tables.plugins = [
    ...tables.plugins,
    shape(columnsOf(tables.plugins, []), {
      id: SURPLUS_RECIPE.id,
      version: SURPLUS_RECIPE.version,
      enabled: 1,
      manifest: JSON.stringify(SURPLUS_RECIPE.manifest),
      type: "recipe",
      source: "registry",
      installed_at: template?.installed_at ?? "2026-01-01 00:00:00",
      pinned_sha256: null,
    }),
  ];

  const instances = tables.recipe_instances ?? [];
  tables.recipe_instances = [
    ...instances,
    shape(columnsOf(instances, []), {
      id: stableId(`recipe-instance:${SURPLUS_RECIPE.id}`),
      recipe_id: SURPLUS_RECIPE.id,
      params: JSON.stringify({ zone: heater.zone_id, heater: heater.id }),
      enabled: 1,
      created_at: instances[0]?.created_at ?? "2026-01-01 00:00:00",
    }),
  ];
  process.stdout.write(`surplus recipe added on ${String(heater.name)}\n`);
}

/**
 * Give every row of a table the same columns (spec 003, FR3).
 *
 * Not tidiness — correctness. The core's restore builds its INSERT from
 * `Object.keys(firstRow)` and projects every other row onto that list
 * (`backup-manager.ts`), so a column the **first** row happens to lack is
 * silently dropped for the whole table. Adding `energy_profile` to three
 * equipments out of eighty-six therefore restored as three nulls, and the
 * arbiter came up with nothing enrolled and no error anywhere.
 *
 * Filed upstream as mchacher/sowel#939. Until a restore reads the union of keys,
 * a fixture has to hand it rows that are already uniform.
 */
function uniformColumns(tables: Record<string, Row[]>): void {
  for (const [name, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue;
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    tables[name] = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
    );
  }
}

/**
 * Refuse to emit a fixture that half works (FR3). A demo that comes up with three
 * broken cards teaches the visitor that Sowel is broken.
 */
function verify(tables: Record<string, Row[]>, droppedEquipmentIds: string[]): string[] {
  const problems: string[] = [];
  const dataIds = new Set(tables.device_data.map((row) => row.id as string));
  const orderIds = new Set(tables.device_orders.map((row) => row.id as string));
  const deviceIds = new Set(tables.devices.map((row) => row.id as string));
  const equipmentIds = new Set(tables.equipments.map((row) => row.id as string));
  const zoneIds = new Set(tables.zones.map((row) => row.id as string));
  const dropped = new Set(droppedEquipmentIds);

  for (const row of tables.device_data) {
    if (!deviceIds.has(row.device_id as string))
      problems.push(`device_data ${row.key} has no device`);
  }
  for (const binding of tables.data_bindings) {
    if (!dataIds.has(binding.device_data_id as string)) {
      problems.push(`data binding ${binding.alias} points at nothing`);
    }
    if (!equipmentIds.has(binding.equipment_id as string)) {
      problems.push(`data binding ${binding.alias} has no equipment`);
    }
  }
  for (const binding of tables.order_bindings) {
    if (!orderIds.has(binding.device_order_id as string)) {
      problems.push(`order binding ${binding.alias} points at nothing`);
    }
    if (!equipmentIds.has(binding.equipment_id as string)) {
      problems.push(`order binding ${binding.alias} has no equipment`);
    }
  }
  for (const equipment of tables.equipments) {
    const zone = equipment.zone_id as string | null;
    if (zone !== null && !zoneIds.has(zone)) problems.push(`${equipment.name} is in no zone`);
  }
  for (const table of [
    "recipe_instances",
    "dashboard_widgets",
    "button_action_bindings",
    "chart_configs",
  ]) {
    for (const row of tables[table] ?? []) {
      for (const field of ["equipment_id", "source_id", "target_equipment_id"]) {
        const value = row[field] as string | undefined;
        if (!value) continue;
        if (dropped.has(value)) problems.push(`${table} names the dropped equipment ${value}`);
      }
    }
  }
  const recipePackages = new Set(tables.plugins.map((row) => row.id as string));
  for (const instance of tables.recipe_instances ?? []) {
    const recipeId = instance.recipe_id as string;
    if (!recipePackages.has(recipeId)) {
      problems.push(`recipe instance needs the ${recipeId} package, which was pruned`);
    }
  }
  // Enrolment is an addition, so it is exactly the kind of thing that rots when
  // an equipment is renamed upstream. Check it here rather than discovering a
  // silently disabled arbiter on the demo.
  const enabled = tables.settings.find((row) => row.key === "energy.arbiter.enabled");
  if (enabled?.value !== "true") problems.push("the capacity arbiter is not enabled");
  const profiled = tables.equipments.filter((row) => row.energy_profile);
  if (profiled.length < 2) {
    problems.push(`${profiled.length} flexible load(s) enrolled: the arbiter has no contest`);
  }
  // The arbiter issues no orders of its own, so enrolled loads with no recipe to
  // claim them sit idle for ever. An arbitration surface listing things that
  // never happen is worse than not showing one.
  const claimants = (tables.recipe_instances ?? []).filter(
    (row) => row.recipe_id === SURPLUS_RECIPE.id && row.enabled,
  );
  if (claimants.length === 0) problems.push("no recipe claims capacity: the arbiter has no work");
  const priorityRaw = tables.settings.find((row) => row.key === "energy.arbiter.priority");
  const priority: string[] = priorityRaw ? JSON.parse(String(priorityRaw.value)) : [];
  for (const id of priority) {
    if (!equipmentIds.has(id)) problems.push(`arbiter priority names a missing equipment ${id}`);
  }
  if (priority.length !== profiled.length) {
    problems.push(`${priority.length} in the priority list but ${profiled.length} profiled`);
  }

  // The restore reads its column list from the first row of each table, so a
  // ragged table loses columns without saying so (#939). Check for raggedness
  // here, where it is still cheap to see.
  for (const [name, rows] of Object.entries(tables)) {
    if (rows.length < 2) continue;
    const first = Object.keys(rows[0]).join(",");
    const ragged = rows.find((row) => Object.keys(row).join(",") !== first);
    if (ragged)
      problems.push(`${name} has rows of differing shape: the restore would lose columns`);
  }

  for (const key of PROHIBITED_KEYS) {
    if (tables.device_data.some((row) => row.key === key))
      problems.push(`${key} survived the rewrite`);
    if (tables.device_orders.some((row) => row.key === key))
      problems.push(`${key} survived the rewrite`);
  }
  return problems;
}

main(process.argv.slice(2));

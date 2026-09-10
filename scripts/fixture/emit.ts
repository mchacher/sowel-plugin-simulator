/**
 * Emitting the generated half of the house description (spec 003, FR1).
 *
 * This file is written, not edited. It says so at the top, and the reason it can
 * say so honestly is that the hand-written half lives in a different file.
 */

import type { DeviceSpec } from "../../src/house/types.js";

function literal(device: DeviceSpec): string {
  const parts = [
    `id: ${JSON.stringify(device.id)}`,
    `archetype: ${JSON.stringify(device.archetype)}`,
  ];
  if (device.room) parts.push(`room: ${JSON.stringify(device.room)}`);
  if (device.occupant) parts.push(`occupant: ${JSON.stringify(device.occupant)}`);
  if (device.load) parts.push(`load: ${JSON.stringify(device.load)}`);
  if (device.solarChannel) parts.push("solarChannel: true");
  if (device.channels !== undefined) parts.push(`channels: ${device.channels}`);
  return `  { ${parts.join(", ")} },`;
}

export function emitDevices(devices: DeviceSpec[], fixtureName: string): string {
  const header = `/**
 * GENERATED — do not edit.
 *
 * One device per equipment of the demo fixture, derived by
 * \`scripts/fixture/build.ts\` from ${fixtureName}. Re-run it rather than editing
 * this file; the half of the house a fixture cannot know is in \`layout.ts\`.
 *
 * Device ids are the contract: \`friendlyName\` becomes \`source_device_id\`, and
 * that is what a binding resolves against. Renaming one here breaks a binding in
 * every installed instance.
 */

import type { DeviceSpec } from "./types.js";

export const GENERATED_DEVICES: DeviceSpec[] = [
`;
  // Sorted by id: a generated file is read as a diff more often than as a list.
  const sorted = [...devices].sort((a, b) => a.id.localeCompare(b.id));
  return `${header}${sorted.map(literal).join("\n")}\n];\n`;
}

#!/usr/bin/env python3
"""
Read a Sowel backup and report what is in it, in simulator terms.

Spec 003 remaps the core's anonymised showroom fixture onto this plugin's
devices. The mapping has to be **derived** rather than guessed: an equipment's
archetype follows from its type and from the categories its bindings actually
resolve to, and its room follows from the zone tree. This script is that
derivation, printed, so a person or an agent starts from facts.

    python3 scripts/analyse-fixture.py ../sowel/docs/fixtures/showroom-fr.zip
"""

from __future__ import annotations

import json
import sys
import zipfile
from collections import Counter, defaultdict


def archetype_for(equipment_type: str, categories: set[str]) -> str:
    """The simulator archetype an equipment maps onto (docs/devices.md)."""
    if equipment_type == "sensor":
        if "motion" in categories and "luminosity" in categories:
            return "motion_lux"
        if "motion" in categories:
            return "motion"
        if "temperature" in categories:
            return "th_probe"
        return "?"
    return {
        "light_onoff": "relay",
        "light_dimmable": "dimmer",
        "light_color": "dimmer",
        "shutter": "shutter",
        "button": "button",
        "thermostat": "thermostat",
        "heater": "heater",
        "gate": "gate",
        "water_valve": "valve",
        "water_heater": "relay",
        "switch": "relay",
        "pool_pump": "relay",
        "pool_cover": "pool_cover",
        "pool_heat_pump": "pool_heat_pump",
        "weather": "outdoor_module",
        "weather_forecast": "forecast",
        "main_energy_meter": "grid_clamp",
        "energy_production_meter": "pv",
        "energy_meter": "subload_clamp",
        "appliance": "metered_appliance",
        # Dropped by decision, not by oversight: docs/devices.md puts media
        # players out of scope, and core issue #932 says a freshly bound one has
        # no power control anyway (spec 003).
        "media_player": "-dropped-",
    }.get(equipment_type, "?")


def load(path: str) -> dict:
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            with archive.open("sowel-backup.json") as handle:
                return json.load(handle)["tables"]
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def main(path: str) -> int:
    tables = load(path)
    zones = {z["id"]: z for z in tables["zones"]}
    device_data = {x["id"]: x for x in tables["device_data"]}

    bindings = defaultdict(list)
    for binding in tables["data_bindings"]:
        bindings[binding["equipment_id"]].append(binding)

    def zone_path(zone_id: str | None) -> str:
        names, seen = [], set()
        while zone_id and zone_id in zones and zone_id not in seen:
            seen.add(zone_id)
            names.append(zones[zone_id]["name"])
            zone_id = zones[zone_id].get("parent_id")
        return " / ".join(reversed(names))

    def categories(equipment_id: str) -> set[str]:
        found = set()
        for binding in bindings[equipment_id]:
            entry = device_data.get(binding.get("device_data_id"))
            if entry and entry.get("category"):
                found.add(entry["category"])
        return found

    print(f"{len(tables['zones'])} zones, {len(tables['equipments'])} equipments, "
          f"{len(tables['devices'])} devices, {len(tables['recipe_instances'])} recipe instances")
    print()

    unmapped, archetypes = [], Counter()
    print(f"{'equipment':30} {'type':24} {'archetype':16} zone")
    print("-" * 110)
    for equipment in sorted(
        tables["equipments"], key=lambda e: (zone_path(e["zone_id"]), e["type"], e["name"])
    ):
        archetype = archetype_for(equipment["type"], categories(equipment["id"]))
        archetypes[archetype] += 1
        if archetype == "?":
            unmapped.append(equipment)
        print(
            f"{equipment['name'][:29]:30} {equipment['type']:24} {archetype:16} "
            f"{zone_path(equipment['zone_id'])}"
        )

    print()
    print("archetypes:", dict(archetypes.most_common()))
    if archetypes["-dropped-"]:
        print(f"{archetypes['-dropped-']} equipment(s) dropped by decision (spec 003)")
    if unmapped:
        print()
        print("NOT MAPPED — each one is a decision, not an oversight:")
        for equipment in unmapped:
            print(f"  {equipment['name']} ({equipment['type']}) — {sorted(categories(equipment['id']))}")
    return 1 if unmapped else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))

# Devices the simulator publishes

The input to the phase 1 spec: **what** the simulator has to publish, decided before
anyone writes a line of it.

Built from two sources. The maintainer's real installation, through the anonymised
fixture `docs/fixtures/showroom-fr.zip` in `mchacher/sowel` — 96 devices, 40 distinct
shapes. And a reading of all ten integration plugins that produced them:
`zigbee2mqtt`, `lora2mqtt`, `tasmota`, `shelly-mqtt`, `panasonic-cc`, `mcz-maestro`,
`netatmo-weather`, `weather-forecast`, `apsystems`, `polytropic-master`.

## The level this document works at

**A plugin publishes devices. It never mentions an equipment type.**

That is not a style preference, it is the plugin API. `sowel-plugin-zigbee2mqtt` does
not contain the string `EquipmentType`, and neither does any other. A plugin calls
`upsertFromDiscovery` with, per reading, `{ key, type, category, unit?, enumValues? }`
and per order `{ key, type, category?, min?, max?, enumValues? }`, then pushes values
with `updateDeviceData`. Whether those readings end up on a `light_onoff` or a
`sensor` is decided later, by a person binding an equipment.

The product works the same way where it matters: the core's thermostat contract
identifies a thermostat-capable device from its **`setpoint` / `set_setpoint`
categories**, never from an equipment type.

So the deliverable is a device catalogue, and **the category is the contract**. Get
the categories right and everything downstream follows on its own: binding
suggestions, zone aggregation, the energy surfaces, the thermostat card.

Equipment types remain useful as a _shopping list_ — they say what the demo house must
contain. They are not what this plugin implements. The list is at the end of this
document, where it belongs.

## The catalogue

Each archetype below is one device the simulator declares. Keys are given character
for character: a binding resolves on the key, so an approximation is a broken demo.

### Presence and environment sensors

| Archetype                    | Readings (`key` → category, type, unit)                                                                                          | Orders |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Motion sensor                | `occupancy` → `motion`, boolean; `battery` → `battery`, number, `%`                                                              | —      |
| Motion + light level         | the above, plus `illuminance` → `luminosity`, number, `lx`                                                                       | —      |
| Door / window contact        | `contact` → `contact_door`, boolean; `battery` → `battery`                                                                       | —      |
| Temperature / humidity probe | `temperature` → `temperature`, number, `°C`; `humidity` → `humidity`, number, `%`; `battery` → `battery`                         | —      |
| Indoor air quality           | `temperature`, `humidity`, `pressure` → `pressure`, number, `hPa`; `co2` → `co2`, number, `ppm`; `noise` → `noise`, number, `dB` | —      |
| Button / remote              | `action` → `action`, enum; `battery` → `battery`                                                                                 | —      |

**Contact is inverted.** Zigbee declares `contact` as true-means-**closed**. The
simulator must publish it that way; a door that reads `true` when open is a door every
recipe gets backwards.

`action` is momentary: publish the event value, then clear it. Realistic vocabularies
are `single`, `double`, `hold`.

### Actuators

| Archetype           | Readings                                                                  | Orders                                                                                                        |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Relay / light       | `state` → `light_state`, boolean                                          | `state` → `light_toggle`, boolean                                                                             |
| Multi-channel relay | `power1` … `power4` → `light_state`, boolean                              | same keys → `light_toggle`                                                                                    |
| Dimmable light      | `state` → `light_state`; `brightness` → `light_brightness`, number, 0–254 | `state` → `light_toggle`; `brightness` → `set_brightness`, min 0, max 254                                     |
| Shutter             | `position` → `shutter_position`, number, `%`, 0–100                       | `position` → `set_shutter_position`, min 0, max 100; `state` → `shutter_move`, enum `["OPEN","CLOSE","STOP"]` |
| Gate                | `R1` → `gate_state`, boolean                                              | `R1` → `gate_trigger`                                                                                         |
| Water valve         | `state` → `light_state`, boolean                                          | `state` → `light_toggle`                                                                                      |

**On/off is a boolean everywhere.** In the field it has no single shape: a Zigbee relay
is a boolean carrying its own wire values `ON` / `OFF`, a Tasmota relay is an enum of
exactly those two strings, and [core issue #930](https://github.com/mchacher/sowel/issues/930)
is about eighteen modules downstream defending against both. A greenfield plugin has no
reason to reproduce that. Every on/off here is `type: "boolean"`, on every archetype,
with no wire literals at all — the simulator has no wire.

**Brightness travels on the Zigbee 0 to 254 scale**, not a percentage. A device's
declared `min` / `max` are ignored downstream and that range is hard-coded in the
interface (core issue #933), so a light declaring 0 to 100 would read 39 % at full
power. Publish 0 to 254 until #933 is fixed, then revisit.

A shutter reports **only its position**; `state` is write-only. Position 0 is closed
and 100 is open, and the value must travel over a few seconds rather than jump.

### Climate

| Archetype              | Readings                                                                                                                                                                                           | Orders                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Heat pump / thermostat | `temperature` → `temperature`, `°C`; `setpoint` → `setpoint`, `°C`; `state` → `light_state`, boolean; `operationMode` → `operation_mode`, enum; `outsideTemperature` → `temperature_outdoor`, `°C` | `power` → `toggle_power`; `setpoint` → `set_setpoint`, min 16, max 30; `operationMode` → `set_operation_mode` |
| Pool heat pump         | `water_temperature` → `pool_water_temperature`, `°C`; `outdoor_temperature` → `temperature_outdoor`; `setpoint` → `pool_temperature_setpoint`                                                      | `setpoint` → `set_pool_temperature_setpoint`, min 10, max 30                                                  |
| Electric heater        | `state` → `light_state`, boolean                                                                                                                                                                   | `state` → `light_toggle`                                                                                      |

**The run state does not go under `power`.** Core spec 176 binds a thermostat's boolean
run state to the same `state` alias every relay-style equipment uses, because on a
submetered unit the `power` alias is the wattage read from a clamp — and
`UNIQUE(equipment_id, alias)` means whichever binds first evicts the other, which is
how a real heat pump lost its on/off ([core issue #901](https://github.com/mchacher/sowel/issues/901)).
Declaring the boolean under category `power` does work, but only because the core
rescues that case for the plugin that got there first. `light_state` maps to the
`state` alias directly, and a greenfield plugin has no reason to need rescuing.

`operationMode` takes the core's closed vocabulary: `auto`, `heat`, `cool`, `dry`,
`fan`, `off` — and declares only the modes the simulated unit actually has. A mode a
device cannot honour is vendor noise like any other.

**Worth knowing: no plugin publishes the `operation_mode` / `set_operation_mode`
categories today.** The contract declares them, the real integrations have not adopted
them yet — that is open core issue #922. The simulator would be the first publisher,
which is a good reason to get it exactly right.

The measured temperature must **chase** the setpoint with a first-order lag and
overshoot it slightly, never snap to it. When the unit is off it drifts toward outdoor
temperature instead.

### Energy

| Archetype         | Readings                                                                                                                                                                                            | Orders |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Grid clamp        | `power` → `power`, number, `W`, **signed**; `voltage` → `voltage`, `V`; `current` → `current`, `A`; `energy_forward` → `energy`, `Wh`; `energy_reverse` → `energy`, `Wh`; `energy` → `energy`, `Wh` | —      |
| Sub-load clamp    | `power` → `power`, `W`; `energy` → `energy`, `Wh`                                                                                                                                                   | —      |
| PV inverter       | `power` → `power`, `W`; `energy` → `energy`, `Wh`                                                                                                                                                   | —      |
| Metered appliance | `power`, `energy`, plus `state` → `appliance_state`, enum                                                                                                                                           | —      |

**The `energy` category carries a delta, never a cumulative counter.** This is the
convention across the whole product: `energy` is the Wh consumed since the previous
report. Cumulative totals live under `energy_forward` and `energy_reverse`, which are
monotonic. Publishing a cumulative value under `energy` corrupts every energy page.

On a grid clamp, `power` is signed: negative means export.

**`appliance_state` carries exactly two values.** Two real plugins publish four
(`idle`, `running`, `pause`, `finished`) but the core charts the category as binary and
clips the rest (core issue #936). The simulator declares `["on","off"]` — the richer
vocabulary is worth having only once the chart supports it.

**A flexible load is a relay _and_ a clamp.** The energy arbiter (core spec 140)
reserves a granted load's measured draw when a `power` binding exists, and falls back to
a nominal when it does not. So every arbitrable load in the demo — water heater, pool
pump — gets both a relay archetype and a sub-load clamp. A metered load nobody can
switch is a bar chart, not a flexible load.

**A water heater carries two relays.** Core spec 152 models the real case: the appliance
stays on permanent mains and its own programme decides normal heating, while a separate
dry-contact input forces it to heat on surplus. Two distinct physical relays, and
nothing at discovery tells them apart — spec 152 is explicit that the solar role is
assigned by hand, never guessed. So this plugin declares two ordinary relays and nothing
solar-specific; whoever binds them assigns one to the main on/off and the other to the
"Solaire" role. The category is the contract; the meaning is the equipment layer's.

### Weather

| Archetype      | Readings                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outdoor module | `temperature` → `temperature_outdoor`, `°C`; `humidity` → `humidity_outdoor`, `%`; `battery`                                                                                                    |
| Rain gauge     | `rain` → `rain`, `mm` (last hour); `sum_rain_24` → `rain`, `mm` (monotonic within a day)                                                                                                        |
| Wind gauge     | `wind_strength`, `wind_angle`, `gust_strength`, `gust_angle` → `wind`                                                                                                                           |
| Forecast       | for each day 1 to 5: `j{i}_condition` → `weather_condition`, enum; `j{i}_temp_min`, `j{i}_temp_max` → `temperature_outdoor`; `j{i}_rain_prob` → `rain`, `%`; `j{i}_wind_gusts` → `wind`, `km/h` |

The forecast device is named literally `Weather Forecast`, and **there is no day 0** —
the series starts at tomorrow.

`condition` values: `sunny`, `partly_cloudy`, `cloudy`, `foggy`, `rainy`, `snowy`,
`stormy`. They must agree with `rain_prob`: sunny near 0, rainy 60 to 95.

### Occupants

| Archetype | Readings                                                                         | Orders |
| --------- | -------------------------------------------------------------------------------- | ------ |
| Occupant  | `zone` → `generic`, enum of room ids plus `away`; `present` → `generic`, boolean | —      |

**These are not how presence reaches Sowel.** An occupant is not in a zone — it moves
between them — so it is not something a person binds to an equipment. What a person
binds is a motion sensor in a room, and that sensor fires because an occupant is in it.
The occupant devices exist for the 3D application and for debugging, which is why they
sit under `generic` and expose no orders.

### Simulation orders

Orders no real device has, so a visitor can act on the world through the ordinary
order path — bindings, aliases, audit log and WebSocket all apply unchanged.

| Order                     | On                  | Value                      | Effect                                                        |
| ------------------------- | ------------------- | -------------------------- | ------------------------------------------------------------- |
| `sim.motion`              | motion sensors      | trigger                    | A motion pulse: the sensor reports occupancy for a hold time. |
| `sim.open` / `sim.close`  | contacts            | trigger                    | The door opens for a few seconds, or closes now.              |
| `sim.temperature`         | probes, thermostats | number, −10 to 40 °C       | Nudges the room and lets the thermal model bring it back.     |
| `sim.weather`             | the outdoor module  | enum, the conditions above | Forces the sky for the rest of the local day.                 |
| `sim.enter` / `sim.leave` | occupants           | trigger                    | Sends a household member home or out.                         |
| `sim.ghost`               | `sim-house`         | `room` or `id:room`        | Places or moves an ephemeral visitor.                         |

**They carry no category, deliberately.** A category is what every core consumer
keys off, and these are none of the categories the core knows; giving them one
would make a motion sensor look like an actuator in the binding dialog.
Uncategorised they are extras — bound by hand when someone wants them, invisible
otherwise.

`sim-house` is the one device in the house that represents nothing physical. It
exists because ghosts belong to no room, and it reports `ghosts` — how many
visitors are about — under `generic`.

**Visitors never move the household.** `sim.enter` and `sim.leave` exist for the
3D application's own controls; the ordinary way a visitor makes presence is a
ghost of their own, which expires two minutes after their last click.

## Conventions the simulator must honour

**Echo every order.** Nothing in the core synthesises the confirmation. When an order
arrives, the device is expected to republish the affected reading on the same key.
Without that echo the interface sends the command and stays on the old value. Echo
after a plausible delay — instant for a relay, progressive for a shutter.

**Be alive at t = 0.** Five of the six polled plugins declare their devices _inside_
the first poll, so nothing exists until it succeeds. A demo cannot open on an empty
house: declare everything in `start()` and push a first value immediately.

**Cadence, taken from the real installation.** Live power every second and energy
counters every minute, which is what the Shelly clamps do. Environment readings every
few minutes. Motion, contacts and buttons on the event. Anything faster is noise the
WebSocket has to carry to every visitor.

**A PV inverter goes offline at night** rather than publishing 0 W. That is what the
real one does, and the energy pages are written for it.

**Do not publish the config noise.** Zigbee devices carry `linkquality`,
`power_on_behavior`, `keep_time`, `sensitivity`, `lift_duration`, `ballast_*`,
`dimmer_mode`, `indicator_mode`, `on_level`, `device_mode`, `power_outage_count`,
`voltage` — all under category `generic`. Roughly half the readings in the reference
installation are that. None of it is visible to a user; all of it costs WebSocket
traffic and clutters the binding dialogs.

**Do not publish vendor vocabulary.** `nanoe`, `airSwingUD`, `airSwingLR`, `ecoMode`,
`fanSpeed` are Panasonic. `stoveState`, `profile`, `pelletSensor`, `ignitionCount`,
`sparkPlug`, `resetAlarm` are MCZ. `ch1_*`, `serial`, `signal`, `frequency` are
APsystems. A simulated Panasonic that does not talk to Panasonic is a lie about what is
being demonstrated.

## Realistic ranges

Indoor 18 to 24 °C, 35 to 60 % humidity. CO₂ sits near 400 ppm and climbs to 900–1400
in an occupied closed room, decaying over about half an hour once it empties. Noise 30
to 55 dB. Pressure 990 to 1030 hPa.

Outdoor temperature is a daily sine with its minimum near sunrise and its maximum
around three in the afternoon, on a seasonal base. Wind 0 to 40 km/h, gusts one and a
half to twice the strength.

PV production is a bell tied to sun elevation, zero before sunrise and after sunset,
clipped at the inverter's limit and multiplied by a cloud factor that agrees with the
weather being reported elsewhere. Setpoint bands: 16 to 30 °C for a heat pump, 10 to
30 °C for a pool one.

## What the demo house must contain

The shopping list, in equipment terms, because that is how a house is described. It is
context for choosing which devices to instantiate, not a contract this plugin
implements.

Motion lighting needs sensors and relays. Shutters at dusk need shutters. Presence
heating needs a thermostat, a heater and a temperature probe. The energy story needs a
grid clamp, a PV inverter and two or three sub-load clamps. The capacity arbiter needs
at least two flexible loads that can contend — a pool pump and a water heater, each
with its relay and its clamp — and a PV peak large enough that the surplus exceeds them. Add a gate for the timed action, a
water valve for irrigation, a weather station and a forecast, and a button bound to a
mode.

Roughly a dozen zones over two levels, one of most things and a few lights and
shutters. Nothing in the plugin depends on that number: the code is written per
archetype, and having one or ten of an archetype costs the same.

## The fixture is remapped, not just re-badged

The demo house is built from the core's anonymised fixture, so the zones, equipments,
recipes and modes are the shape of a real home. The first plan was to rewrite each
device's `integration_id` to `simulator` and stop there. That is not enough.

The fixture's bindings name the keys the original integrations published. For most
archetypes those already coincide with what this catalogue specifies — `state`,
`position`, `temperature`, `occupancy`, `power`. For the thermostat they do not: the
binding is literally `targetTemperature`, `insideTemperature`, `nanoe`, `ignitionCount`.
Reuse them unchanged and the simulator is forced to publish Panasonic and MCZ
vocabulary to make them resolve.

So the fixture build **also rewrites the keys to this catalogue and re-points the
bindings**, dropping the ones with no counterpart. A few more lines in a script that
already anonymises names, and the difference between a demo that shows a clean
thermostat and one that shows a Panasonic with the badge filed off.

One useful finding while reading the plugins: **Panasonic and MCZ already publish the
right categories** — `setpoint`, `temperature`, `temperature_outdoor`, `power`, and the
orders `set_setpoint` and `toggle_power`. Only their key _names_ are vendor-flavoured,
plus a handful of extras under `generic`. Core issue #922 is therefore smaller than it
looks: the integrations already speak the language, they spell it their own way.

## Deliberately out of phase 1

| Dropped                                              | Why                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `battery` low levels, `linkquality`, offline devices | They belong with simulated hardware faults, which the project map parks for a later phase. A house where nothing ever fails is slightly too clean, but that is a demo of a different thing. |
| Media player                                         | Cheap to fake, demonstrates nothing about a home-automation engine.                                                                                                                         |
| Irrigation cycle counters                            | A scheduling state machine inside a device. The Auto Watering recipe is what the demo should show, and it drives `state`.                                                                   |
| The forecast's irradiance series                     | Two large JSON blobs feeding the PV forecast. Worth faking only if the demo carries that recipe; decide in the spec.                                                                        |
| Every vendor key listed above                        | See the rule.                                                                                                                                                                               |

## How this document stays true

The catalogue restates conventions that live in the core and in ten other
repositories. It will drift. The phase 1 spec decides how that is caught — the
cheapest option being a test that reads the categories from the published core at the
version pinned in `manifest.json` and fails when they diverge. A document is not a
gate; deciding which gate to build is the spec's job.

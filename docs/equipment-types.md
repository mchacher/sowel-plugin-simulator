# Equipment types the simulator implements

The input to the phase 1 spec: **what** the simulator has to simulate, decided
before anyone writes a line of it. Derived from the maintainer's real
installation (74 equipments, 96 devices, 22 zones) through the anonymised
fixture `docs/fixtures/showroom-fr.zip` in `mchacher/sowel`.

## The rule: simulate the type, not the vendor

The cost of this plugin is **per equipment type, not per instance**. Once a `shutter` is
simulated, having one or ten costs nothing. Cutting the instance count from 74
to 38 would have saved almost no work; dropping a type does.

And most of what looks expensive in a type is not the type at all. Read the
real contract of `thermostat` in the fixture:

```
thermostat  reads   airSwingLR, airSwingUD, ecoMode, fanSpeed, ignitionCount,
                    nanoe, operationMode, outsideTemperature, pelletSensor,
                    power, profile, setpoint, sparkPlug, stoveState, temperature
            orders  airSwingLR, airSwingUD, ecoMode, fanSpeed, nanoe,
                    operationMode, power, profile, resetAlarm, setpoint
```

Fifteen readings and ten orders — but that is not one thermostat. It is **two
vendor vocabularies** merged into one type: a Panasonic heat pump contributes
`nanoe`, `airSwingLR`, `ecoMode`, `fanSpeed`; an MCZ pellet stove contributes
`pelletSensor`, `sparkPlug`, `ignitionCount`, `stoveState`.

A thermostat is `temperature`, `setpoint`, `power`, `operationMode`. The rest is
noise from a manufacturer.

**Since 2026-09-07 the product says so itself**, in
`src/shared/thermostat-contract.ts` (spec 177, core issue #921). That file is
the source of truth for this type — not the table below, which cites it. When
the two disagree, the product wins and this document is wrong. **The simulator implements the contract below
and nothing else.** That is what makes the work tractable, and it is also the
honest thing: a simulated Panasonic that does not talk to Panasonic is a lie
about what is being demonstrated.

> This is a statement about **the simulator**, and half of it is now also true
> of the product.
>
> Sowel always defined a contract on three levels: a `DataCategory` taxonomy of
> some forty-five semantic categories, per-type compatibility in
> `computeBindingCandidates`, and reserved aliases per role. What it did not
> define was what a `thermostat` **is** — that branch returned a single
> candidate holding every key the device exposed, labelled "All thermostat
> data/orders". That is how `nanoe`, `airSwingUD`, `pelletSensor` and
> `resetAlarm` became part of a Sowel thermostat, and spec 176 was the bill:
> on the submetered Panasonic, `power` meant the clamp's wattage and the unit's
> on/off at once, the card read OFF while it ran at 2974 W, and the user sent
> five ON orders in ninety seconds. _An alias is not a vocabulary._
>
> **Core issue #921 closed that**, in `src/shared/thermostat-contract.ts`: the
> core aliases, the identity by `setpoint` / `set_setpoint` category rather than
> by a raw vendor key, the closed `operationMode` vocabulary, and a
> `splitThermostatExtras` helper. Extras stay bound and usable; they define
> nothing.
>
> **What is still open is core issue #922**: the Panasonic and MCZ plugins keep
> publishing their own keys, the core still renames two of them, and existing
> bindings still point at the old names. That half carries a migration on
> running heating hardware and is deliberately parked.
>
> **This plugin is on the near side of that gap.** It has no legacy to migrate,
> so it publishes the declared contract from birth — which makes it the first
> integration to speak it properly, before the real plugins do.

## The contract

Every type below is simulated to exactly this list. A reading not listed is not
published; an order not listed is accepted, logged at debug, and ignored — never
an error, per the never-throw rule in `CLAUDE.md`.

| Type                      | Readings                                                                           | Orders                               | Where the value comes from                        |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| `light_onoff`             | `state`                                                                            | `state`                              | the order itself, plus recipes                    |
| `light_dimmable`          | `state`, `brightness`                                                              | `state`, `brightness`                | the order itself                                  |
| `switch`                  | `state`                                                                            | `state`                              | the order itself                                  |
| `heater`                  | `state`                                                                            | `state`                              | the order itself; feeds the thermal model         |
| `pool_pump`               | `state`                                                                            | `state`                              | the order itself; a flexible load for the arbiter |
| `shutter`                 | `position`                                                                         | `position`, `state`                  | the order, with a travel time; gates solar gain   |
| `pool_cover`              | `position`                                                                         | `position`                           | same, slower                                      |
| `button`                  | `action`                                                                           | —                                    | an occupant, or a `sim.*` order                   |
| `gate`                    | `state`                                                                            | `command`                            | a sequential impulse, so spec 174 has its demo    |
| `sensor`                  | `occupancy`, `temperature`, `humidity`, `illuminance`                              | —                                    | **the presence and thermal models**               |
| `thermostat`              | `temperature`, `setpoint`, `state`, `power`, `operationMode`, `outsideTemperature` | `setpoint`, `power`, `operationMode` | **the thermal model**                             |
| `pool_heat_pump`          | `temperature`, `setpoint`, `state`                                                 | `setpoint`, `state`                  | a slow pool thermal model                         |
| `water_valve`             | `state`, `flow`                                                                    | `state`                              | the order itself                                  |
| `weather`                 | `temperature`, `humidity`, `pressure`, `rain`                                      | —                                    | **the environment model**                         |
| `weather_forecast`        | 5 days x `temp_min`, `temp_max`, `condition`, `rain_prob`                          | —                                    | the environment model, projected                  |
| `main_energy_meter`       | `power`, `energy`, `energy_forward`, `energy_reverse`                              | —                                    | **the energy model**, signed grid                 |
| `energy_production_meter` | `power`, `energy`                                                                  | —                                    | **the energy model**, PV                          |
| `energy_meter`            | `power`, `energy`                                                                  | —                                    | **the energy model**, per sub-load                |

Three columns of that table are the actual work: presence, thermal, energy. Every
other type is a façade over one of them, or over the order it just received.

## Where a type is declared by the product, import it

A plugin cannot import from the core's source tree, so the contract is
**restated in this repository and kept honest by a test**, not copied by hand
and left to drift. For `thermostat` that means a fixture in this repo mirrors
`THERMOSTAT_CORE` and `OPERATION_MODE_VALUES`, and the phase 1 spec decides how
it is checked against the published core — the cheapest option being a test that
reads the version pinned in `manifest.json`'s `sowelVersion` and fails when the
two lists diverge.

The rule: when the product declares a type's contract, this plugin follows it. It
never invents a second one, and it never publishes an alias the product would
call an extra.

## Deliberately out of phase 1

| Dropped                                                                                                        | Why                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media_player`                                                                                                 | `power`, `volume`, `input_source` — cheap, but it demonstrates nothing about a home-automation engine.                                                                                                                        |
| The irrigation cycle counters on `water_valve` (`cycles`, `duration`, `interval`, `capacity`, `current_count`) | A scheduling state machine inside a device. The Auto Watering recipe is what the demo should show, and it drives `state`.                                                                                                     |
| Every vendor-specific reading                                                                                  | `nanoe`, `airSwingLR`, `ecoMode`, `fanSpeed`, `pelletSensor`, `sparkPlug`, `ignitionCount`, `stoveState`, `linkquality`, `battery`, `turbo_mode`, `delayed_power_on_*`, `detach_relay_mode` and the rest. See the rule above. |
| `light_color`, `awning`                                                                                        | Present in `EquipmentType`, absent from the reference installation. Add them when a demo needs them.                                                                                                                          |

`battery` and `linkquality` deserve their own line: they are real, they show in
the UI, and a house where nothing ever has a low battery is slightly too clean.
They are out of phase 1 because they belong with simulated hardware faults,
which the project map already parks for a later phase.

## The fixture is remapped, not just re-badged

The demo house is built from the core's anonymised showroom fixture, so the zones,
equipments, recipes and modes are the shape of a real home. The first plan was to
rewrite each device's `integration_id` to `simulator` and stop there. **That is not
enough**, and doing only that would contradict the rule above.

The fixture's bindings name the keys the original integrations published, and for
most types those already coincide with the canonical alias — `state`, `position`,
`temperature`, `occupancy`, `power`. For the thermostat they do not: the binding is
literally `nanoe`, `airSwingLR`, `ignitionCount`. Reuse those bindings unchanged and
the simulator is forced to publish Panasonic and MCZ vocabulary to make them
resolve.

So the fixture build **also rewrites the keys to the contract above and re-points
the bindings**, and drops the bindings with no counterpart. It is a few more lines
in a script that already anonymises names, and it is the difference between a demo
that shows a clean thermostat and one that shows a Panasonic with the badge filed
off.

Pleasant side effect: the demo becomes a working illustration of what core issue
#922 asks the real plugins to do.

## Instances

The instance list is a **separate, cheaper decision**, made when the demo fixture
is built: the types above are what the code must support, and the fixture
chooses how many of each the demo house has. Roughly a dozen zones over two
levels, one of most things and a few lights and shutters, is enough to make every
type visible without turning the 3D house into a maze. Nothing in the plugin
depends on that number.

# Equipment classes the simulator implements

The input to the phase 1 spec: **what** the simulator has to simulate, decided
before anyone writes a line of it. Derived from the maintainer's real
installation (74 equipments, 96 devices, 22 zones) through the anonymised
fixture `docs/fixtures/showroom-fr.zip` in `mchacher/sowel`.

## The rule: simulate the class, not the vendor

The cost of this plugin is **per class, not per instance**. Once a `shutter` is
simulated, having one or ten costs nothing. Cutting the instance count from 74
to 38 would have saved almost no work; dropping a class does.

And most of what looks expensive in a class is not the class at all. Read the
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
noise from a manufacturer, and it is in there because the binding rule for this
type is literally "everything the device exposes" — see the note below. **The simulator implements the class contract below
and nothing else.** That is what makes the work tractable, and it is also the
honest thing: a simulated Panasonic that does not talk to Panasonic is a lie
about what is being demonstrated.

> This is a statement about **the simulator**. It is also an observation about
> the product, recorded here because it was made here — and it is narrower than
> it first looks.
>
> Sowel _does_ define a contract, on three levels. A precise `DataCategory`
> taxonomy of some forty-five semantic categories (`motion`, `setpoint`,
> `shutter_position`, `gate_state`…). Per-type compatibility, in
> `computeBindingCandidates(equipmentType, …)` — a switch on the equipment type
> deciding which device channels may back it. And reserved aliases for specific
> roles: `solar` and `solar_state` (spec 152), and the thermostat's `state`
> (spec 176).
>
> The gap is not that nothing is defined. It is that **`thermostat` opts out**:
>
> ```ts
> case "thermostat":
> case "heater": {
>   // Single candidate grouping everything (power/setpoint/temperature).
>   return [{ id: "all", label: "All thermostat data/orders",
>             dataKeys: deviceData.map((d) => d.key),
>             orderKeys: deviceOrders.map((o) => o.key) }];
> }
> ```
>
> Every key the device exposes becomes a binding. That is precisely how `nanoe`,
> `airSwingLR`, `pelletSensor` and `sparkPlug` became part of a Sowel thermostat,
> and spec 176 is the bill: on the submetered Panasonic, `power` meant two things
> at once — the clamp's wattage and the unit's on/off — the alias is unique per
> equipment, so the boolean had nowhere to live. In production the card showed
> OFF while the unit ran at 2974 W, and the user sent five ON orders in ninety
> seconds. Spec 176 says it in one line: _an alias is not a vocabulary_.
>
> Closing that per-type vocabulary would be a product change, argued in
> `mchacher/sowel` on its own merits. This plugin does not decide it; it simply
> refuses to inherit the consequence.

## The contract

Every class below is simulated to exactly this list. A reading not listed is not
published; an order not listed is accepted, logged at debug, and ignored — never
an error, per the never-throw rule in `CLAUDE.md`.

| Class                     | Readings                                                  | Orders                               | Where the value comes from                        |
| ------------------------- | --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| `light_onoff`             | `state`                                                   | `state`                              | the order itself, plus recipes                    |
| `light_dimmable`          | `state`, `brightness`                                     | `state`, `brightness`                | the order itself                                  |
| `switch`                  | `state`                                                   | `state`                              | the order itself                                  |
| `heater`                  | `state`                                                   | `state`                              | the order itself; feeds the thermal model         |
| `pool_pump`               | `state`                                                   | `state`                              | the order itself; a flexible load for the arbiter |
| `shutter`                 | `position`                                                | `position`, `state`                  | the order, with a travel time; gates solar gain   |
| `pool_cover`              | `position`                                                | `position`                           | same, slower                                      |
| `button`                  | `action`                                                  | —                                    | an occupant, or a `sim.*` order                   |
| `gate`                    | `state`                                                   | `command`                            | a sequential impulse, so spec 174 has its demo    |
| `sensor`                  | `occupancy`, `temperature`, `humidity`, `illuminance`     | —                                    | **the presence and thermal models**               |
| `thermostat`              | `temperature`, `setpoint`, `power`, `operationMode`       | `setpoint`, `power`, `operationMode` | **the thermal model**                             |
| `pool_heat_pump`          | `temperature`, `setpoint`, `state`                        | `setpoint`, `state`                  | a slow pool thermal model                         |
| `water_valve`             | `state`, `flow`                                           | `state`                              | the order itself                                  |
| `weather`                 | `temperature`, `humidity`, `pressure`, `rain`             | —                                    | **the environment model**                         |
| `weather_forecast`        | 5 days x `temp_min`, `temp_max`, `condition`, `rain_prob` | —                                    | the environment model, projected                  |
| `main_energy_meter`       | `power`, `energy`, `energy_forward`, `energy_reverse`     | —                                    | **the energy model**, signed grid                 |
| `energy_production_meter` | `power`, `energy`                                         | —                                    | **the energy model**, PV                          |
| `energy_meter`            | `power`, `energy`                                         | —                                    | **the energy model**, per sub-load                |

Three columns of that table are the actual work: presence, thermal, energy. Every
other class is a façade over one of them, or over the order it just received.

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

## Instances

The instance list is a **separate, cheaper decision**, made when the demo fixture
is built: the classes above are what the code must support, and the fixture
chooses how many of each the demo house has. Roughly a dozen zones over two
levels, one of most things and a few lights and shutters, is enough to make every
class visible without turning the 3D house into a maze. Nothing in the plugin
depends on that number.

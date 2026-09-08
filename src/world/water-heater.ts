/**
 * The water heater (spec 001, FR9b).
 *
 * A tank with a temperature, not a daily quota. The difference decides whether
 * the demo can show anything at all about solar surplus.
 *
 * With a quota, the tank meets its day's need overnight on the night rate and
 * there is nothing left for a surplus to do at noon — the arbiter would have a
 * load it can switch on and no reason to. With a temperature, the morning
 * showers empty it, the off-peak window has closed by then, and it sits
 * depleted through the sunny part of the day. That gap is the whole point of a
 * solar water heater, and it is what core spec 152's second, dry-contact input
 * exists to fill.
 */

export interface WaterHeaterSpec {
  volumeL: number;
  targetC: number;
  hysteresisK: number;
  /** Standby loss to the room it stands in, W per kelvin. */
  standbyWPerK: number;
  elementW: number;
  coldInletC: number;
}

export const WATER_HEATER: WaterHeaterSpec = {
  volumeL: 250,
  targetC: 60,
  hysteresisK: 4,
  standbyWPerK: 1.6,
  elementW: 2400,
  coldInletC: 12,
};

export interface WaterHeaterState {
  temperatureC: number;
  heating: boolean;
}

export interface WaterHeaterInputs {
  ambientC: number;
  /** Hot water drawn off during this step. */
  drawLitresPerMinute: number;
  /** The main supply relay: the appliance is powered at all. */
  suppliedByMains: boolean;
  /** The solar input is closed: heat now, whatever the hour. */
  solarForced: boolean;
  offPeak: boolean;
}

/** Litres a minute each use draws. */
export const DRAW_SHOWER_LPM = 2.6;
export const DRAW_KITCHEN_LPM = 0.5;

export function stepWaterHeater(
  spec: WaterHeaterSpec,
  state: WaterHeaterState,
  inputs: WaterHeaterInputs,
  dtS: number,
): WaterHeaterState {
  const capacityJPerK = spec.volumeL * 4186;

  // Hot water drawn off is replaced by cold at the inlet.
  const litres = (inputs.drawLitresPerMinute * dtS) / 60;
  const afterDraw =
    litres > 0
      ? state.temperatureC -
        (Math.min(litres, spec.volumeL) / spec.volumeL) * (state.temperatureC - spec.coldInletC)
      : state.temperatureC;

  const allowed = inputs.suppliedByMains && (inputs.offPeak || inputs.solarForced);
  let heating = state.heating;
  if (!allowed) heating = false;
  else if (afterDraw < spec.targetC - spec.hysteresisK) heating = true;
  else if (afterDraw >= spec.targetC) heating = false;

  const netW = (heating ? spec.elementW : 0) - spec.standbyWPerK * (afterDraw - inputs.ambientC);
  return {
    temperatureC: afterDraw + (netW * dtS) / capacityJPerK,
    heating,
  };
}

export function initialWaterHeaterState(spec: WaterHeaterSpec): WaterHeaterState {
  return { temperatureC: spec.targetC - spec.hysteresisK, heating: false };
}

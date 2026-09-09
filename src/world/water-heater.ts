/**
 * The water heater — a thermodynamic tank (spec 001, FR9b, amended).
 *
 * A tank with a temperature, not a daily quota. The difference decides whether
 * the demo can show anything at all about solar surplus: a quota is met overnight
 * on the night rate, which leaves the sunny part of the day with nothing for a
 * surplus to do. A temperature is emptied by the morning showers, after the
 * off-peak window has closed, and that gap is the point.
 *
 * It is modelled on the maintainer's own installation, which matters for two
 * numbers that a resistive tank would get wrong.
 *
 * **It is a heat pump**, so it draws around six hundred watts and delivers three
 * times that in heat. A resistive 2 400 W element would make the arbitration look
 * more dramatic than it is, and would teach a visitor the wrong thing about what
 * a thermodynamic tank costs to run.
 *
 * **The surplus input raises the target rather than switching the tank on.** A
 * separate 230 V contact — the dry contact core spec 152 models, wired here as a
 * second relay — takes the target from 55 °C to 62 °C. Those seven kelvin are
 * where the surplus goes: about two kilowatt-hours of heat stored in the tank,
 * which is the whole idea of a solar water heater and the reason it is the
 * clearest deferrable load in the house.
 */

export interface WaterHeaterSpec {
  volumeL: number;
  /** Where the tank's own programme holds it. */
  targetC: number;
  /** Where the surplus contact takes it. The difference is the storage. */
  boostTargetC: number;
  hysteresisK: number;
  /** Standby loss to the room it stands in, W per kelvin. */
  standbyWPerK: number;
  /** Electrical draw in heat-pump mode. */
  compressorW: number;
  /** Heat delivered per watt drawn. A resistive tank would be 1. */
  cop: number;
  coldInletC: number;
}

export const WATER_HEATER: WaterHeaterSpec = {
  volumeL: 250,
  targetC: 55,
  boostTargetC: 62,
  hysteresisK: 4,
  standbyWPerK: 1.6,
  compressorW: 600,
  cop: 3,
  coldInletC: 12,
};

/** Thermal watts the tank delivers when its compressor is running. */
export function thermalOutputW(spec: WaterHeaterSpec): number {
  return spec.compressorW * spec.cop;
}

/** Heat stored by the seven kelvin the surplus contact buys, in watt-hours. */
export function boostStorageWh(spec: WaterHeaterSpec): number {
  return (spec.volumeL * 4186 * (spec.boostTargetC - spec.targetC)) / 3600;
}

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
  /** The 230 V surplus contact is closed: heat now, and heat higher. */
  solarForced: boolean;
  offPeak: boolean;
}

/**
 * Litres a minute each use draws **from the tank**, not from the tap. A shower at
 * 40 °C mixes tank water with cold, so about two thirds of what runs comes from
 * the tank.
 */
export const DRAW_SHOWER_LPM = 2;
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

  // The surplus contact does two things at once: it raises the target, and it
  // lets the tank run outside its off-peak window. Either alone would be a
  // different appliance.
  const target = inputs.solarForced ? spec.boostTargetC : spec.targetC;
  const allowed = inputs.suppliedByMains && (inputs.offPeak || inputs.solarForced);

  let heating = state.heating;
  if (!allowed) heating = false;
  else if (afterDraw < target - spec.hysteresisK) heating = true;
  else if (afterDraw >= target) heating = false;

  const netW =
    (heating ? thermalOutputW(spec) : 0) - spec.standbyWPerK * (afterDraw - inputs.ambientC);
  return {
    temperatureC: afterDraw + (netW * dtS) / capacityJPerK,
    heating,
  };
}

export function initialWaterHeaterState(spec: WaterHeaterSpec): WaterHeaterState {
  return { temperatureC: spec.targetC - spec.hysteresisK, heating: false };
}

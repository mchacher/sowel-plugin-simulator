/**
 * Solar position (spec 001, FR5).
 *
 * NOAA's algorithm: accurate to about a tenth of a degree, which is far more
 * than a demo needs, and short enough to read. Elevation drives PV production
 * and solar gain; azimuth decides which windows the sun is actually on.
 */

import { localMidnight, localParts } from "./clock.js";

const DEG = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon; negative at night. */
  elevationDeg: number;
  /** Degrees clockwise from north. */
  azimuthDeg: number;
  isDay: boolean;
}

function fractionalYear(ts: number, tz: string): number {
  const { dayOfYear, hour } = localParts(ts, tz);
  return ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
}

function equationOfTimeMin(gamma: number): number {
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  );
}

/** Solar declination, radians. */
export function declination(gamma: number): number {
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

export function sunPosition(ts: number, latDeg: number, lonDeg: number, tz: string): SunPosition {
  const gamma = fractionalYear(ts, tz);
  const decl = declination(gamma);
  const utc = new Date(ts);
  const utcMinutes = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60;
  const trueSolarTime = utcMinutes + equationOfTimeMin(gamma) + 4 * lonDeg;
  const hourAngle = (trueSolarTime / 4 - 180) * DEG;

  const lat = latDeg * DEG;
  const cosZenith =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevationDeg = 90 - zenith / DEG;

  const sinZenith = Math.sin(zenith);
  let azimuthDeg = 180;
  if (sinZenith > 1e-6) {
    const cosAz = (Math.sin(decl) - Math.sin(lat) * Math.cos(zenith)) / (Math.cos(lat) * sinZenith);
    azimuthDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG;
    if (hourAngle > 0) azimuthDeg = 360 - azimuthDeg;
  }

  return { elevationDeg, azimuthDeg, isDay: elevationDeg > 0 };
}

export interface SunTimes {
  /** Null on a day the sun never rises or never sets at this latitude. */
  sunrise: number | null;
  sunset: number | null;
}

/** Sunrise and sunset for the local day containing `ts`, including the −0.833° refraction. */
export function sunTimes(ts: number, latDeg: number, lonDeg: number, tz: string): SunTimes {
  const midnight = localMidnight(ts, tz);
  const noonish = midnight + 12 * 3_600_000;
  const gamma = fractionalYear(noonish, tz);
  const decl = declination(gamma);
  const lat = latDeg * DEG;

  const cosHa =
    Math.cos(90.833 * DEG) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosHa > 1 || cosHa < -1) return { sunrise: null, sunset: null };

  const haDeg = Math.acos(cosHa) / DEG;
  const eqTime = equationOfTimeMin(gamma);
  const sunriseUtcMin = 720 + 4 * (-lonDeg - haDeg) - eqTime;
  const sunsetUtcMin = 720 + 4 * (-lonDeg + haDeg) - eqTime;

  const utcDayStart = Date.UTC(
    new Date(noonish).getUTCFullYear(),
    new Date(noonish).getUTCMonth(),
    new Date(noonish).getUTCDate(),
  );
  return {
    sunrise: utcDayStart + sunriseUtcMin * 60_000,
    sunset: utcDayStart + sunsetUtcMin * 60_000,
  };
}

/**
 * Clear-sky direct irradiance on a surface normal to the sun, W/m².
 * A simple air-mass attenuation — enough for a bell that peaks around solar noon.
 */
export function clearSkyIrradiance(elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  const airMass = 1 / Math.max(0.05, Math.sin(elevationDeg * DEG));
  return 1353 * 0.7 ** (airMass ** 0.678);
}

/**
 * Fraction of the sun's beam a surface of the given azimuth receives, in [0, 1].
 * A window sees nothing when the sun is behind it.
 */
export function incidenceFactor(surfaceAzimuthDeg: number, sun: SunPosition, tiltDeg = 90): number {
  if (!sun.isDay) return 0;
  const el = sun.elevationDeg * DEG;
  const tilt = tiltDeg * DEG;
  const deltaAz = (sun.azimuthDeg - surfaceAzimuthDeg) * DEG;
  const cosIncidence =
    Math.sin(el) * Math.cos(tilt) + Math.cos(el) * Math.sin(tilt) * Math.cos(deltaAz);
  return Math.max(0, cosIncidence);
}

/**
 * Where the house sits and which seed it lives by, from Sowel's settings.
 *
 * One function for the live plugin and for the history generator (spec 004): a
 * past computed at another place, or with another seed, would not be this house's.
 */

import type { WorldConfig } from "./world.js";

/**
 * Where the house sits when the instance has not been told. Spec 111 lets a
 * plugin read `home.latitude` / `home.longitude` / `home.timezone`; it does not
 * promise they are set.
 */
export const FALLBACK_LOCATION = {
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: "Europe/Paris",
};

export const DEFAULT_SEED = 1789;

export function worldConfigFrom(
  get: (key: string) => string | undefined | null,
  integrationId = "simulator",
): { config: WorldConfig; fallbackLocation: boolean } {
  const latitude = Number(get("home.latitude"));
  const longitude = Number(get("home.longitude"));
  const timezone = get("home.timezone");
  const fallbackLocation = !Number.isFinite(latitude) || !Number.isFinite(longitude) || !timezone;
  const location = fallbackLocation
    ? FALLBACK_LOCATION
    : { latitude, longitude, timezone: timezone as string };
  const seed = Number(get(`integration.${integrationId}.seed`));
  return {
    config: { ...location, seed: Number.isFinite(seed) && seed !== 0 ? seed : DEFAULT_SEED },
    fallbackLocation,
  };
}

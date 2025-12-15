import { logger } from "../logger.js";

interface NominatimResult {
  display_name?: string;
  address?: {
    country?: string;
    state?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    hamlet?: string;
  };
}

export interface GeocodeDetailResult {
  displayName?: string;
  country?: string;
  state?: string;
  city?: string;
}

// In-memory cache keyed by reduced precision
const cache = new Map<string, GeocodeDetailResult | undefined>();

// Environment configuration
const DISABLED = /^(1|true)$/i.test(process.env.GEOCODE_DISABLE || "");
// Either specify minimum interval directly or derive from requests-per-second
const MIN_INTERVAL_MS = process.env.GEOCODE_MIN_INTERVAL_MS
  ? Math.max(0, Number(process.env.GEOCODE_MIN_INTERVAL_MS))
  : process.env.GEOCODE_RPS
    ? 1000 / Math.max(1, Number(process.env.GEOCODE_RPS))
    : 1100; // default ~1 req/sec (Nominatim polite usage)
const MAX_RETRIES = process.env.GEOCODE_MAX_RETRIES
  ? Math.max(0, Number(process.env.GEOCODE_MAX_RETRIES))
  : 3;
const BASE_BACKOFF_MS = process.env.GEOCODE_BASE_BACKOFF_MS
  ? Math.max(50, Number(process.env.GEOCODE_BASE_BACKOFF_MS))
  : 400;
let lastCall = 0;
const queue: Array<{
  lat: number;
  lon: number;
  resolve: (v: GeocodeDetailResult | undefined) => void;
  reject: (e: any) => void;
}> = [];
let processing = false;

function keyFor(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`; // ~11m precision
}

function schedule() {
  if (processing) return;
  processing = true;
  (async function run() {
    while (queue.length) {
      const { lat, lon, resolve, reject } = queue.shift()!;
      const k = keyFor(lat, lon);
      if (cache.has(k)) {
        resolve(cache.get(k));
        continue;
      }
      if (DISABLED) {
        cache.set(k, undefined);
        resolve(undefined);
        continue;
      }
      const now = Date.now();
      const wait = lastCall + MIN_INTERVAL_MS - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      let attempt = 0;
      let resolved = false;
      while (attempt <= MAX_RETRIES && !resolved) {
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=14&addressdetails=1`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "web-dashcam-viewer/1.0 (self-hosted; contact: local)",
            },
          });
          if (!res.ok) {
            // 429 or 5xx -> retry (if attempts left)
            if (
              (res.status === 429 || res.status >= 500) &&
              attempt < MAX_RETRIES
            ) {
              const backoff =
                BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 100;
              logger.warn(
                { status: res.status, attempt },
                "Geocode retry scheduling",
              );
              await new Promise((r) => setTimeout(r, backoff));
              attempt++;
              continue;
            }
            logger.warn({ status: res.status }, "Reverse geocode failed");
            cache.set(k, undefined);
            resolve(undefined);
            break;
          }
          const data = (await res.json()) as NominatimResult;
          const addr = data.address || {};
          const city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            addr.hamlet ||
            addr.county;
          const detail: GeocodeDetailResult = {
            displayName: data.display_name,
            country: addr.country,
            state: addr.state,
            city,
          };
          cache.set(k, detail);
          resolve(detail);
          resolved = true;
        } catch (e) {
          if (attempt < MAX_RETRIES) {
            const backoff =
              BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 100;
            logger.warn(
              e,
              `Reverse geocode error attempt=${attempt}, backing off ${backoff}ms`,
            );
            await new Promise((r) => setTimeout(r, backoff));
            attempt++;
            continue;
          }
          logger.warn(e, "Reverse geocode failed (giving up)");
          cache.set(k, undefined);
          reject(e);
          resolved = true;
        }
      }
    }
    processing = false;
  })();
}

export function reverseGeocodeDetailed(lat: number, lon: number) {
  return new Promise<GeocodeDetailResult | undefined>((resolve, reject) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      resolve(undefined);
      return;
    }
    queue.push({ lat, lon, resolve, reject });
    schedule();
  });
}

// Backwards-compatible simple name fetch using detailed function
export async function reverseGeocode(lat: number, lon: number) {
  const r = await reverseGeocodeDetailed(lat, lon);
  return r?.displayName;
}

export function clearGeocodeCache() {
  cache.clear();
}

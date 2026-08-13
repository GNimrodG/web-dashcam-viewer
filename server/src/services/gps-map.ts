import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { VideoPair } from "../types.js";
import {
  buildGpsMapSignature,
  sampleGpsTrack,
  type GpsMapPoint,
} from "../utils/gps-map.js";
import { getGpsTrackForPair, getVideoPairs } from "./indexer.js";
import { logger } from "../logger.js";
import { hasCurrentNoGpsResult } from "./gps.js";
import { getAllVideoPoisMap, type VideoPoi } from "../db/database.js";

export interface GpsMapTrack {
  id: string;
  startTime?: string;
  durationSec?: number;
  startLocationName?: string;
  endLocationName?: string;
  points: GpsMapPoint[];
  pois: VideoPoi[];
}

export interface GpsMapCatalog {
  totalRecordings: number;
  recordingsWithGps: number;
  tracks: GpsMapTrack[];
}

interface PersistedGpsMapCatalog {
  version: 1;
  signature: string;
  catalog: GpsMapCatalog;
}

let memoryCache: PersistedGpsMapCatalog | null = null;
let inFlight:
  | { signature: string; promise: Promise<GpsMapCatalog> }
  | undefined;
let cacheGeneration = 0;

function getCachePath(mediaDir: string): string {
  const configuredDir =
    process.env.GPS_MAP_CACHE_DIR || process.env.INDEX_CACHE_DIR;
  if (configuredDir) {
    const mediaHash = createHash("sha256")
      .update(path.resolve(mediaDir))
      .digest("hex")
      .slice(0, 20);
    return path.join(configuredDir, `${mediaHash}.gps-map.json`);
  }
  return path.join(mediaDir, ".gps_map_catalog_cache.json");
}

async function loadPersistedCatalog(
  cachePath: string,
  signature: string,
): Promise<GpsMapCatalog | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(cachePath, "utf8"),
    ) as PersistedGpsMapCatalog;
    if (
      parsed.version === 1 &&
      parsed.signature === signature &&
      Array.isArray(parsed.catalog?.tracks)
    ) {
      return parsed.catalog;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(error, "Failed to read GPS map catalog cache");
    }
  }
  return null;
}

async function savePersistedCatalog(
  cachePath: string,
  payload: PersistedGpsMapCatalog,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(payload), "utf8");
    await fs.rm(cachePath, { force: true });
    await fs.rename(temporaryPath, cachePath);
  } catch (error) {
    logger.warn(error, "Failed to write GPS map catalog cache");
  }
}

async function buildCatalog(
  pairs: readonly VideoPair[],
): Promise<GpsMapCatalog> {
  const candidates = pairs.filter(
    (pair) =>
      !pair.gpsDisabled &&
      !(
        hasCurrentNoGpsResult(pair.channels.front) &&
        hasCurrentNoGpsResult(pair.channels.rear)
      ),
  );
  const tracks = await Promise.all(
    candidates.map(async (pair): Promise<GpsMapTrack | null> => {
      try {
        const gps = await getGpsTrackForPair(pair.id, {
          updateLocations: false,
        });
        const points = gps.front?.length ? gps.front : gps.rear;
        if (!points?.length) return null;
        return {
          id: pair.id,
          startTime: pair.startTime,
          durationSec: pair.durationSec,
          startLocationName: pair.startLocationName,
          endLocationName: pair.endLocationName,
          points: sampleGpsTrack(points),
          pois: [],
        };
      } catch (error) {
        logger.warn(error, `Failed to load GPS map track for ${pair.id}`);
        return null;
      }
    }),
  );
  const availableTracks = tracks.filter(
    (track): track is GpsMapTrack => track !== null,
  );
  return {
    totalRecordings: pairs.length,
    recordingsWithGps: availableTracks.length,
    tracks: availableTracks,
  };
}

function attachCurrentPois(catalog: GpsMapCatalog): GpsMapCatalog {
  const poisByVideo = getAllVideoPoisMap();
  return {
    ...catalog,
    tracks: catalog.tracks.map((track) => ({
      ...track,
      pois: poisByVideo.get(track.id) ?? [],
    })),
  };
}

export async function getGpsMapCatalog(
  mediaDir: string,
): Promise<GpsMapCatalog> {
  const pairs = getVideoPairs();
  const signature = buildGpsMapSignature(pairs);
  if (memoryCache?.signature === signature) {
    return attachCurrentPois(memoryCache.catalog);
  }
  if (inFlight?.signature === signature) {
    return attachCurrentPois(await inFlight.promise);
  }

  const generation = cacheGeneration;
  const cachePath = getCachePath(mediaDir);
  const promise = (async () => {
    const persisted = await loadPersistedCatalog(cachePath, signature);
    if (persisted) {
      if (generation === cacheGeneration) {
        memoryCache = { version: 1, signature, catalog: persisted };
      }
      return persisted;
    }

    const catalog = await buildCatalog(pairs);
    if (generation === cacheGeneration) {
      const payload: PersistedGpsMapCatalog = {
        version: 1,
        signature,
        catalog,
      };
      memoryCache = payload;
      await savePersistedCatalog(cachePath, payload);
    }
    return catalog;
  })();
  inFlight = { signature, promise };
  try {
    return attachCurrentPois(await promise);
  } finally {
    if (inFlight?.promise === promise) inFlight = undefined;
  }
}

export async function invalidateGpsMapCatalog(mediaDir: string): Promise<void> {
  cacheGeneration++;
  memoryCache = null;
  inFlight = undefined;
  try {
    await fs.unlink(getCachePath(mediaDir));
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(error, "Failed to remove GPS map catalog cache");
    }
  }
}

import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import chokidar from "chokidar";
import { ffprobe, FFProbeResult, parseISO6709 } from "./ffprobe.js";
import { extractTimedGpsTrack, loadRecordedGpxTrack } from "./gps.js";
import { reverseGeocodeDetailed } from "./geocode.js";
import { parseFilenameForPairing } from "../utils/pairing.js";
import type { VideoPair, VideoFile, GpsPoint } from "../types.js";
import { parseByteRange } from "../utils/http.js";
import {
  getDashcamTimeZone,
  parseDashcamFilenameTimeIso,
} from "../utils/dashcam-time.js";
import {
  canonicalMediaPath,
  compareMediaPathPriority,
  isRoMediaPath,
  isSupportedVideoFile,
} from "../utils/media-path.js";

const INDEX: Map<string, VideoPair> = new Map();
let MEDIA_DIR: string = "";
let CACHE_PATH: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_MS = 1500;
const DASHCAM_TIME_ZONE = getDashcamTimeZone();

interface CachedIndexFile {
  version: number;
  generatedAt: string;
  pairs: VideoPair[];
}

// Helper functions for path normalization
function toRelativePath(absolutePath: string, mediaDir: string): string {
  const rel = path.relative(mediaDir, absolutePath);
  // Normalize to forward slashes for cross-platform compatibility
  return rel.split(path.sep).join("/");
}

function toAbsolutePath(relativePath: string, mediaDir: string): string {
  // Convert forward slashes to platform-specific separators
  const normalized = relativePath.split("/").join(path.sep);
  return path.join(mediaDir, normalized);
}

function getCachePath(mediaDir: string) {
  const cacheDir = process.env.INDEX_CACHE_DIR;
  if (cacheDir) {
    // Use separate cache directory (recommended for network shares)
    const hash = Buffer.from(mediaDir).toString("base64url");
    return path.join(cacheDir, `${hash}.json`);
  }
  // Default: store cache in media directory
  return path.join(mediaDir, ".video_index_cache.json");
}

function parseFilenameStartTimeIso(parsed: {
  date?: string;
  time?: string;
}): string | undefined {
  return parseDashcamFilenameTimeIso(parsed, DASHCAM_TIME_ZONE);
}

function parsePairIdStartTimeIso(pairId: string): string | undefined {
  const [date, time] = pairId.split("_");
  return parseFilenameStartTimeIso({ date, time });
}

async function loadCache(mediaDir: string) {
  try {
    const p = getCachePath(mediaDir);
    const raw = await fs.readFile(p, "utf8");
    const data: CachedIndexFile = JSON.parse(raw);

    if (data.version !== 1) {
      logger.warn(
        "Failed to load the index: Index cache version mismatch, making a backup and creating a new one.",
      );
      await fs.rename(p, p + ".bak-" + Date.now());
      return false;
    }

    INDEX.clear();

    for (const pair of data.pairs) {
      // Convert relative paths back to absolute paths
      for (const channel of Object.keys(
        pair.channels,
      ) as (keyof typeof pair.channels)[]) {
        const vf = pair.channels[channel];
        if (vf) {
          vf.path = toAbsolutePath(vf.path, mediaDir);
        }
      }
      INDEX.set(pair.id, pair);
    }

    logger.info("Loaded video index cache: " + INDEX.size + " pairs");
    return true;
  } catch (e) {
    logger.warn(e, "No valid index cache found");
    return false;
  }
}

async function saveCache() {
  if (!CACHE_PATH) {
    logger.warn("No cache path set; skipping index cache save");
    return;
  }

  // Deep clone pairs and convert absolute paths to relative paths
  const pairsWithRelativePaths = Array.from(INDEX.values()).map((pair) => {
    const clonedPair = { ...pair, channels: { ...pair.channels } };
    for (const channel of Object.keys(
      clonedPair.channels,
    ) as (keyof typeof clonedPair.channels)[]) {
      const vf = clonedPair.channels[channel];
      if (vf) {
        clonedPair.channels[channel] = {
          ...vf,
          path: toRelativePath(vf.path, MEDIA_DIR),
        };
      }
    }
    return clonedPair;
  });

  const payload: CachedIndexFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pairs: pairsWithRelativePaths,
  };
  try {
    await fs.writeFile(CACHE_PATH, JSON.stringify(payload));
  } catch (e) {
    logger.warn(e, "Failed writing index cache");
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCache();
  }, SAVE_DEBOUNCE_MS);
}

export async function buildIndex(mediaDir: string) {
  MEDIA_DIR = mediaDir;
  CACHE_PATH = getCachePath(mediaDir);
  logger.info("Building index from: " + mediaDir || "<none>");

  // Try loading cache first
  let usedCache = await loadCache(mediaDir);

  if (!usedCache) {
    INDEX.clear();
  }

  // Validate cached entries against disk (existence + size/mtime where possible)
  if (usedCache) {
    logger.info("Validating cached index entries against disk...");
    const toDelete: string[] = [];
    for (const pair of INDEX.values()) {
      for (const chName of Object.keys(
        pair.channels,
      ) as (keyof typeof pair.channels)[]) {
        const vf = pair.channels[chName];
        if (!vf) continue;
        if (!isSupportedVideoFile(vf.path)) {
          delete pair.channels[chName];
          continue;
        }
        try {
          const st = await fs.stat(vf.path);
          vf.createdAt =
            parseFilenameStartTimeIso(parseFilenameForPairing(vf.path)) ||
            vf.createdAt ||
            st.birthtime.toISOString();
          if (
            vf.size !== st.size ||
            (vf.mtimeMs && Math.abs(vf.mtimeMs - st.mtimeMs) > 1)
          ) {
            // Mark channel stale so it will be re-probed later
            delete pair.channels[chName];
          }
        } catch {
          // File missing -> remove channel
          delete pair.channels[chName];
        }
      }
      pair.startTime =
        pair.channels.front?.createdAt ||
        pair.channels.rear?.createdAt ||
        parsePairIdStartTimeIso(pair.id) ||
        pair.startTime;
      if (!pair.channels.front && !pair.channels.rear) {
        toDelete.push(pair.id);
      }
    }

    for (const id of toDelete) INDEX.delete(id);

    logger.info(
      `Validated cached index entries, removed ${toDelete.length} stale pairs`,
    );
  }

  const patterns = ["**/*.mp4", "**/*.MP4", "**/*.mov", "**/*.MOV"].map((p) =>
    path.posix.join(mediaDir.replaceAll("\\", "/"), p),
  );

  const files = await fg(patterns, {
    dot: false,
    onlyFiles: true,
    unique: true,
    suppressErrors: true,
    ignore: ["**/clips/**"], // Exclude clips directory from indexing
  });

  // If cache was loaded, filter out files that are already indexed and unchanged
  let filesToProcess = files;
  if (usedCache) {
    const cachedFilePaths = new Set<string>();
    for (const pair of INDEX.values()) {
      for (const vf of Object.values(pair.channels)) {
        if (vf) cachedFilePaths.add(canonicalMediaPath(vf.path));
      }
    }

    const newFiles: string[] = [];
    for (const filePath of files) {
      if (cachedFilePaths.has(canonicalMediaPath(filePath))) continue;

      const parsed = parseFilenameForPairing(filePath);
      const indexedChannel = parsed.channel
        ? INDEX.get(parsed.key)?.channels[parsed.channel]
        : undefined;
      if (
        indexedChannel &&
        compareMediaPathPriority(filePath, indexedChannel.path) < 0
      ) {
        continue;
      }

      newFiles.push(filePath);
    }

    filesToProcess = newFiles;
    logger.info(
      `Skipping ${files.length - newFiles.length} already-indexed or lower-priority files, processing ${newFiles.length} new/changed files`,
    );
  }

  // Concurrency pool
  const concurrency = Number(process.env.INDEX_CONCURRENCY) || 2;
  let idx = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = idx++;

      if (i >= filesToProcess.length) break;

      const filePath = filesToProcess[i];

      if (filePath.endsWith(".gpscache.json")) continue;

      await upsertFile(filePath);

      completed++;

      if (completed % 10 === 0) {
        logger.info(
          "Indexing progress: " + completed + "/" + filesToProcess.length,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  scheduleSave();
}

export function watchMediaFolder(mediaDir: string) {
  // Skip file watching if disabled (recommended for network shares)
  if (process.env.DISABLE_FILE_WATCH === "1") {
    logger.warn(
      "File watching disabled (DISABLE_FILE_WATCH=1) - recommended for network shares",
    );
    return null;
  }

  logger.info("Setting up file watcher for: " + mediaDir);

  // More conservative settings for network shares
  const usePolling = process.env.WATCH_USE_POLLING === "1";
  const pollInterval = Number(process.env.WATCH_POLL_INTERVAL) || 10000; // 10s default

  const watcher = chokidar.watch(mediaDir, {
    ignoreInitial: true,
    persistent: true,
    ignored: [
      /((^|[/\\])\..)|(\.gpscache\.json$)/, // Hidden files and GPS cache files
      /[/\\]clips[/\\]/, // Exclude clips directory
      /\.gpx$/i, // Exclude GPX files
    ],
    // Network share optimizations
    usePolling, // Use polling instead of native events for network shares
    interval: pollInterval,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
    depth: 99, // Limit recursion depth
    atomic: false, // Don't wait for atomic writes (can hang on SMB)
  });

  watcher
    .on("ready", () =>
      logger.info(
        `File watcher ready - monitoring for changes (polling=${usePolling})`,
      ),
    )
    .on("add", (filePath) => {
      logger.info("File added: " + filePath);
      upsertFile(filePath);
    })
    .on("change", (filePath) => {
      logger.info("File changed: " + filePath);
      upsertFile(filePath);
    })
    .on("unlink", (filePath) => {
      logger.info("File deleted: " + filePath);
      removeFile(filePath);
    })
    .on("error", (err) => logger.error(err, "Watcher error"));

  return watcher;
}

async function upsertFile(filePath: string) {
  if (!isSupportedVideoFile(filePath)) return;

  try {
    const st = await fs.stat(filePath);
    const parsed = parseFilenameForPairing(filePath);

    const directlyIndexedChannel = parsed.channel
      ? INDEX.get(parsed.key)?.channels[parsed.channel]
      : undefined;
    if (
      directlyIndexedChannel &&
      compareMediaPathPriority(filePath, directlyIndexedChannel.path) < 0
    ) {
      logger.info(
        `Ignoring lower-priority duplicate: ${filePath} (using ${directlyIndexedChannel.path})`,
      );
      return;
    }

    const existing = findVideoFile(filePath);
    let meta: FFProbeResult | null = null;
    if (existing && existing.mtimeMs === st.mtimeMs && existing.durationSec) {
      // Assume unchanged; skip probing
    } else {
      meta = await safeProbe(filePath);
    }

    const vf: VideoFile = {
      ...existing, // Preserve existing fields
      path: filePath,
      filename: path.basename(filePath),
      size: st.size,
      mtimeMs: st.mtimeMs,
      createdAt:
        parseFilenameStartTimeIso(parsed) ||
        meta?.format?.tags?.creation_time ||
        meta?.format?.tags?.["com.apple.quicktime.creationdate"] ||
        existing?.createdAt ||
        st.birthtime.toISOString(),
      durationSec:
        existing?.durationSec || tryParseNumber(meta?.format?.duration),
      location: existing?.location ?? parseLocation(meta),
      important: existing?.important ?? isRoMediaPath(filePath),
    };

    if (parsed.channel) vf.channel = parsed.channel;

    // Fuzzy pairing: try ±1 second if not found
    let pairKey = parsed.key;
    let pair = INDEX.get(pairKey);
    if (!pair && parsed.time && parsed.date) {
      // Try ±1 second
      const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
      const t = parsed.time;
      const h = Number.parseInt(t.slice(0, 2));
      const m = Number.parseInt(t.slice(2, 4));
      const s = Number.parseInt(t.slice(4, 6));
      for (const delta of [-1, 1]) {
        let newS = s + delta;
        let newM = m;
        let newH = h;
        if (newS < 0) {
          newS = 59;
          newM = m - 1;
        } else if (newS > 59) {
          newS = 0;
          newM = m + 1;
        }
        if (newM < 0) {
          newM = 59;
          newH = h - 1;
        } else if (newM > 59) {
          newM = 0;
          newH = h + 1;
        }
        if (newH < 0 || newH > 23) continue;
        const altTime = pad(newH) + pad(newM) + pad(newS);
        const altKey = `${parsed.date}_${altTime}`;
        const altPair = INDEX.get(altKey);
        if (altPair) {
          pairKey = altKey;
          pair = altPair;
          break;
        }
      }
    }
    if (!pair) pair = { id: pairKey, channels: {} };
    if (vf.channel) {
      const currentChannel = pair.channels[vf.channel];
      if (
        !currentChannel ||
        compareMediaPathPriority(vf.path, currentChannel.path) >= 0
      ) {
        pair.channels[vf.channel] = vf;
      } else {
        logger.info(
          `Ignoring lower-priority duplicate: ${filePath} (using ${currentChannel.path})`,
        );
        return;
      }
    } else {
      pair.channels = { ...pair.channels };
    }
    pair.startTime = pair.startTime || vf.createdAt;
    pair.durationSec = Math.max(pair.durationSec || 0, vf.durationSec || 0);
    INDEX.set(pairKey, pair);
    scheduleSave();
    logger.info(
      "Indexed video file: " +
        filePath +
        " (pair id: " +
        pair.id +
        ") progress: " +
        INDEX.size,
    );
  } catch (e) {
    logger.error(e, "Error indexing video file: " + filePath);
  }
}

async function removeFile(filePath: string) {
  const parsed = parseFilenameForPairing(filePath);
  const pair = INDEX.get(parsed.key);
  if (!pair) return;
  if (
    parsed.channel &&
    pair.channels[parsed.channel] &&
    canonicalMediaPath(pair.channels[parsed.channel]!.path) ===
      canonicalMediaPath(filePath)
  ) {
    delete pair.channels[parsed.channel];
  }
  if (!pair.channels.front && !pair.channels.rear) {
    INDEX.delete(parsed.key);
  } else {
    INDEX.set(parsed.key, pair);
  }
  scheduleSave();
}

function findVideoFile(filePath: string): VideoFile | undefined {
  const canonicalPath = canonicalMediaPath(filePath);
  for (const pair of INDEX.values()) {
    for (const ch of Object.values(pair.channels)) {
      if (ch && canonicalMediaPath(ch.path) === canonicalPath) return ch;
    }
  }
  return undefined;
}

function tryParseNumber(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function parseLocation(meta: any) {
  const tags = meta?.format?.tags || {};
  const iso = tags["com.apple.quicktime.location.ISO6709"];
  if (iso) return parseISO6709(iso);

  // Some cameras set 'location' tag like "lat,lon,alt" or "lat lon"
  const loc = tags["location"];
  if (typeof loc === "string") {
    const parts = loc.split(/[ ,;]+/).map((s: string) => Number.parseFloat(s));
    if (parts.length >= 2 && parts.every((n: number) => Number.isFinite(n))) {
      return { lat: parts[0], lon: parts[1], alt: parts[2] };
    }
  }
  return undefined;
}

async function safeProbe(filePath: string): Promise<FFProbeResult | null> {
  try {
    return await ffprobe(filePath);
  } catch (e) {
    if (e instanceof Error) {
      if (e instanceof ExecaError) {
        logger.error(
          "ffprobe error: " + filePath + " - " + (e.stderr || e.message),
        );
      } else {
        logger.error(e, "ffprobe Error for file: " + filePath);
      }
    } else {
      logger.error("Unknown ffprobe error for file: " + filePath);
    }
    return null;
  }
}

export function getVideoPairs(): VideoPair[] {
  return Array.from(INDEX.values())
    .filter((pair) => pair.channels.front || pair.channels.rear)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function getVideoPairById(id: string): VideoPair | undefined {
  return INDEX.get(id);
}

const gpsTrackPromises: Map<
  string,
  Promise<{ front?: GpsPoint[]; rear?: GpsPoint[] }>
> = new Map();

export function invalidateGpsTrackForPair(id: string): void {
  gpsTrackPromises.delete(id);
}

export function resetGpsDerivedLocationForPair(id: string): void {
  const pair = INDEX.get(id);
  if (!pair) return;

  pair.startLocationName = undefined;
  pair.endLocationName = undefined;
  pair.startCountry = undefined;
  pair.endCountry = undefined;
  pair.startState = undefined;
  pair.endState = undefined;
  pair.startCity = undefined;
  pair.endCity = undefined;
}

export function registerStoredGpsForPair(id: string): void {
  const pair = INDEX.get(id);
  if (!pair) return;

  resetGpsDerivedLocationForPair(id);
  invalidateGpsTrackForPair(id);
  for (const channel of Object.values(pair.channels)) {
    if (channel) channel.noGps = false;
  }
  scheduleSave();
}

const GPS_CONCURRENT_LIMIT = Number(process.env.GPS_CONCURRENT_LIMIT) || 5;
let currentGpsExtractions = 0;
const gpsExtractionQueue: Array<{
  id: string;
  updateLocations: boolean;
  resolve: (value: { front?: GpsPoint[]; rear?: GpsPoint[] }) => void;
  reject: (reason?: any) => void;
  queuedAt: number;
}> = [];
const processingGpsExtractions = new Set<string>();

async function updatePairLocationsFromGps(
  pair: VideoPair,
  result: { front?: GpsPoint[]; rear?: GpsPoint[] },
): Promise<void> {
  const needsStart =
    !pair.startLocationName ||
    !pair.startCountry ||
    !pair.startState ||
    !pair.startCity;
  const needsEnd =
    !pair.endLocationName ||
    !pair.endCountry ||
    !pair.endState ||
    !pair.endCity;
  if (!needsStart && !needsEnd) return;

  const combined: GpsPoint[] = [
    ...(result.front || []),
    ...(result.rear || []),
  ].sort((a, b) => a.tsSec - b.tsSec);
  if (combined.length <= 1) return;

  const first = combined[0];
  const last = combined.at(-1)!;
  if (needsStart) {
    const geocodedStart = await reverseGeocodeDetailed(first.lat, first.lon);
    if (geocodedStart) {
      pair.startLocationName ||= geocodedStart.displayName;
      pair.startCountry ||= geocodedStart.country;
      pair.startState ||= geocodedStart.state;
      pair.startCity ||= geocodedStart.city;
    }
  }

  const sufficientlyDifferent =
    Math.abs(first.lat - last.lat) > 0.0005 ||
    Math.abs(first.lon - last.lon) > 0.0005;
  if (needsEnd && sufficientlyDifferent) {
    const geocodedEnd = await reverseGeocodeDetailed(last.lat, last.lon);
    if (geocodedEnd) {
      pair.endLocationName ||= geocodedEnd.displayName;
      pair.endCountry ||= geocodedEnd.country;
      pair.endState ||= geocodedEnd.state;
      pair.endCity ||= geocodedEnd.city;
    }
  }
}

function processNextInQueue() {
  if (
    gpsExtractionQueue.length === 0 ||
    currentGpsExtractions >= GPS_CONCURRENT_LIMIT
  ) {
    return;
  }

  const next = gpsExtractionQueue.shift();
  if (!next) return;

  logger.info(
    `Processing queued GPS extraction for pair: ${next.id} (queue length: ${gpsExtractionQueue.length})`,
  );

  // Start the extraction immediately
  const promise = startGpsExtraction(next.id, next.updateLocations);
  promise.then(next.resolve).catch(next.reject);
}

function startGpsExtraction(
  id: string,
  updateLocations: boolean,
): Promise<{ front?: GpsPoint[]; rear?: GpsPoint[] }> {
  currentGpsExtractions++;
  processingGpsExtractions.add(id);
  logger.info(
    `Starting GPS extraction for pair: ${id} (${currentGpsExtractions}/${GPS_CONCURRENT_LIMIT})`,
  );

  let p!: Promise<{ front?: GpsPoint[]; rear?: GpsPoint[] }>;
  p = (async () => {
    // Ensure the promise is registered before any cached early-return can finish.
    await Promise.resolve();
    try {
      logger.info("Extracting GPS track for pair: " + id);
      const pair = getVideoPairById(id);
      if (!pair) throw new Error("Not found");

      const recorded = loadRecordedGpxTrack(
        MEDIA_DIR,
        pair.id,
        pair.startTime || parsePairIdStartTimeIso(pair.id),
      );
      if (recorded?.length) {
        logger.info(`Using stored GPX track for pair: ${id}`);
        const result: { front?: GpsPoint[]; rear?: GpsPoint[] } = {};
        if (pair.channels.front) {
          result.front = recorded;
          pair.channels.front.noGps = false;
        } else if (pair.channels.rear) {
          result.rear = recorded;
          pair.channels.rear.noGps = false;
        }
        if (updateLocations) {
          try {
            await updatePairLocationsFromGps(pair, result);
          } catch (e) {
            logger.warn(e, "Failed reverse geocoding for pair " + id);
          }
        }
        await saveCache();
        return result;
      }

      if (
        (!pair.channels.front || pair.channels.front.noGps) &&
        (!pair.channels.rear || pair.channels.rear.noGps)
      ) {
        logger.info("Pair marked as no GPS data: " + id);
        return {};
      }

      const result: { front?: GpsPoint[]; rear?: GpsPoint[] } = {};

      if (pair.channels.front) {
        if (!result.front) {
          result.front = await extractTimedGpsTrack(pair.channels.front.path);
        }
        pair.channels.front.noGps = !result.front.length;
        logger.info(
          `Extracted GPS track for front channel: ${pair.channels.front.path}`,
        );
      }
      if (pair.channels.rear) {
        if (!result.rear) {
          result.rear = await extractTimedGpsTrack(pair.channels.rear.path);
        }
        pair.channels.rear.noGps = !result.rear.length;
        logger.info(
          `Extracted GPS track for rear channel: ${pair.channels.rear.path}`,
        );
      }

      // Save the noGps flags to cache for persistence across restarts
      scheduleSave();

      // Derive start/end geocoded names (only once if not already set)
      if (updateLocations) {
        try {
          await updatePairLocationsFromGps(pair, result);
        } catch (e) {
          logger.warn(e, "Failed reverse geocoding for pair " + id);
        }
      }
      await saveCache();
      return result;
    } finally {
      currentGpsExtractions--;
      processingGpsExtractions.delete(id);
      if (gpsTrackPromises.get(id) === p) gpsTrackPromises.delete(id);
      logger.info(
        `Completed GPS extraction for pair: ${id} (${currentGpsExtractions}/${GPS_CONCURRENT_LIMIT} remaining)`,
      );

      // Process next item in queue
      processNextInQueue();
    }
  })();

  gpsTrackPromises.set(id, p);
  return p;
}

export function getGpsTrackForPair(
  id: string,
  options: { updateLocations?: boolean } = {},
): Promise<{ front?: GpsPoint[]; rear?: GpsPoint[] }> {
  const updateLocations = options.updateLocations !== false;
  if (gpsTrackPromises.has(id)) {
    logger.info("Reusing ongoing GPS extraction for pair: " + id);
    return gpsTrackPromises.get(id)!;
  }

  // Check if already queued
  const existingInQueue = gpsExtractionQueue.find((item) => item.id === id);
  if (existingInQueue) {
    logger.info(
      `GPS extraction for pair ${id} already queued (position: ${gpsExtractionQueue.indexOf(existingInQueue) + 1}/${gpsExtractionQueue.length})`,
    );
    return new Promise((resolve, reject) => {
      existingInQueue.resolve = resolve;
      existingInQueue.reject = reject;
    });
  }

  if (currentGpsExtractions >= GPS_CONCURRENT_LIMIT) {
    logger.info(
      `GPS extraction limit reached (${GPS_CONCURRENT_LIMIT}), queuing request for pair: ${id} (queue length: ${gpsExtractionQueue.length + 1})`,
    );

    const queuedPromise = new Promise<{
      front?: GpsPoint[];
      rear?: GpsPoint[];
    }>((resolve, reject) => {
      gpsExtractionQueue.push({
        id,
        updateLocations,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
    });
    gpsTrackPromises.set(id, queuedPromise);
    return queuedPromise;
  }

  return startGpsExtraction(id, updateLocations);
}

// Backfill geocoded names for any pairs that have GPS data extracted already.
// This function will trigger GPS extraction if not already cached via existing channels.
export async function backfillLocationNames(limit = 20) {
  const unlimited = limit <= 0;
  let processed = 0;
  for (const pair of INDEX.values()) {
    const missingStart =
      !pair.startLocationName ||
      !pair.startCountry ||
      !pair.startState ||
      !pair.startCity;
    const missingEnd =
      !pair.endLocationName ||
      !pair.endCountry ||
      !pair.endState ||
      !pair.endCity;
    if (!missingStart && !missingEnd) continue;
    getGpsTrackForPair(pair.id).catch((e) => {
      logger.warn(e, "GPS extraction failed for pair " + pair.id);
    });
    processed++;
    if (!unlimited && processed >= limit) break; // avoid long blocking batch
  }
  if (processed > 0) await saveCache();
  return processed;
}

// Video streaming with Range support
import http from "node:http";
import { pipeline } from "node:stream";
import mime from "mime-types";
import { logger } from "../logger.js";
import { ExecaError } from "execa";

export function streamVideo(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
) {
  let stream: fssync.ReadStream | null = null;

  // Cleanup handler
  const cleanup = () => {
    if (stream && !stream.destroyed) {
      stream.destroy();
      stream = null;
    }
  };

  // Handle client disconnect
  res.on("close", cleanup);
  res.on("error", cleanup);

  try {
    const stat = fssync.statSync(filePath);
    const range = req.headers.range;

    const mimeType = mime.lookup(filePath) || "video/mp4";

    if (!range) {
      // No range -> send entire file
      logger.info("Streaming entire file: " + filePath);
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      stream = fssync.createReadStream(filePath);
      return pipeline(stream, res, (err) => {
        cleanup();
        if (err && err.message !== "Premature close")
          logger.error(err, "Pipeline error");
      });
    }

    const parsedRange = parseByteRange(range, stat.size);
    if (!parsedRange) {
      res.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes",
      });
      return res.end();
    }
    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;

    // 206 Partial Content - Streaming
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    stream = fssync.createReadStream(filePath, { start, end });
    return pipeline(stream, res, (err) => {
      cleanup();
      if (err && err.message !== "Premature close")
        logger.error(err, "Pipeline error");
    });
  } catch (e) {
    cleanup();
    logger.error(e, "Stream error");
    res.statusCode = 500;
    res.end();
  }
}

export function getGpsExtractionQueueStatus() {
  return {
    limit: GPS_CONCURRENT_LIMIT,
    processing: Array.from(processingGpsExtractions),
    queued: gpsExtractionQueue.map((item) => ({
      id: item.id,
      queuedAt: item.queuedAt,
    })),
  };
}

export function updatePairLocation(
  id: string,
  location: {
    startCity?: string;
    startCountry?: string;
    endCity?: string;
    endCountry?: string;
  },
): boolean {
  const pair = INDEX.get(id);
  if (!pair) {
    return false;
  }

  if (location.startCity !== undefined) {
    pair.startCity = location.startCity || undefined;
  }
  if (location.startCountry !== undefined) {
    pair.startCountry = location.startCountry || undefined;
  }
  if (location.endCity !== undefined) {
    pair.endCity = location.endCity || undefined;
  }
  if (location.endCountry !== undefined) {
    pair.endCountry = location.endCountry || undefined;
  }

  pair.startLocationName = `${pair.startCity || "Unknown City"}, ${
    pair.startCountry || "Unknown Country"
  }`;
  pair.endLocationName = `${pair.endCity || "Unknown City"}, ${
    pair.endCountry || "Unknown Country"
  }`;

  saveCache();
  return true;
}

export function getAllUniqueLocations(): {
  cities: string[];
  countries: string[];
} {
  const cityCount = new Map<string, number>();
  const countryCount = new Map<string, number>();

  for (const pair of INDEX.values()) {
    if (pair.startCity)
      cityCount.set(pair.startCity, (cityCount.get(pair.startCity) || 0) + 1);
    if (pair.endCity)
      cityCount.set(pair.endCity, (cityCount.get(pair.endCity) || 0) + 1);
    if (pair.startCountry)
      countryCount.set(
        pair.startCountry,
        (countryCount.get(pair.startCountry) || 0) + 1,
      );
    if (pair.endCountry)
      countryCount.set(
        pair.endCountry,
        (countryCount.get(pair.endCountry) || 0) + 1,
      );
  }

  return {
    cities: Array.from(cityCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([city]) => city),
    countries: Array.from(countryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([country]) => country),
  };
}

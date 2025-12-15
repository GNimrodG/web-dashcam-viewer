import { execa, ExecaError } from "execa";
import type { GpsPoint } from "../types.js";
import { logger } from "../logger.js";
import { processManager } from "../utils/process-manager.js";
import fs from "node:fs";

// Persistent file-based cache: stores a JSON file per video (e.g., myvideo.mp4.gpscache.json)
// Can be redirected to local disk for network shares via GPS_CACHE_DIR
function getGpsCachePath(filePath: string) {
  const cacheDir = process.env.GPS_CACHE_DIR;
  if (cacheDir) {
    // Use separate cache directory (recommended for network shares)
    const hash = Buffer.from(filePath).toString("base64url");
    return `${cacheDir}/${hash}.json`;
  }
  // Default: store cache next to video file
  return filePath + ".gpscache.json";
}

/**
 * Extract timed GPS track from embedded metadata.
 * Priority:
 *  1) exiftool (-ee) via CSV: GPSDateTime, lat, lon, speed(m/s)
 *  2) ffprobe NMEA from data/subtitle streams (if ENABLE_FFPROBE_DATA_STREAMS != "false")
 *  3) ffprobe NMEA from H.264 video SEI (v:0) (if ENABLE_FFPROBE_VIDEO_STREAMS="true")
 *
 * Optional env:
 *  - ENABLE_FFPROBE_DATA_STREAMS: enable ffprobe data/subtitle streams fallback (default: true)
 *  - ENABLE_FFPROBE_VIDEO_STREAMS: enable ffprobe video SEI streams fallback (default: false)
 *  - GPS_SCAN_SECONDS: limit ffprobe scanning to the first N seconds (e.g., 120)
 */
export async function extractTimedGpsTrack(
  filePath: string,
): Promise<GpsPoint[]> {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // File missing or unreadable
    return [];
  }

  const mtimeMs = stat.mtimeMs;
  const cachePath = getGpsCachePath(filePath);
  // Try to read cache
  let cached: { mtimeMs: number; data: GpsPoint[] } | undefined;
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf8");
      cached = JSON.parse(raw);
      if (cached?.mtimeMs === mtimeMs && Array.isArray(cached.data)) {
        if (cached.data.length === 0) {
          logger.debug(`GPS cache hit (no GPS data): ${cachePath}`);
        } else {
          logger.debug(
            `GPS cache hit (${cached.data.length} points): ${cachePath}`,
          );
        }
        return cached.data;
      }
    }
  } catch (e) {
    logger.warn(e, `Failed to read GPS cache: ${cachePath}`);
  }

  // Not cached or cache invalid, extract
  logger.info(`Extracting GPS from: ${filePath}`);
  const viaExif = await extractViaExifToolCSV(filePath);
  let data: GpsPoint[] = [];
  if (viaExif.length) {
    data = viaExif;
  } else {
    const enableDataStreams =
      process.env.ENABLE_FFPROBE_DATA_STREAMS !== "false";
    const enableVideoStreams =
      process.env.ENABLE_FFPROBE_VIDEO_STREAMS === "true";

    if (enableDataStreams) {
      try {
        const viaData = await extractFromStreams(filePath, "d,s");
        if (viaData.length) {
          data = viaData;
        }
      } catch (e) {
        logger.debug(e, "extractFromStreams (data/subtitle) failed");
      }
    } else {
      logger.debug(
        `ffprobe data/subtitle streams disabled (ENABLE_FFPROBE_DATA_STREAMS=false)`,
      );
    }

    if (!data.length && enableVideoStreams) {
      try {
        const viaVideoSei = await extractFromStreams(filePath, "v:0");
        data = viaVideoSei;
      } catch (e) {
        logger.debug(e, "extractFromStreams (video SEI) failed");
      }
    } else if (!data.length) {
      logger.debug(
        `ffprobe video streams disabled (ENABLE_FFPROBE_VIDEO_STREAMS not set to true)`,
      );
    }
  }

  // Write cache
  try {
    fs.writeFileSync(cachePath, JSON.stringify({ mtimeMs, data }), "utf8");
    if (data.length === 0) {
      logger.info(`No GPS data found in: ${filePath}`);
    } else {
      logger.info(`Extracted ${data.length} GPS points from: ${filePath}`);
    }
  } catch (e) {
    logger.warn(e, `Failed to write GPS cache: ${cachePath}`);
  }
  return data;
}

/* ---------------- ExifTool path (CSV) ---------------- */

async function extractViaExifToolCSV(filePath: string): Promise<GpsPoint[]> {
  try {
    logger.info(`[ExifTool] Starting GPS extraction: ${filePath}`);
    // CSV: GPSDateTime, lat, lon, speed(m/s). Altitude omitted since many Viofo clips don't include it per-sample.
    // -api MissingTagValue= -> blanks missing fields, -q -q -> quiet
    const template = "$GPSDateTime,$GPSLatitude,$GPSLongitude,$GPSSpeed";
    const proc = execa(
      "exiftool",
      [
        "-n",
        "-ee",
        "-api",
        "QuickTimeUTC=1",
        "-api",
        "MissingTagValue=",
        "-q",
        "-q",
        // -d %s would convert date/time to epoch, but some builds still emit "YYYY:MM:DD HH:MM:SSZ".
        // We'll accept both formats in code.
        "-d",
        "%s",
        "-p",
        template,
        filePath,
      ],
      {
        stdout: "pipe",
      },
    );

    processManager.register(proc);

    let rowCount = 0;
    let stdout = "";

    // Stream stdout and log progress
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      logger.trace(`[ExifTool] ${chunk.toString().trim()}`);

      const newRows = chunk
        .toString()
        .split(/\r?\n/)
        .filter((l: string) => l.trim().length > 0);

      rowCount += newRows.length;

      if (rowCount > 0 && rowCount % 100 === 0) {
        logger.info(
          `[ExifTool] Extracted ${rowCount} GPS samples so far from: ${filePath}`,
        );
      }
    });

    try {
      const result = await proc;
      logger.info(
        `[ExifTool] GPS extraction finished with exit code ${result.exitCode} for: ${filePath}`,
      );
    } catch (error) {
      logger.debug(`[ExifTool] Extraction failed: ${error}`);
      return [];
    }

    logger.info(`[ExifTool] Parsing GPS data output...`);
    const rows = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (rows.length === 0) {
      logger.info(`[ExifTool] No GPS data found in file: ${filePath}`);
      return [];
    }

    logger.info(`[ExifTool] Processing ${rows.length} GPS data rows...`);

    type Row = {
      epochOrStr?: string; // epoch seconds as string OR "YYYY:MM:DD HH:MM:SSZ"
      lat?: number;
      lon?: number;
      speedMs?: number;
    };

    const parsed: Row[] = rows.map((line) => {
      // gpsDateTime,lat,lon,speedMs
      const [t, la, lo, sp] = line.split(",");
      return {
        epochOrStr: t,
        lat: toNum(la),
        lon: toNum(lo),
        speedMs: toNum(sp),
      };
    });

    logger.info(`[ExifTool] Filtering valid GPS coordinates...`);
    const valid = parsed.filter(
      (r) => isFiniteNum(r.lat) && isFiniteNum(r.lon) && r.epochOrStr,
    );
    if (valid.length === 0) return [];

    logger.info(
      `[ExifTool] Converting ${valid.length} timestamps to epoch seconds...`,
    );
    // Convert times to epoch seconds; handle both epoch strings and "YYYY:MM:DD HH:MM:SSZ"
    const epochs = valid
      .map((r) => toEpochSeconds(r.epochOrStr!))
      .filter(isFiniteNum);
    if (epochs.length === 0) return [];

    const t0 = Math.min(...epochs);

    logger.info(`[ExifTool] Creating GPS point objects...`);
    const points: GpsPoint[] = valid.map((r) => {
      const epoch = toEpochSeconds(r.epochOrStr!);
      const tsSec = epoch - t0;
      return {
        tsSec,
        lat: r.lat as number,
        lon: r.lon as number,
        speedKph: isFiniteNum(r.speedMs) ? r.speedMs * 3.6 : undefined,
      };
    });

    logger.info(`[ExifTool] Sorting and deduplicating GPS points...`);
    points.sort((a, b) => a.tsSec - b.tsSec);
    const deduped = dedupePoints(points);
    logger.info(`[ExifTool] Extracted ${deduped.length} GPS points`);
    return deduped;
  } catch (error) {
    logger.debug(`[ExifTool] Extraction error: ${error}`);
    return [];
  }
}

/* ---------------- ffprobe paths (fallback) ---------------- */

async function extractFromStreams(
  filePath: string,
  select: string,
): Promise<GpsPoint[]> {
  try {
    logger.info(
      `[ffprobe] Starting GPS extraction (streams: ${select}): ${filePath}`,
    );
    const readIntervals = process.env.GPS_SCAN_SECONDS
      ? ["-read_intervals", `%+#${process.env.GPS_SCAN_SECONDS}`]
      : [];

    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-select_streams",
      select,
      ...readIntervals,
      "-show_packets",
      "-show_entries",
      "packet=pts_time,data",
      "-show_data",
      filePath,
    ];

    logger.debug(`[ffprobe] Running program: ffprobe ${args.join(" ")}`);
    const proc = execa("ffprobe", args, {
      stdout: "pipe",
    });

    processManager.register(proc);

    let buffer = "";
    let inPacketsArray = false;
    let packetCount = 0;
    const points: GpsPoint[] = [];
    let lastLogTime = Date.now();
    const logInterval = 5000; // Log every 5 seconds

    // Stream stdout and parse packets incrementally
    proc.stdout?.on("data", (chunk) => {
      buffer += chunk.toString();

      // Wait until we're inside the packets array
      if (!inPacketsArray) {
        const packetsStart = buffer.indexOf('"packets": [');
        if (packetsStart === -1) {
          return; // Keep buffering until we find the start
        } else {
          inPacketsArray = true;
          buffer = buffer.slice(packetsStart + 12); // Skip past the opening
        }
      }

      // Process complete packet objects
      let braceDepth = 0;
      let packetStart = -1;
      let i = 0;

      while (i < buffer.length) {
        const char = buffer[i];

        if (char === "{") {
          if (braceDepth === 0) packetStart = i;
          braceDepth++;
        } else if (char === "}") {
          braceDepth--;
          if (braceDepth === 0 && packetStart !== -1) {
            // Found a complete packet
            const packetJson = buffer.slice(packetStart, i + 1);
            try {
              const p = JSON.parse(packetJson);
              packetCount++;

              // Process the packet immediately
              const ptsTime =
                p.pts_time === undefined ? undefined : Number(p.pts_time);
              const payload: string | undefined =
                typeof p.data === "string" ? p.data : undefined;

              if (payload) {
                const ascii = hexDumpToAscii(payload);
                const lines = ascii
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter((l) => l.startsWith("$GP") || l.startsWith("$GN"));

                if (lines.length > 0) {
                  const rmc = lines.find((l) => /\$(G[PN])RMC/.test(l));
                  const gga = lines.find((l) => /\$(G[PN])GGA/.test(l));

                  let parsed: Partial<GpsPoint> | null = null;

                  if (rmc) {
                    const r = parseRMC(rmc);
                    if (r?.lat !== undefined && r.lon !== undefined) {
                      parsed = {
                        tsSec: ptsTime ?? r.tsSec ?? 0,
                        lat: r.lat,
                        lon: r.lon,
                        speedKph: r.speedKph,
                      };
                    }
                  }

                  if (!parsed && gga) {
                    const g = parseGGA(gga);
                    if (g?.lat !== undefined && g.lon !== undefined) {
                      parsed = {
                        tsSec: ptsTime ?? g.tsSec ?? 0,
                        lat: g.lat,
                        lon: g.lon,
                        alt: g.alt,
                      };
                    }
                  }

                  if (
                    parsed &&
                    isFiniteNum(parsed.lat) &&
                    isFiniteNum(parsed.lon)
                  ) {
                    points.push({
                      tsSec: isFiniteNum(parsed.tsSec) ? parsed.tsSec : 0,
                      lat: parsed.lat,
                      lon: parsed.lon,
                      alt: parsed.alt,
                      speedKph: parsed.speedKph,
                    });
                  }
                }
              }

              // Log progress
              const now = Date.now();
              if (packetCount % 100 === 0 || now - lastLogTime >= logInterval) {
                logger.info(
                  `[ffprobe] Processed ${packetCount} packets, found ${points.length} GPS points so far`,
                );
                lastLogTime = now;
              }
            } catch (e) {
              // Skip malformed packet JSON
              logger.debug(`[ffprobe] Failed to parse packet JSON: ${e}`);
            }

            // Remove processed packet from buffer
            buffer = buffer.slice(i + 1);
            i = 0;
            packetStart = -1;
            continue;
          }
        }
        i++;
      }

      // Keep only the incomplete part in the buffer
      if (packetStart !== -1 && braceDepth > 0) {
        buffer = buffer.slice(packetStart);
      } else if (braceDepth === 0) {
        buffer = "";
      }
    });

    try {
      await proc;
      logger.info(
        `[ffprobe] Finished - processed ${packetCount} total packets`,
      );
    } catch (error: unknown) {
      if (error instanceof ExecaError) {
        logger.debug(
          `[ffprobe] Extraction failed (exit code ${error.exitCode}): ${error.shortMessage}`,
        );
      } else {
        logger.debug(`[ffprobe] Extraction failed: ${error}`);
      }

      return [];
    }

    if (packetCount === 0) {
      logger.info(`[ffprobe] No packets found in streams ${select}`);
      return [];
    }

    if (points.length === 0) {
      logger.info(
        `[ffprobe] No GPS data found in ${packetCount} packets from streams ${select}`,
      );
      return [];
    }

    logger.info(
      `[ffprobe] Sorting and deduplicating ${points.length} GPS points from ffprobe...`,
    );
    points.sort((a, b) => a.tsSec - b.tsSec);
    const deduped = dedupePoints(points);
    logger.info(
      `[ffprobe] Extracted ${deduped.length} GPS points from streams ${select}`,
    );
    return deduped;
  } catch (error) {
    logger.debug(`[ffprobe] Extraction failed: ${error}`);
    return [];
  }
}

/* ---------------- helpers ---------------- */

function toEpochSeconds(s: string): number {
  // If s looks like an integer epoch, parse directly
  if (/^\d{9,}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  // Expect "YYYY:MM:DD HH:MM:SSZ" or without Z
  const m = new RegExp(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(Z)?$/,
  ).exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || "Z"}`;
    const d = new Date(iso);
    const t = d.getTime();
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Number.NaN;
}

function hexDumpToAscii(hexDump: string): string {
  // Extract hex byte pairs from ffprobe hexdump (ignores offsets and ASCII columns)
  const pairs = hexDump.match(/\b[0-9a-fA-F]{2}\b/g) || [];
  const bytes = pairs.map((h) => Number.parseInt(h, 16));
  const filtered = bytes.map((n) =>
    (n >= 0x20 && n <= 0x7e) || n === 0x0a || n === 0x0d || n === 0x09
      ? n
      : 0x20,
  );
  return String.fromCodePoint(...filtered);
}

function dedupePoints(points: GpsPoint[]): GpsPoint[] {
  const dedupedList: GpsPoint[] = [];
  let lastKey = "";
  for (const p of points) {
    const key = `${Math.round(p.tsSec * 1000)}|${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`;
    if (key !== lastKey) {
      dedupedList.push(p);
      lastKey = key;
    }
  }
  return dedupedList;
}

function toNum(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

// $..RMC: lat/lon + speed (knots -> kph)
function parseRMC(line: string): {
  tsSec?: number;
  status?: string;
  lat?: number;
  lon?: number;
  speedKph?: number;
} | null {
  // $GPRMC,hhmmss.sss,A,llll.ll,a,yyyyy.yy,a,x.x,xxx.x,ddmmyy,x.x,a*hh
  const parts = line.split(",");
  if (parts.length < 12) return null;

  const timeStr = parts[1];
  const status = parts[2];
  const latStr = parts[3];
  const latHem = parts[4];
  const lonStr = parts[5];
  const lonHem = parts[6];
  const speedKnotsStr = parts[7];

  const lat = parseNmeaCoord(latStr, latHem);
  const lon = parseNmeaCoord(lonStr, lonHem);
  const speedKnots = Number(speedKnotsStr);
  const speedKph = Number.isFinite(speedKnots) ? speedKnots * 1.852 : undefined;
  const tsSec = parseHhMmSs(timeStr);

  return { tsSec, status, lat, lon, speedKph };
}

// $..GGA: lat/lon + altitude
function parseGGA(
  line: string,
): { tsSec?: number; lat?: number; lon?: number; alt?: number } | null {
  // $GPGGA,hhmmss.sss,llll.ll,a,yyyyy.yy,a,fix,nsats,hdop,alt,M,geo,M,dgpsAge,dgpsId*cs
  const parts = line.split(",");
  if (parts.length < 10) return null;

  const timeStr = parts[1];
  const latStr = parts[2];
  const latHem = parts[3];
  const lonStr = parts[4];
  const lonHem = parts[5];
  const altStr = parts[9];

  const lat = parseNmeaCoord(latStr, latHem);
  const lon = parseNmeaCoord(lonStr, lonHem);
  const alt = Number(altStr);
  const tsSec = parseHhMmSs(timeStr);

  return { tsSec, lat, lon, alt: Number.isFinite(alt) ? alt : undefined };
}

function parseNmeaCoord(coord: string, hemi: string): number | undefined {
  if (!coord || !hemi) return undefined;
  const isLat = hemi.toUpperCase() === "N" || hemi.toUpperCase() === "S";
  const degDigits = isLat ? 2 : 3;

  const degStr = coord.slice(0, degDigits);
  const minStr = coord.slice(degDigits);

  const deg = Number(degStr);
  const minutes = Number(minStr);
  if (!Number.isFinite(deg) || !Number.isFinite(minutes)) return undefined;

  let dec = deg + minutes / 60;
  if (hemi.toUpperCase() === "S" || hemi.toUpperCase() === "W") dec = -dec;
  return dec;
}

function parseHhMmSs(timeStr: string): number | undefined {
  // hhmmss.sss
  if (!timeStr) return undefined;
  const m = new RegExp(/^(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/).exec(timeStr);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  if (![h, mi, s].every(Number.isFinite)) return undefined;
  return h * 3600 + mi * 60 + s + frac;
}

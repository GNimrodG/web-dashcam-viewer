import Database from "better-sqlite3";
import path from "node:path";
import { logger } from "../logger.js";

export interface ShareToken {
  id: string;
  videoId: string;
  clipStartTime: number;
  clipEndTime: number;
  clipChannels: string;
  createdAt: number;
  expiresAt: number | null;
  createdBy: string | null;
}

export interface VideoPoi {
  id: string;
  videoId: string;
  timeSec: number;
  label: string;
  createdAt: number;
  kind?: "manual" | "camera-save";
}

export interface VideoPoiTypeCounts {
  total: number;
  manual: number;
  cameraSave: number;
}

export interface RecordingAudioScan {
  videoId: string;
  sourceSignature: string;
  detectorVersion: number;
  status: "scanned" | "no-audio" | "failed";
  scannedAt: number;
}

export interface RecordingOverlayMetadata {
  videoId: string;
  cameraType?: string;
  licensePlate?: string;
  sourcePath: string;
  sourceMtimeMs: number;
  extractorVersion: number;
  status: "found" | "not-found" | "failed";
  ocrStatus?: "found" | "not-found" | "failed";
  overridden?: boolean;
  scannedAt: number;
  frameTimeSec?: number;
}

type RecordingOverlayMetadataRow = Omit<
  RecordingOverlayMetadata,
  "cameraType" | "licensePlate" | "frameTimeSec" | "ocrStatus" | "overridden"
> & {
  cameraType: string | null;
  licensePlate: string | null;
  cameraTypeOverride: string | null;
  licensePlateOverride: string | null;
  metadataOverridden: number;
  ocrStatus: "found" | "not-found" | "failed" | null;
  frameTimeSec: number | null;
};

function mapRecordingOverlayMetadataRow(
  row: RecordingOverlayMetadataRow,
): RecordingOverlayMetadata {
  const {
    cameraType,
    licensePlate,
    cameraTypeOverride,
    licensePlateOverride,
    metadataOverridden,
    ocrStatus,
    frameTimeSec,
    ...metadata
  } = row;
  const effectiveCameraType = metadataOverridden
    ? cameraTypeOverride
    : cameraType;
  const effectiveLicensePlate = metadataOverridden
    ? licensePlateOverride
    : licensePlate;

  return {
    ...metadata,
    cameraType: effectiveCameraType || undefined,
    licensePlate: effectiveLicensePlate || undefined,
    status: metadataOverridden
      ? effectiveCameraType || effectiveLicensePlate
        ? "found"
        : "not-found"
      : metadata.status,
    ocrStatus: ocrStatus ?? undefined,
    overridden: Boolean(metadataOverridden),
    frameTimeSec: frameTimeSec ?? undefined,
  };
}

let db: Database.Database;

export function initDatabase(mediaDir: string) {
  const dbPath = path.join(mediaDir, ".dashcam-viewer.db");
  logger.info({ dbPath }, "Initializing database");

  try {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    // Create share_tokens table
    db.exec(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      clip_start_time REAL NOT NULL,
      clip_end_time REAL NOT NULL,
      clip_channels TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      created_by TEXT
    )
  `);

    // Create index for faster lookups
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_video_id
    ON share_tokens(video_id)
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS video_pois (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      time_sec REAL NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_pois_video_time
    ON video_pois(video_id, time_sec)
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS recording_audio_events (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      time_sec REAL NOT NULL,
      event_type TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recording_audio_events_video_time
    ON recording_audio_events(video_id, time_sec)
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS recording_audio_scans (
      video_id TEXT PRIMARY KEY,
      source_signature TEXT NOT NULL,
      detector_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      scanned_at INTEGER NOT NULL
    )
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS recording_time_zones (
      video_id TEXT PRIMARY KEY,
      time_zone TEXT NOT NULL
    )
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS recording_start_times (
      video_id TEXT PRIMARY KEY,
      start_time TEXT NOT NULL
    )
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS recording_overlay_metadata (
      video_id TEXT PRIMARY KEY,
      camera_type TEXT,
      license_plate TEXT,
      source_path TEXT NOT NULL,
      source_mtime_ms REAL NOT NULL,
      extractor_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      scanned_at INTEGER NOT NULL,
      frame_time_sec REAL,
      camera_type_override TEXT,
      license_plate_override TEXT,
      metadata_overridden INTEGER NOT NULL DEFAULT 0,
      ocr_status TEXT
    )
  `);

    const overlayMetadataColumns = new Set(
      (
        db.prepare("PRAGMA table_info(recording_overlay_metadata)").all() as {
          name: string;
        }[]
      ).map((column) => column.name),
    );
    if (!overlayMetadataColumns.has("camera_type_override")) {
      db.exec(
        "ALTER TABLE recording_overlay_metadata ADD COLUMN camera_type_override TEXT",
      );
    }
    if (!overlayMetadataColumns.has("license_plate_override")) {
      db.exec(
        "ALTER TABLE recording_overlay_metadata ADD COLUMN license_plate_override TEXT",
      );
    }
    if (!overlayMetadataColumns.has("metadata_overridden")) {
      db.exec(
        "ALTER TABLE recording_overlay_metadata ADD COLUMN metadata_overridden INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!overlayMetadataColumns.has("ocr_status")) {
      db.exec(
        "ALTER TABLE recording_overlay_metadata ADD COLUMN ocr_status TEXT",
      );
    }
    db.exec(`
      UPDATE recording_overlay_metadata
      SET ocr_status = status
      WHERE ocr_status IS NULL
        AND (
          metadata_overridden = 0
          OR camera_type IS NOT NULL
          OR license_plate IS NOT NULL
          OR frame_time_sec IS NOT NULL
        )
    `);

    // Clean up expired tokens on startup
    cleanExpiredTokens();

    logger.info("Database initialized");
  } catch (error) {
    logger.error({ error }, "Failed to initialize database");
    process.exit(1);
  }
}

export function createShareToken(token: ShareToken): void {
  const stmt = db.prepare(`
    INSERT INTO share_tokens 
    (id, video_id, clip_start_time, clip_end_time, clip_channels, created_at, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    token.id,
    token.videoId,
    token.clipStartTime,
    token.clipEndTime,
    token.clipChannels,
    token.createdAt,
    token.expiresAt,
    token.createdBy,
  );
}

export function getShareToken(id: string): ShareToken | null {
  const stmt = db.prepare(`
    SELECT 
      id,
      video_id as videoId,
      clip_start_time as clipStartTime,
      clip_end_time as clipEndTime,
      clip_channels as clipChannels,
      created_at as createdAt,
      expires_at as expiresAt,
      created_by as createdBy
    FROM share_tokens 
    WHERE id = ?
  `);

  const row = stmt.get(id) as ShareToken | undefined;

  if (!row) return null;

  // Check if expired
  if (row.expiresAt && row.expiresAt < Date.now()) {
    deleteShareToken(id);
    return null;
  }

  return row;
}

export function deleteShareToken(id: string): void {
  const stmt = db.prepare("DELETE FROM share_tokens WHERE id = ?");
  stmt.run(id);
}

export function cleanExpiredTokens(): number {
  const stmt = db.prepare(
    "DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at < ?",
  );
  const result = stmt.run(Date.now());
  return result.changes;
}

export function getTokensForVideo(videoId: string): ShareToken[] {
  const stmt = db.prepare(`
    SELECT 
      id,
      video_id as videoId,
      clip_start_time as clipStartTime,
      clip_end_time as clipEndTime,
      clip_channels as clipChannels,
      created_at as createdAt,
      expires_at as expiresAt,
      created_by as createdBy
    FROM share_tokens 
    WHERE video_id = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(videoId) as ShareToken[];
}

export function createVideoPoi(poi: VideoPoi): void {
  db.prepare(
    `INSERT INTO video_pois (id, video_id, time_sec, label, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(poi.id, poi.videoId, poi.timeSec, poi.label, poi.createdAt);
}

export function getVideoPois(videoId: string): VideoPoi[] {
  const rows = db
    .prepare(
      `SELECT
         id,
         video_id as videoId,
         time_sec as timeSec,
         label,
         created_at as createdAt
       FROM video_pois
       WHERE video_id = ?
       ORDER BY time_sec ASC, created_at ASC`,
    )
    .all(videoId) as VideoPoi[];
  return rows.map((poi) => ({ ...poi, kind: "manual" }));
}

export function getAllVideoPois(videoId: string): VideoPoi[] {
  return db
    .prepare(
      `SELECT
         id,
         video_id as videoId,
         time_sec as timeSec,
         label,
         created_at as createdAt,
         'manual' as kind
       FROM video_pois
       WHERE video_id = ?
       UNION ALL
       SELECT
         id,
         video_id as videoId,
         time_sec as timeSec,
         label,
         created_at as createdAt,
         event_type as kind
       FROM recording_audio_events
       WHERE video_id = ?
       ORDER BY timeSec ASC, createdAt ASC`,
    )
    .all(videoId, videoId) as VideoPoi[];
}

export function getAllVideoPoisMap(): Map<string, VideoPoi[]> {
  const rows = db
    .prepare(
      `SELECT
         id,
         video_id as videoId,
         time_sec as timeSec,
         label,
         created_at as createdAt,
         'manual' as kind
       FROM video_pois
       UNION ALL
       SELECT
         id,
         video_id as videoId,
         time_sec as timeSec,
         label,
         created_at as createdAt,
         event_type as kind
       FROM recording_audio_events
       ORDER BY videoId ASC, timeSec ASC, createdAt ASC`,
    )
    .all() as VideoPoi[];
  const result = new Map<string, VideoPoi[]>();
  for (const poi of rows) {
    const pois = result.get(poi.videoId) ?? [];
    pois.push(poi);
    result.set(poi.videoId, pois);
  }
  return result;
}

export function getVideoPoiCount(videoId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM (
         SELECT video_id FROM video_pois WHERE video_id = ?
         UNION ALL
         SELECT video_id FROM recording_audio_events WHERE video_id = ?
       )`,
    )
    .get(videoId, videoId) as { count: number };
  return row.count;
}

export function getVideoPoiCounts(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT video_id as videoId, COUNT(*) as count
       FROM (
         SELECT video_id FROM video_pois
         UNION ALL
         SELECT video_id FROM recording_audio_events
       )
       GROUP BY video_id`,
    )
    .all() as Array<{ videoId: string; count: number }>;
  return new Map(rows.map((row) => [row.videoId, row.count]));
}

export function getVideoPoiTypeCounts(videoId: string): VideoPoiTypeCounts {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM video_pois WHERE video_id = ?) as manual,
         (SELECT COUNT(*) FROM recording_audio_events
          WHERE video_id = ? AND event_type = 'camera-save') as cameraSave`,
    )
    .get(videoId, videoId) as Omit<VideoPoiTypeCounts, "total">;
  return {
    ...row,
    total: row.manual + row.cameraSave,
  };
}

export function getVideoPoiTypeCountsMap(): Map<string, VideoPoiTypeCounts> {
  const rows = db
    .prepare(
      `SELECT
         videoId,
         SUM(manual) as manual,
         SUM(cameraSave) as cameraSave
       FROM (
         SELECT video_id as videoId, COUNT(*) as manual, 0 as cameraSave
         FROM video_pois
         GROUP BY video_id
         UNION ALL
         SELECT video_id as videoId, 0 as manual, COUNT(*) as cameraSave
         FROM recording_audio_events
         WHERE event_type = 'camera-save'
         GROUP BY video_id
       )
       GROUP BY videoId`,
    )
    .all() as Array<{
    videoId: string;
    manual: number;
    cameraSave: number;
  }>;
  return new Map(
    rows.map((row) => [
      row.videoId,
      {
        manual: row.manual,
        cameraSave: row.cameraSave,
        total: row.manual + row.cameraSave,
      },
    ]),
  );
}

export function getRecordingAudioScan(
  videoId: string,
): RecordingAudioScan | undefined {
  return db
    .prepare(
      `SELECT
         video_id as videoId,
         source_signature as sourceSignature,
         detector_version as detectorVersion,
         status,
         scanned_at as scannedAt
       FROM recording_audio_scans
       WHERE video_id = ?`,
    )
    .get(videoId) as RecordingAudioScan | undefined;
}

export function getRecordingAudioScans(): Map<string, RecordingAudioScan> {
  const rows = db
    .prepare(
      `SELECT
         video_id as videoId,
         source_signature as sourceSignature,
         detector_version as detectorVersion,
         status,
         scanned_at as scannedAt
       FROM recording_audio_scans`,
    )
    .all() as RecordingAudioScan[];
  return new Map(rows.map((row) => [row.videoId, row]));
}

export function replaceRecordingAudioEvents(
  scan: RecordingAudioScan,
  events: readonly VideoPoi[],
): void {
  db.transaction(() => {
    db.prepare("DELETE FROM recording_audio_events WHERE video_id = ?").run(
      scan.videoId,
    );
    const insertEvent = db.prepare(
      `INSERT INTO recording_audio_events
         (id, video_id, time_sec, event_type, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      insertEvent.run(
        event.id,
        scan.videoId,
        event.timeSec,
        event.kind ?? "camera-save",
        event.label,
        event.createdAt,
      );
    }
    db.prepare(
      `INSERT INTO recording_audio_scans
         (video_id, source_signature, detector_version, status, scanned_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         source_signature = excluded.source_signature,
         detector_version = excluded.detector_version,
         status = excluded.status,
         scanned_at = excluded.scanned_at`,
    ).run(
      scan.videoId,
      scan.sourceSignature,
      scan.detectorVersion,
      scan.status,
      scan.scannedAt,
    );
  })();
}

export function setRecordingTimeZone(videoId: string, timeZone: string): void {
  db.prepare(
    `INSERT INTO recording_time_zones (video_id, time_zone)
     VALUES (?, ?)
     ON CONFLICT(video_id) DO UPDATE SET time_zone = excluded.time_zone`,
  ).run(videoId, timeZone);
}

export function getRecordingTimeZone(videoId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT time_zone as timeZone
       FROM recording_time_zones
       WHERE video_id = ?`,
    )
    .get(videoId) as { timeZone: string } | undefined;
  return row?.timeZone;
}

export function getRecordingTimeZones(): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT video_id as videoId, time_zone as timeZone
       FROM recording_time_zones`,
    )
    .all() as Array<{ videoId: string; timeZone: string }>;
  return new Map(rows.map((row) => [row.videoId, row.timeZone]));
}

export function setRecordingStartTime(
  videoId: string,
  startTime: string,
): void {
  db.prepare(
    `INSERT INTO recording_start_times (video_id, start_time)
     VALUES (?, ?)
     ON CONFLICT(video_id) DO UPDATE SET start_time = excluded.start_time`,
  ).run(videoId, startTime);
}

export function deleteRecordingStartTime(videoId: string): void {
  db.prepare("DELETE FROM recording_start_times WHERE video_id = ?").run(
    videoId,
  );
}

export function getRecordingStartTime(videoId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT start_time as startTime
       FROM recording_start_times
       WHERE video_id = ?`,
    )
    .get(videoId) as { startTime: string } | undefined;
  return row?.startTime;
}

export function getRecordingStartTimes(): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT video_id as videoId, start_time as startTime
       FROM recording_start_times`,
    )
    .all() as Array<{ videoId: string; startTime: string }>;
  return new Map(rows.map((row) => [row.videoId, row.startTime]));
}

export function getRecordingOverlayMetadata(
  videoId: string,
): RecordingOverlayMetadata | undefined {
  const row = db
    .prepare(
      `SELECT
         video_id as videoId,
         camera_type as cameraType,
         license_plate as licensePlate,
         camera_type_override as cameraTypeOverride,
         license_plate_override as licensePlateOverride,
         metadata_overridden as metadataOverridden,
         ocr_status as ocrStatus,
         source_path as sourcePath,
         source_mtime_ms as sourceMtimeMs,
         extractor_version as extractorVersion,
         status,
         scanned_at as scannedAt,
         frame_time_sec as frameTimeSec
       FROM recording_overlay_metadata
       WHERE video_id = ?`,
    )
    .get(videoId) as RecordingOverlayMetadataRow | undefined;
  return row ? mapRecordingOverlayMetadataRow(row) : undefined;
}

export function getRecordingOverlayMetadataMap(): Map<
  string,
  RecordingOverlayMetadata
> {
  const rows = db
    .prepare(
      `SELECT
         video_id as videoId,
         camera_type as cameraType,
         license_plate as licensePlate,
         camera_type_override as cameraTypeOverride,
         license_plate_override as licensePlateOverride,
         metadata_overridden as metadataOverridden,
         ocr_status as ocrStatus,
         source_path as sourcePath,
         source_mtime_ms as sourceMtimeMs,
         extractor_version as extractorVersion,
         status,
         scanned_at as scannedAt,
         frame_time_sec as frameTimeSec
       FROM recording_overlay_metadata`,
    )
    .all() as RecordingOverlayMetadataRow[];
  return new Map(
    rows.map((row) => [row.videoId, mapRecordingOverlayMetadataRow(row)]),
  );
}

export function upsertRecordingOverlayMetadata(
  metadata: RecordingOverlayMetadata,
): RecordingOverlayMetadata {
  db.prepare(
    `INSERT INTO recording_overlay_metadata
       (video_id, camera_type, license_plate, source_path, source_mtime_ms,
        extractor_version, status, ocr_status, scanned_at, frame_time_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       camera_type = excluded.camera_type,
       license_plate = excluded.license_plate,
       source_path = excluded.source_path,
       source_mtime_ms = excluded.source_mtime_ms,
       extractor_version = excluded.extractor_version,
       status = excluded.status,
       ocr_status = excluded.ocr_status,
       scanned_at = excluded.scanned_at,
       frame_time_sec = excluded.frame_time_sec`,
  ).run(
    metadata.videoId,
    metadata.cameraType ?? null,
    metadata.licensePlate ?? null,
    metadata.sourcePath,
    metadata.sourceMtimeMs,
    metadata.extractorVersion,
    metadata.status,
    metadata.ocrStatus ?? metadata.status,
    metadata.scannedAt,
    metadata.frameTimeSec ?? null,
  );
  return getRecordingOverlayMetadata(metadata.videoId)!;
}

export function setRecordingOverlayMetadataCorrection(input: {
  videoId: string;
  cameraType?: string;
  licensePlate?: string;
  sourcePath: string;
  sourceMtimeMs: number;
  extractorVersion: number;
}): RecordingOverlayMetadata {
  const correctedCameraType = input.cameraType || null;
  const correctedLicensePlate = input.licensePlate || null;
  const status =
    correctedCameraType || correctedLicensePlate ? "found" : "not-found";

  db.prepare(
    `INSERT INTO recording_overlay_metadata
       (video_id, camera_type, license_plate, source_path, source_mtime_ms,
        extractor_version, status, ocr_status, scanned_at, frame_time_sec,
        camera_type_override, license_plate_override, metadata_overridden)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 1)
     ON CONFLICT(video_id) DO UPDATE SET
       camera_type_override = excluded.camera_type_override,
       license_plate_override = excluded.license_plate_override,
       metadata_overridden = 1`,
  ).run(
    input.videoId,
    input.sourcePath,
    input.sourceMtimeMs,
    input.extractorVersion,
    status,
    Date.now(),
    correctedCameraType,
    correctedLicensePlate,
  );

  return getRecordingOverlayMetadata(input.videoId)!;
}

export function deleteVideoPoi(videoId: string, poiId: string): boolean {
  const result = db
    .prepare("DELETE FROM video_pois WHERE id = ? AND video_id = ?")
    .run(poiId, videoId);
  return result.changes > 0;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info("Database closed");
  }
}

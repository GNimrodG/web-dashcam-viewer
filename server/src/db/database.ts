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
  return db
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
}

export function getVideoPoiCount(videoId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM video_pois WHERE video_id = ?")
    .get(videoId) as { count: number };
  return row.count;
}

export function getVideoPoiCounts(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT video_id as videoId, COUNT(*) as count
       FROM video_pois
       GROUP BY video_id`,
    )
    .all() as Array<{ videoId: string; count: number }>;
  return new Map(rows.map((row) => [row.videoId, row.count]));
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

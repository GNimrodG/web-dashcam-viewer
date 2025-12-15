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

export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info("Database closed");
  }
}

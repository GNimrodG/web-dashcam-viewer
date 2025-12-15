import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadConfig } from "./config.js";
const config = loadConfig();

import { logger } from "./logger.js";

import express from "express";
import session from "express-session";
import pinoHttp from "pino-http";
import cors from "cors";
import { buildIndex, watchMediaFolder } from "./services/indexer.js";
import videosRouter from "./routes/videos.js";
import authRouter from "./routes/auth.js";
import sharesRouter from "./routes/shares.js";
import { processManager } from "./utils/process-manager.js";
import { initDatabase, closeDatabase } from "./db/database.js";
import { initOIDC, requireAuth, optionalAuth } from "./middleware/auth.js";
import { cleanupOrphanedThumbnails } from "./services/thumbnail.js";

logger.info("Starting server...");

// Initialize database
initDatabase(config.MEDIA_DIR);

// Clean up orphaned thumbnails
const clipsDir = path.join(config.MEDIA_DIR, "clips");
if (fs.existsSync(clipsDir)) {
  cleanupOrphanedThumbnails(clipsDir);
}

// Initialize OIDC if auth is enabled
if (config.AUTH_ENABLED) {
  try {
    await initOIDC(
      config.AUTHENTIK_ISSUER,
      config.AUTHENTIK_CLIENT_ID,
      config.AUTHENTIK_CLIENT_SECRET,
      config.AUTHENTIK_REDIRECT_URI,
    );
    logger.info("Authentication enabled");
  } catch (error) {
    logger.error({ error }, "Failed to initialize authentication");
    process.exit(1);
  }
}

// Handle graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal");
  processManager.killAll();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const app = express();

// Trust proxy (required when behind nginx/reverse proxy)
app.set("trust proxy", 1);

// Session middleware (required for OIDC)
// Note: Using default MemoryStore is acceptable for this single-user dashcam viewer
// For multi-user/multi-instance deployments, consider using connect-redis or similar
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "lax", // Allow cookies on redirects from OAuth provider
    },
    // Explicitly create a new MemoryStore to suppress the warning
    store: new session.MemoryStore(),
  }),
);

app.use(
  pinoHttp({
    logger,
    customLogLevel: function (_req, res, err) {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "silent";
    },
  }),
);
app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true, // Allow cookies for sessions
  }),
);

// Healthcheck
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Initialize index
await buildIndex(config.MEDIA_DIR);
watchMediaFolder(config.MEDIA_DIR);

// Auth routes (always available, but only functional if AUTH_ENABLED)
if (config.AUTH_ENABLED) {
  app.use("/api/auth", authRouter);
}

// Public share routes (no auth required)
app.use("/api/shares", sharesRouter);

// API routes (protected if AUTH_ENABLED)
const videoAuthMiddleware = config.AUTH_ENABLED ? requireAuth : optionalAuth;
app.use("/api/videos", videoAuthMiddleware, videosRouter);

// Serve frontend build if enabled
if (config.SERVE_WEB) {
  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      mediaDir: config.MEDIA_DIR,
      authEnabled: config.AUTH_ENABLED,
    },
    "Server listening",
  );
});

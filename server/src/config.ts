import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { getDashcamTimeZone } from "./utils/dashcam-time.js";

export function loadConfig() {
  const MEDIA_DIR = process.env.MEDIA_DIR
    ? path.resolve(process.env.MEDIA_DIR)
    : "";
  if (!MEDIA_DIR || !fs.existsSync(MEDIA_DIR)) {
    console.warn(
      "MEDIA_DIR is not set or does not exist. Set MEDIA_DIR in .env",
    );
  }

  const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

  // Authentik OIDC configuration
  const AUTHENTIK_ISSUER = process.env.AUTHENTIK_ISSUER || "";
  const AUTHENTIK_CLIENT_ID = process.env.AUTHENTIK_CLIENT_ID || "";
  const AUTHENTIK_CLIENT_SECRET = process.env.AUTHENTIK_CLIENT_SECRET || "";
  const AUTHENTIK_REDIRECT_URI = process.env.AUTHENTIK_REDIRECT_URI || "";
  const SESSION_SECRET =
    process.env.SESSION_SECRET || "change-me-in-production";
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
  const DASHCAM_TIME_ZONE = getDashcamTimeZone();

  if (AUTH_ENABLED) {
    if (
      !AUTHENTIK_ISSUER ||
      !AUTHENTIK_CLIENT_ID ||
      !AUTHENTIK_CLIENT_SECRET ||
      !AUTHENTIK_REDIRECT_URI
    ) {
      console.error(
        "AUTH_ENABLED is true but Authentik configuration is incomplete!",
      );
      console.error(
        "Required: AUTHENTIK_ISSUER, AUTHENTIK_CLIENT_ID, AUTHENTIK_CLIENT_SECRET, AUTHENTIK_REDIRECT_URI",
      );
    }
    if (SESSION_SECRET === "change-me-in-production") {
      console.warn(
        "Warning: Using default SESSION_SECRET. Please set a secure random value!",
      );
    }
  }

  return {
    MEDIA_DIR,
    PORT: Number(process.env.PORT || 5174),
    SERVE_WEB: process.env.SERVE_WEB === "true",
    AUTH_ENABLED,
    AUTHENTIK_ISSUER,
    AUTHENTIK_CLIENT_ID,
    AUTHENTIK_CLIENT_SECRET,
    AUTHENTIK_REDIRECT_URI,
    SESSION_SECRET,
    FRONTEND_URL,
    DASHCAM_TIME_ZONE,
  };
}

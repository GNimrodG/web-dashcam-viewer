import express from "express";
import {
  getAuthorizationUrl,
  handleCallback,
  logout,
  getCurrentUser,
} from "../middleware/auth.js";
import { logger } from "../logger.js";
import { loadConfig } from "../config.js";
import { sanitizeReturnPath } from "../utils/http.js";

const router = express.Router();
const config = loadConfig();

// Get current user
router.get("/me", (req, res) => {
  const user = getCurrentUser(req);
  res.json({ user, authEnabled: config.AUTH_ENABLED });
});

// Initiate login
router.get("/login", async (req, res) => {
  if (!config.AUTH_ENABLED) {
    return res.status(404).json({ error: "Authentication is disabled" });
  }
  try {
    // Store return URL with hash if provided
    const returnUrl = sanitizeReturnPath(req.query.returnUrl);
    if (returnUrl) {
      req.session.returnUrl = returnUrl;
    }

    const authUrl = await getAuthorizationUrl(req);
    res.redirect(authUrl);
  } catch (error) {
    logger.error({ error }, "Login failed");
    res.status(500).json({ error: "Failed to initiate login" });
  }
});

// Handle OAuth callback
router.get("/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    await handleCallback(req, code);

    // Restore return URL if it was saved
    const returnUrl = req.session.returnUrl;
    delete req.session.returnUrl;

    // Redirect to frontend (with hash if provided)
    const redirectUrl = returnUrl
      ? new URL(returnUrl, config.FRONTEND_URL).href
      : config.FRONTEND_URL;
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error({ error }, "OAuth callback failed");
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Logout
router.post("/logout", (req, res) => {
  logout(req, res);
});

export default router;

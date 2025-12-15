import express from "express";
import {
  getAuthorizationUrl,
  handleCallback,
  logout,
  getCurrentUser,
} from "../middleware/auth.js";
import { logger } from "../logger.js";
import { loadConfig } from "../config.js";

const router = express.Router();
const config = loadConfig();

// Get current user
router.get("/me", (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user });
});

// Initiate login
router.get("/login", async (req, res) => {
  try {
    // Store return URL with hash if provided
    const returnUrl = req.query.returnUrl as string | undefined;
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
    const redirectUrl = returnUrl || config.FRONTEND_URL;
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

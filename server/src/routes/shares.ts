import express from "express";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import {
  createShareToken,
  getShareToken,
  deleteShareToken,
  getTokensForVideo,
} from "../db/database.js";
import { requireAuth, getCurrentUser } from "../middleware/auth.js";
import { logger } from "../logger.js";
import { createClip } from "../services/clipper.js";
import { loadConfig } from "../config.js";
import { getVideoPairById } from "../services/indexer.js";

const config = loadConfig();
const router = express.Router();

// Create a share token for a clip
router.post("/", requireAuth, async (req, res) => {
  try {
    const { videoId, clipStartTime, clipEndTime, clipChannels, expiresInDays } =
      req.body;

    if (
      !videoId ||
      clipStartTime === undefined ||
      clipEndTime === undefined ||
      !clipChannels
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const tokenId = nanoid(16);
    const user = getCurrentUser(req);

    let expiresAt: number | null = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    }

    createShareToken({
      id: tokenId,
      videoId,
      clipStartTime,
      clipEndTime,
      clipChannels,
      createdAt: Date.now(),
      expiresAt,
      createdBy: user?.sub || null,
    });

    const shareUrl = `${req.protocol}://${req.get("host")}/share/${tokenId}`;

    res.json({
      tokenId,
      shareUrl,
      expiresAt,
    });
  } catch (error) {
    logger.error({ error }, "Failed to create share token");
    res.status(500).json({ error: "Failed to create share token" });
  }
});

// Get share token details (public endpoint)
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const token = getShareToken(tokenId);

    if (!token) {
      return res
        .status(404)
        .json({ error: "Share token not found or expired" });
    }

    // Get video pair from index
    const pair = getVideoPairById(token.videoId);

    if (!pair) {
      return res.status(404).json({ error: "Video not found" });
    }

    const frontPath = pair.channels.front?.path || null;
    const rearPath = pair.channels.rear?.path || null;

    // Generate output filename
    const outputFilename = `share_${tokenId}.mp4`;
    const outputPath = path.join(config.MEDIA_DIR, "clips", outputFilename);

    // Ensure clips directory exists
    const clipsDir = path.dirname(outputPath);
    if (!fs.existsSync(clipsDir)) {
      fs.mkdirSync(clipsDir, { recursive: true });
    }

    // Check if clip already exists
    if (!fs.existsSync(outputPath)) {
      // Create the clip
      await createClip(frontPath, rearPath, {
        startTime: token.clipStartTime,
        endTime: token.clipEndTime,
        channels: token.clipChannels as
          | "front"
          | "rear"
          | "both-stacked"
          | "both-side-by-side",
        outputPath,
        audioVolume: 1,
      });
    }

    res.json({
      videoId: token.videoId,
      clipStartTime: token.clipStartTime,
      clipEndTime: token.clipEndTime,
      clipChannels: token.clipChannels,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      downloadUrl: `/api/videos/clips/${outputFilename}`,
      filename: outputFilename,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get share token");
    res.status(500).json({ error: "Failed to get share token" });
  }
});

// Download clip using share token (public endpoint) - just redirects to the clip file
router.get("/:tokenId/download", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const token = getShareToken(tokenId);

    if (!token) {
      return res
        .status(404)
        .json({ error: "Share token not found or expired" });
    }

    const outputFilename = `share_${tokenId}.mp4`;
    res.redirect(`/api/videos/clips/${outputFilename}`);
  } catch (error) {
    logger.error({ error }, "Failed to download shared clip");
    res.status(500).json({ error: "Failed to download shared clip" });
  }
});

// List share tokens for a video (authenticated)
router.get("/video/:videoId", requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const tokens = getTokensForVideo(videoId);

    res.json({ tokens });
  } catch (error) {
    logger.error({ error }, "Failed to list share tokens");
    res.status(500).json({ error: "Failed to list share tokens" });
  }
});

// Delete a share token (authenticated)
router.delete("/:tokenId", requireAuth, async (req, res) => {
  try {
    const { tokenId } = req.params;
    deleteShareToken(tokenId);

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to delete share token");
    res.status(500).json({ error: "Failed to delete share token" });
  }
});

export default router;

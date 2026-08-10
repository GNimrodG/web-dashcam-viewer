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
import {
  requireAuth,
  optionalAuth,
  getCurrentUser,
} from "../middleware/auth.js";
import { logger } from "../logger.js";
import { createClip } from "../services/clipper.js";
import { loadConfig } from "../config.js";
import { getVideoPairById } from "../services/indexer.js";
import { ffprobe } from "../services/ffprobe.js";
import { isSafeClipFilename } from "../utils/http.js";

const config = loadConfig();
const router = express.Router();
const manageShares = config.AUTH_ENABLED ? requireAuth : optionalAuth;
const generatedClipPrefix = "generated:";

const validChannels = new Set([
  "front",
  "rear",
  "both-stacked",
  "both-side-by-side",
]);

function getSharedClipPaths(tokenId: string) {
  const outputFilename = `share_${tokenId}.mp4`;
  const clipsDir = path.join(config.MEDIA_DIR, "clips");
  return {
    outputFilename,
    outputPath: path.join(clipsDir, outputFilename),
    clipsDir,
  };
}

async function ensureSharedClip(
  token: NonNullable<ReturnType<typeof getShareToken>>,
) {
  if (token.videoId.startsWith(generatedClipPrefix)) {
    const outputFilename = token.videoId.slice(generatedClipPrefix.length);
    if (!isSafeClipFilename(outputFilename))
      throw new Error("Invalid shared clip");
    const clipsDir = path.join(config.MEDIA_DIR, "clips");
    const outputPath = path.join(clipsDir, outputFilename);
    if (!fs.existsSync(outputPath)) throw new Error("Shared clip not found");
    return { outputFilename, outputPath, clipsDir };
  }

  const pair = getVideoPairById(token.videoId);
  if (!pair) throw new Error("Video not found");

  const paths = getSharedClipPaths(token.id);
  fs.mkdirSync(paths.clipsDir, { recursive: true });
  if (!fs.existsSync(paths.outputPath)) {
    await createClip(
      pair.channels.front?.path || null,
      pair.channels.rear?.path || null,
      {
        startTime: token.clipStartTime,
        endTime: token.clipEndTime,
        channels: token.clipChannels as
          | "front"
          | "rear"
          | "both-stacked"
          | "both-side-by-side",
        outputPath: paths.outputPath,
        audioVolume: 1,
      },
    );
  }
  return paths;
}

router.post("/clip", manageShares, async (req, res) => {
  try {
    const { filename, expiresInDays = 7 } = req.body;
    if (
      !isSafeClipFilename(filename) ||
      !Number.isFinite(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > 365
    ) {
      return res.status(400).json({ error: "Invalid clip share options" });
    }

    const filePath = path.join(config.MEDIA_DIR, "clips", filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Clip not found" });
    }

    let duration = 0;
    try {
      duration =
        Number.parseFloat((await ffprobe(filePath)).format.duration) || 0;
    } catch {
      // The clip remains shareable even if metadata probing is unavailable.
    }

    const tokenId = nanoid(16);
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    createShareToken({
      id: tokenId,
      videoId: `${generatedClipPrefix}${filename}`,
      clipStartTime: 0,
      clipEndTime: duration,
      clipChannels: "generated",
      createdAt: Date.now(),
      expiresAt,
      createdBy: getCurrentUser(req)?.sub || null,
    });

    res.json({
      tokenId,
      shareUrl: `${req.protocol}://${req.get("host")}/share/${tokenId}`,
      expiresAt,
    });
  } catch (error) {
    logger.error({ error }, "Failed to share generated clip");
    res.status(500).json({ error: "Failed to share generated clip" });
  }
});

// Create a share token for a clip
router.post("/", manageShares, async (req, res) => {
  try {
    const { videoId, clipStartTime, clipEndTime, clipChannels, expiresInDays } =
      req.body;

    const pair = typeof videoId === "string" ? getVideoPairById(videoId) : null;
    if (!pair) {
      return res.status(404).json({ error: "Video not found" });
    }
    if (
      !Number.isFinite(clipStartTime) ||
      !Number.isFinite(clipEndTime) ||
      clipStartTime < 0 ||
      clipEndTime <= clipStartTime ||
      clipEndTime > (pair.durationSec || Number.POSITIVE_INFINITY) ||
      !validChannels.has(clipChannels) ||
      (expiresInDays !== undefined &&
        (!Number.isFinite(expiresInDays) ||
          expiresInDays < 1 ||
          expiresInDays > 365))
    ) {
      return res.status(400).json({ error: "Invalid share options" });
    }
    if (
      (clipChannels === "front" && !pair.channels.front) ||
      (clipChannels === "rear" && !pair.channels.rear) ||
      ((clipChannels === "both-stacked" ||
        clipChannels === "both-side-by-side") &&
        (!pair.channels.front || !pair.channels.rear))
    ) {
      return res
        .status(400)
        .json({ error: "Requested channels are unavailable" });
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

    if (
      !token.videoId.startsWith(generatedClipPrefix) &&
      !getVideoPairById(token.videoId)
    ) {
      return res.status(404).json({ error: "Video not found" });
    }
    const { outputFilename } = token.videoId.startsWith(generatedClipPrefix)
      ? await ensureSharedClip(token)
      : getSharedClipPaths(tokenId);

    res.json({
      videoId: token.videoId.startsWith(generatedClipPrefix)
        ? outputFilename
        : token.videoId,
      clipStartTime: token.clipStartTime,
      clipEndTime: token.clipEndTime,
      clipChannels: token.clipChannels,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      downloadUrl: `/api/shares/${tokenId}/download`,
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

    const { outputFilename, outputPath } = await ensureSharedClip(token);
    res.download(outputPath, outputFilename);
  } catch (error) {
    logger.error({ error }, "Failed to download shared clip");
    res.status(500).json({ error: "Failed to download shared clip" });
  }
});

// List share tokens for a video (authenticated)
router.get("/video/:videoId", manageShares, async (req, res) => {
  try {
    const { videoId } = req.params;
    const tokens = getTokensForVideo(videoId as string);

    res.json({ tokens });
  } catch (error) {
    logger.error({ error }, "Failed to list share tokens");
    res.status(500).json({ error: "Failed to list share tokens" });
  }
});

// Delete a share token (authenticated)
router.delete("/:tokenId", manageShares, async (req, res) => {
  try {
    const { tokenId } = req.params;
    deleteShareToken(tokenId as string);

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to delete share token");
    res.status(500).json({ error: "Failed to delete share token" });
  }
});

export default router;

import { Router, text } from "express";
import {
  getVideoPairs,
  getVideoPairById,
  getGpsTrackForPair,
  streamVideo,
  backfillLocationNames,
  buildIndex,
  getGpsExtractionQueueStatus,
  updatePairLocation,
  getAllUniqueLocations,
  registerStoredGpsForPair,
} from "../services/indexer.js";
import { createClip } from "../services/clipper.js";
import { generateGPX } from "../services/gpx.js";
import { saveRecordedGpxTrack } from "../services/gps.js";
import { ensureThumbnail, getThumbnailPath } from "../services/thumbnail.js";
import { ffprobe } from "../services/ffprobe.js";
import { loadConfig } from "../config.js";
import path from "node:path";
import fs from "node:fs";
import { isSafeClipFilename } from "../utils/http.js";
import {
  buildStoredGpxDocument,
  cropAbsoluteGpxPoints,
  parseAbsoluteGpxPoints,
} from "../utils/gpx.js";
import {
  getGpsMapCatalog,
  invalidateGpsMapCatalog,
} from "../services/gps-map.js";
import {
  createVideoPoi,
  deleteVideoPoi,
  getVideoPoiCount,
  getVideoPoiCounts,
  getVideoPois,
} from "../db/database.js";
import { randomUUID } from "node:crypto";

const config = loadConfig();

function getAny(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) return (obj as any)[key];
  return undefined;
}
import type { Channel } from "../types.js";

const router = Router();

// List pairs
router.get("/", (_req, res) => {
  const pairs = getVideoPairs();
  const poiCounts = getVideoPoiCounts();
  res.json(
    pairs.map((pair) => ({
      ...pair,
      poiCount: poiCounts.get(pair.id) ?? 0,
    })),
  );
});

// Get unique locations for autocomplete
router.get("/locations", (_req, res) => {
  const locations = getAllUniqueLocations();
  res.json(locations);
});

// Update pair location manually
router.patch("/:id/location", (req, res) => {
  const { id } = req.params;
  const { startCity, startCountry, endCity, endCountry } = req.body;

  const success = updatePairLocation(id, {
    startCity,
    startCountry,
    endCity,
    endCountry,
  });

  if (!success) {
    return res.status(404).json({ error: "Video pair not found" });
  }

  const updatedPair = getVideoPairById(id);
  res.json(
    updatedPair
      ? { ...updatedPair, poiCount: getVideoPoiCount(updatedPair.id) }
      : updatedPair,
  );
});

// Get GPS extraction queue status (Server-Sent Events)
router.get("/gps-queue-status", (_req, res) => {
  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable buffering in nginx

  // Send initial status immediately
  const sendStatus = () => {
    const status = getGpsExtractionQueueStatus();
    res.write(`data: ${JSON.stringify(status)}\n\n`);
  };

  sendStatus();

  // Send updates every 500ms
  const interval = setInterval(sendStatus, 500);

  // Clean up on client disconnect
  _req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

// Simplified GPS tracks for the all-recordings map. Extraction uses the same
// bounded queue and persistent caches as the individual recording map.
router.get("/gps-map", async (_req, res) => {
  try {
    res.json(await getGpsMapCatalog(config.MEDIA_DIR));
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Failed to build GPS map catalog",
    });
  }
});

router.get("/:id/pois", (req, res) => {
  const pair = getVideoPairById(req.params.id);
  if (!pair) return res.status(404).json({ error: "Video pair not found" });
  res.json(getVideoPois(pair.id));
});

router.post("/:id/pois", (req, res) => {
  const pair = getVideoPairById(req.params.id);
  if (!pair) return res.status(404).json({ error: "Video pair not found" });

  const timeSec = getAny(req.body, "timeSec");
  const requestedLabel = getAny(req.body, "label");
  if (typeof timeSec !== "number" || !Number.isFinite(timeSec) || timeSec < 0) {
    return res.status(400).json({ error: "A valid POI time is required" });
  }
  if (pair.durationSec !== undefined && timeSec > pair.durationSec) {
    return res.status(400).json({ error: "POI time exceeds video duration" });
  }
  if (typeof requestedLabel !== "string" || !requestedLabel.trim()) {
    return res.status(400).json({ error: "A POI label is required" });
  }

  const label = requestedLabel.trim();
  if (label.length > 120) {
    return res.status(400).json({ error: "POI label is too long" });
  }

  const poi = {
    id: randomUUID(),
    videoId: pair.id,
    timeSec,
    label,
    createdAt: Date.now(),
  };
  createVideoPoi(poi);
  res.status(201).json(poi);
});

router.delete("/:id/pois/:poiId", (req, res) => {
  const pair = getVideoPairById(req.params.id);
  if (!pair) return res.status(404).json({ error: "Video pair not found" });
  if (!deleteVideoPoi(pair.id, req.params.poiId)) {
    return res.status(404).json({ error: "POI not found" });
  }
  res.status(204).end();
});

// List all clips
router.get("/clips", async (_req, res) => {
  const clipsDir = path.join(config.MEDIA_DIR, "clips");

  if (!fs.existsSync(clipsDir)) {
    return res.json({ clips: [] });
  }

  try {
    const files = fs.readdirSync(clipsDir);
    const clipsPromises = files
      .filter((f) => f.endsWith(".mp4"))
      .map(async (filename) => {
        const filePath = path.join(clipsDir, filename);
        try {
          const stats = fs.statSync(filePath);

          // Get video metadata (duration and resolution)
          let duration: number | undefined;
          let width: number | undefined;
          let height: number | undefined;
          try {
            const probe = await ffprobe(filePath);
            duration = Number.parseFloat(probe.format.duration);
            if (!Number.isFinite(duration)) duration = undefined;

            const videoStream = probe.streams.find(
              (s: any) => s.codec_type === "video",
            );
            if (videoStream) {
              width = Number(videoStream.width);
              height = Number(videoStream.height);
              if (!Number.isFinite(width)) width = undefined;
              if (!Number.isFinite(height)) height = undefined;
            }
          } catch (err) {
            console.warn(`Failed to probe ${filename}:`, err);
          }

          // Generate thumbnail in background (don't wait for it)
          const encodedFilename = encodeURIComponent(filename);
          let thumbnailUrl = `/api/videos/clips/${encodedFilename}/thumbnail`;
          ensureThumbnail(filePath, filename, clipsDir).catch((err) => {
            console.warn(`Thumbnail generation failed for ${filename}:`, err);
          });

          return {
            filename,
            url: `/api/videos/clips/${encodedFilename}`,
            thumbnailUrl,
            size: stats.size,
            duration,
            width,
            height,
            createdAt: stats.birthtime.toISOString(),
          };
        } catch (err) {
          // File might have been deleted or inaccessible, skip it
          console.warn(`Skipping inaccessible file: ${filename}`, err);
          return null;
        }
      });

    const clips = (await Promise.all(clipsPromises)).filter(
      (clip): clip is NonNullable<typeof clip> => clip !== null,
    );

    res.json({ clips });
  } catch (err: any) {
    console.error("Failed to list clips:", err);
    res.status(500).json({ error: "Failed to list clips" });
  }
});

// Get thumbnail for a clip
router.get("/clips/:filename/thumbnail", async (req, res) => {
  const filename = req.params.filename;
  if (!isSafeClipFilename(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const clipsDir = path.join(config.MEDIA_DIR, "clips");
  const filePath = path.join(clipsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Clip not found" });
  }

  try {
    const thumbnailPath = await ensureThumbnail(filePath, filename, clipsDir);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(thumbnailPath);
  } catch (err: any) {
    console.error("Failed to generate thumbnail:", err);
    res.status(500).json({ error: "Failed to generate thumbnail" });
  }
});

// Stream a generated clip (with range support)
router.get("/clips/:filename", (req, res) => {
  const filename = req.params.filename;
  if (!isSafeClipFilename(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const filePath = path.join(config.MEDIA_DIR, "clips", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Clip not found" });
  }

  // Use streamVideo for range request support
  streamVideo(req, res, filePath);
});

// Rename a clip
router.patch("/clips/:filename", (req, res) => {
  const oldFilename = req.params.filename;
  const newFilename = getAny(req.body, "newFilename") as string | undefined;

  if (!isSafeClipFilename(oldFilename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  if (!newFilename || typeof newFilename !== "string") {
    return res.status(400).json({ error: "New filename is required" });
  }

  // Validate filename (must end with .mp4, no path traversal)
  if (!isSafeClipFilename(newFilename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  const clipsDir = path.join(config.MEDIA_DIR, "clips");
  const oldPath = path.join(clipsDir, oldFilename);
  const newPath = path.join(clipsDir, newFilename);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: "Clip not found" });
  }

  if (fs.existsSync(newPath)) {
    return res
      .status(409)
      .json({ error: "A clip with that name already exists" });
  }

  try {
    fs.renameSync(oldPath, newPath);

    // Also rename thumbnail if it exists
    const oldThumbnailPath = getThumbnailPath(oldFilename, clipsDir);
    const newThumbnailPath = getThumbnailPath(newFilename, clipsDir);
    if (fs.existsSync(oldThumbnailPath)) {
      try {
        fs.renameSync(oldThumbnailPath, newThumbnailPath);
      } catch (err) {
        console.warn("Failed to rename thumbnail:", err);
      }
    }

    res.json({ success: true, message: "Clip renamed", newFilename });
  } catch (err: any) {
    console.error("Failed to rename clip:", err);
    res.status(500).json({ error: "Failed to rename clip" });
  }
});

// Delete a clip
router.delete("/clips/:filename", (req, res) => {
  const filename = req.params.filename;
  if (!isSafeClipFilename(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const clipsDir = path.join(config.MEDIA_DIR, "clips");
  const filePath = path.join(clipsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Clip not found" });
  }

  try {
    fs.unlinkSync(filePath);

    // Also delete thumbnail if it exists
    const thumbnailPath = getThumbnailPath(filename, clipsDir);
    if (fs.existsSync(thumbnailPath)) {
      try {
        fs.unlinkSync(thumbnailPath);
      } catch (err) {
        console.warn("Failed to delete thumbnail:", err);
      }
    }

    res.json({ success: true, message: "Clip deleted" });
  } catch (err: any) {
    console.error("Failed to delete clip:", err);
    res.status(500).json({ error: "Failed to delete clip" });
  }
});

// Details for one pair
router.get("/:id", (req, res) => {
  const pair = getVideoPairById(req.params.id);
  if (!pair) return res.status(404).json({ error: "Not found" });
  res.json({ ...pair, poiCount: getVideoPoiCount(pair.id) });
});

// Stream a specific channel
router.get("/:id/source/:channel", (req, res) => {
  const { id, channel } = req.params;
  if (channel !== "front" && channel !== "rear") {
    return res.status(400).json({ error: "Invalid channel" });
  }
  const pair = getVideoPairById(id);
  if (!pair) return res.status(404).json({ error: "Not found" });

  const file = pair.channels[channel as Channel];
  if (!file) return res.status(404).json({ error: "Channel not found" });

  // Delegate to stream helper for range support
  streamVideo(req, res, file.path);
});

// GPS track
router.get("/:id/gps", async (req, res) => {
  try {
    const data = await getGpsTrackForPair(req.params.id);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to extract GPS" });
  }
});

// Download GPS track as GPX
router.get("/:id/gps/gpx", async (req, res) => {
  try {
    const pair = getVideoPairById(req.params.id);
    if (!pair) {
      return res.status(404).json({ error: "Video pair not found" });
    }

    const data = await getGpsTrackForPair(req.params.id);
    if (!data || (!data.front?.length && !data.rear?.length)) {
      return res.status(404).json({ error: "No GPS data available" });
    }

    // Use front camera GPS if available, otherwise rear
    const points = data.front || data.rear || [];
    const channel = data.front ? "front" : "rear";

    const gpxContent = generateGPX(
      points,
      `Dashcam ${req.params.id} (${channel})`,
      `GPS track from ${channel} camera`,
      pair.startTime, // Pass the recording start time for accurate timestamps
    );

    res.setHeader("Content-Type", "application/gpx+xml");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.id}_${channel}.gpx"`,
    );
    res.send(gpxContent);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to generate GPX" });
  }
});

router.post("/:id/gps/gpx", async (req, res) => {
  try {
    const pair = getVideoPairById(req.params.id);
    if (!pair) {
      return res.status(404).json({ error: "Video pair not found" });
    }

    const gpxXml = getAny(req.body, "gpxXml");
    if (typeof gpxXml !== "string" || !gpxXml.trim()) {
      return res.status(400).json({ error: "GPX XML is required" });
    }

    const filePath = saveRecordedGpxTrack(config.MEDIA_DIR, pair.id, gpxXml);
    registerStoredGpsForPair(pair.id);
    await invalidateGpsMapCatalog(config.MEDIA_DIR);
    await getGpsTrackForPair(pair.id);
    res.json({
      success: true,
      message: "GPX stored for recording",
      filePath,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to store GPX" });
  }
});

router.post(
  "/gps/gpx/bulk",
  text({
    type: ["application/gpx+xml", "application/xml", "text/xml"],
    limit: "100mb",
  }),
  async (req, res) => {
    try {
      if (typeof req.body !== "string" || !req.body.trim()) {
        return res.status(400).json({ error: "GPX XML is required" });
      }

      const points = parseAbsoluteGpxPoints(req.body);
      const pairs = getVideoPairs();
      const updatedIds: string[] = [];
      const failures: Array<{ id: string; error: string }> = [];
      let skipped = 0;

      for (const pair of pairs) {
        const startMs = pair.startTime
          ? Date.parse(pair.startTime)
          : Number.NaN;
        const durationSec = pair.durationSec;
        if (
          !Number.isFinite(startMs) ||
          !Number.isFinite(durationSec) ||
          !durationSec ||
          durationSec <= 0
        ) {
          skipped++;
          continue;
        }

        const cropped = cropAbsoluteGpxPoints(
          points,
          startMs,
          startMs + durationSec * 1000,
        );
        if (!cropped.length) {
          skipped++;
          continue;
        }

        try {
          const output = buildStoredGpxDocument(
            cropped,
            `${pair.id} GPS`,
            "Automatically cropped from bulk GPX upload",
          );
          saveRecordedGpxTrack(config.MEDIA_DIR, pair.id, output);
          registerStoredGpsForPair(pair.id);
          updatedIds.push(pair.id);
        } catch (error: any) {
          failures.push({
            id: pair.id,
            error: error?.message || "Failed to store GPX",
          });
        }
      }

      if (updatedIds.length) {
        await invalidateGpsMapCatalog(config.MEDIA_DIR);
      }

      res.json({
        success: failures.length === 0,
        totalPoints: points.length,
        totalRecordings: pairs.length,
        updated: updatedIds.length,
        skipped,
        failed: failures.length,
        updatedIds,
        failures,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error?.message || "Failed to process bulk GPX upload",
      });
    }
  },
);

// Admin: trigger location backfill (limit query param; limit<=0 => full)
router.post("/backfill/locations", async (req, res) => {
  const limitRaw = getAny(req.query, "limit") ?? getAny(req.body, "limit");
  let limit = Number(limitRaw);
  if (!Number.isFinite(limit)) limit = 20;
  try {
    const processed = await backfillLocationNames(limit);
    res.json({
      processed,
      limit,
      remaining: processed < limit || limit <= 0 ? undefined : "unknown",
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Backfill failed" });
  }
});

// Admin: trigger manual re-indexing
router.post("/reindex", async (_req, res) => {
  try {
    await buildIndex(config.MEDIA_DIR);
    const pairs = getVideoPairs();
    res.json({
      success: true,
      message: "Re-indexing completed",
      totalPairs: pairs.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Re-indexing failed" });
  }
});

// Create a clip from a video pair
router.post("/:id/clip", async (req, res) => {
  try {
    const pair = getVideoPairById(req.params.id);
    if (!pair) return res.status(404).json({ error: "Video pair not found" });

    const { startTime, endTime, channels, audioVolume } = req.body as {
      startTime: number;
      endTime: number;
      channels: "front" | "rear" | "both-stacked" | "both-side-by-side";
      audioVolume?: number;
    };

    const validChannels = [
      "front",
      "rear",
      "both-stacked",
      "both-side-by-side",
    ];
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime <= startTime ||
      endTime > (pair.durationSec || Number.POSITIVE_INFINITY) ||
      !validChannels.includes(channels) ||
      (audioVolume !== undefined &&
        (!Number.isFinite(audioVolume) || audioVolume < 0 || audioVolume > 1))
    ) {
      return res.status(400).json({ error: "Invalid clip options" });
    }

    const frontPath = pair.channels.front?.path || null;
    const rearPath = pair.channels.rear?.path || null;

    // Validate channel selection
    if (channels === "front" && !frontPath) {
      return res.status(400).json({ error: "Front channel not available" });
    }
    if (channels === "rear" && !rearPath) {
      return res.status(400).json({ error: "Rear channel not available" });
    }
    if (
      (channels === "both-stacked" || channels === "both-side-by-side") &&
      (!frontPath || !rearPath)
    ) {
      return res.status(400).json({ error: "Both channels not available" });
    }

    // Generate output filename
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const outputFilename = `clip_${req.params.id}_${timestamp}.mp4`;
    const outputPath = path.join(config.MEDIA_DIR, "clips", outputFilename);

    // Ensure clips directory exists
    const clipsDir = path.dirname(outputPath);
    if (!fs.existsSync(clipsDir)) {
      fs.mkdirSync(clipsDir, { recursive: true });
    }

    // Create clip and wait for completion
    await createClip(frontPath, rearPath, {
      startTime,
      endTime,
      channels,
      outputPath,
      audioVolume,
    });

    res.json({
      success: true,
      message: "Clip generated successfully",
      filename: outputFilename,
      downloadUrl: `/api/videos/clips/${outputFilename}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Clip creation failed" });
  }
});

export default router;

import { execa } from "execa";
import { processManager } from "../utils/process-manager.js";
import path from "node:path";
import fs from "node:fs";
import { ffprobe } from "./ffprobe.js";

export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timePercent: number = 0.1,
): Promise<void> {
  // Get video duration
  const probeResult = await ffprobe(videoPath);
  const duration = Number.parseFloat(probeResult.format.duration);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  // Calculate timestamp (10% of duration)
  const timestamp = duration * timePercent;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate thumbnail using ffmpeg
  const proc = execa("ffmpeg", [
    "-ss",
    timestamp.toString(),
    "-i",
    videoPath,
    "-vframes",
    "1",
    "-vf",
    "scale=320:-1", // Width 320px, maintain aspect ratio
    "-q:v",
    "2", // High quality
    "-y", // Overwrite output file
    outputPath,
  ]);

  processManager.register(proc);
  await proc;
}

export function getThumbnailPath(
  videoFilename: string,
  clipsDir: string,
): string {
  const thumbnailFilename = videoFilename.replace(/\.mp4$/, ".jpg");
  return path.join(clipsDir, ".thumbnails", thumbnailFilename);
}

export async function ensureThumbnail(
  videoPath: string,
  videoFilename: string,
  clipsDir: string,
): Promise<string> {
  const thumbnailPath = getThumbnailPath(videoFilename, clipsDir);

  // Generate thumbnail if it doesn't exist
  if (!fs.existsSync(thumbnailPath)) {
    try {
      await generateThumbnail(videoPath, thumbnailPath);
    } catch (err) {
      console.error(`Failed to generate thumbnail for ${videoFilename}:`, err);
      throw err;
    }
  }

  return thumbnailPath;
}

export function cleanupOrphanedThumbnails(clipsDir: string): void {
  const thumbnailsDir = path.join(clipsDir, ".thumbnails");

  if (!fs.existsSync(thumbnailsDir)) {
    return;
  }

  try {
    // Get all video files in clips directory
    const videoFiles = new Set(
      fs
        .readdirSync(clipsDir)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => f.replace(/\.mp4$/, ".jpg")),
    );

    // Get all thumbnail files
    const thumbnailFiles = fs
      .readdirSync(thumbnailsDir)
      .filter((f) => f.endsWith(".jpg"));

    // Delete orphaned thumbnails
    let deletedCount = 0;
    for (const thumbnailFile of thumbnailFiles) {
      if (!videoFiles.has(thumbnailFile)) {
        const thumbnailPath = path.join(thumbnailsDir, thumbnailFile);
        try {
          fs.unlinkSync(thumbnailPath);
          deletedCount++;
          console.log(`Deleted orphaned thumbnail: ${thumbnailFile}`);
        } catch (err) {
          console.warn(
            `Failed to delete orphaned thumbnail ${thumbnailFile}:`,
            err,
          );
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} orphaned thumbnail(s)`);
    }
  } catch (err) {
    console.error("Failed to cleanup orphaned thumbnails:", err);
  }
}

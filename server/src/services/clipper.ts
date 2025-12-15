import { spawn } from "node:child_process";
import { logger } from "../logger.js";

export interface ClipOptions {
  startTime: number; // seconds
  endTime: number; // seconds
  channels: "front" | "rear" | "both-stacked" | "both-side-by-side";
  outputPath: string;
  audioVolume?: number; // 0-1 (0 = mute, 0.5 = half, 1 = original)
}

/**
 * Create a video clip using ffmpeg
 */
export async function createClip(
  frontPath: string | null,
  rearPath: string | null,
  options: ClipOptions,
): Promise<void> {
  const { startTime, endTime, channels, outputPath, audioVolume = 1 } = options;
  const duration = endTime - startTime;

  if (duration <= 0) {
    throw new Error("End time must be after start time");
  }

  const args: string[] = [];

  // Input files with start time and duration
  if (channels === "front" && frontPath) {
    args.push(
      "-ss",
      startTime.toString(),
      "-t",
      duration.toString(),
      "-i",
      frontPath,
    );
  } else if (channels === "rear" && rearPath) {
    args.push(
      "-ss",
      startTime.toString(),
      "-t",
      duration.toString(),
      "-i",
      rearPath,
    );
  } else if (
    (channels === "both-stacked" || channels === "both-side-by-side") &&
    frontPath &&
    rearPath
  ) {
    // Both channels
    args.push(
      "-ss",
      startTime.toString(),
      "-t",
      duration.toString(),
      "-i",
      frontPath,
      "-ss",
      startTime.toString(),
      "-t",
      duration.toString(),
      "-i",
      rearPath,
    );
  } else {
    throw new Error("Invalid channel configuration");
  }

  // Filter complex for combining videos
  if (channels === "both-stacked") {
    // Stack vertically: scale both to same width, preserve aspect ratio
    const volumeFilter =
      audioVolume === 0 ? "" : `;[0:a?]volume=${audioVolume}[a]`;
    const filterComplex = `[0:v]scale=1920:-2[v0];[1:v]scale=1920:-2[v1];[v0][v1]vstack=inputs=2[v]${volumeFilter}`;

    args.push("-filter_complex", filterComplex, "-map", "[v]");

    if (audioVolume > 0) {
      args.push("-map", "[a]");
    }
  } else if (channels === "both-side-by-side") {
    // Side by side: scale both to same height, preserve aspect ratio
    const volumeFilter =
      audioVolume === 0 ? "" : `;[0:a?]volume=${audioVolume}[a]`;
    const filterComplex = `[0:v]scale=-2:1080[v0];[1:v]scale=-2:1080[v1];[v0][v1]hstack=inputs=2[v]${volumeFilter}`;

    args.push("-filter_complex", filterComplex, "-map", "[v]");

    if (audioVolume > 0) {
      args.push("-map", "[a]");
    }
  } else {
    // Single channel - map video and optionally audio with volume
    args.push("-map", "0:v");

    if (audioVolume === 0) {
      // No audio
    } else if (audioVolume === 1) {
      // Original audio
      args.push("-map", "0:a?");
    } else {
      // Adjusted volume
      args.push("-filter:a", `volume=${audioVolume}`, "-map", "0:a?");
    }
  }

  // Output settings
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "23");

  // Audio codec (only if not muted)
  if (audioVolume > 0) {
    args.push("-c:a", "aac", "-b:a", "128k");
  }

  args.push("-y", outputPath); // Overwrite output

  logger.info({ args, outputPath }, "Starting ffmpeg clip generation");

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        logger.info({ outputPath }, "Clip generated successfully");
        resolve();
      } else {
        logger.error({ code, stderr }, "ffmpeg failed");
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      logger.error({ err }, "ffmpeg spawn error");
      reject(err);
    });
  });
}

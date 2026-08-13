import { spawn } from "node:child_process";
import fs from "node:fs";
import { logger } from "../logger.js";

export interface ClipProgress {
  percent: number;
  processedSeconds: number;
  durationSeconds: number;
  fps?: number;
  speed?: number;
  phase: "encoding" | "finalizing" | "completed";
}

export type ClipChannelMode =
  | "front"
  | "rear"
  | "both-stacked"
  | "both-side-by-side"
  | "front-pip-rear"
  | "rear-pip-front";

export type PipCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const DEFAULT_PIP_SIZE_PERCENT = 30;
export const MIN_PIP_SIZE_PERCENT = 10;
export const MAX_PIP_SIZE_PERCENT = 50;
export const DEFAULT_PIP_CORNER: PipCorner = "bottom-right";
const PIP_MARGIN_RATIO = 0.02;

export function isPictureInPictureMode(
  channels: ClipChannelMode,
): channels is "front-pip-rear" | "rear-pip-front" {
  return channels === "front-pip-rear" || channels === "rear-pip-front";
}

export function requiresBothChannels(channels: ClipChannelMode): boolean {
  return (
    channels === "both-stacked" ||
    channels === "both-side-by-side" ||
    isPictureInPictureMode(channels)
  );
}

function formatFilterNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export function buildPictureInPictureFilter(options: {
  channels: "front-pip-rear" | "rear-pip-front";
  pipSizePercent?: number;
  pipCorner?: PipCorner;
}): string {
  const {
    channels,
    pipSizePercent = DEFAULT_PIP_SIZE_PERCENT,
    pipCorner = DEFAULT_PIP_CORNER,
  } = options;
  const mainInput = channels === "front-pip-rear" ? 0 : 1;
  const smallInput = mainInput === 0 ? 1 : 0;
  const sizeRatio = formatFilterNumber(pipSizePercent / 100);
  const marginRatio = formatFilterNumber(PIP_MARGIN_RATIO);
  const margin = `trunc(main_w*${marginRatio})`;
  const x = pipCorner.endsWith("right") ? `main_w-overlay_w-${margin}` : margin;
  const y = pipCorner.startsWith("bottom")
    ? `main_h-overlay_h-${margin}`
    : margin;

  return `[${smallInput}:v][${mainInput}:v]scale2ref=w=trunc(main_w*${sizeRatio}/2)*2:h=-2[pip][base];[base][pip]overlay=x=${x}:y=${y}:shortest=1[v]`;
}

function addOptionalAudioMap(
  args: string[],
  inputIndex: number,
  audioVolume: number,
): void {
  if (audioVolume <= 0) return;
  args.push("-map", `${inputIndex}:a?`);
  if (audioVolume !== 1) {
    args.push("-filter:a", `volume=${audioVolume}`);
  }
}

export interface ClipOptions {
  startTime: number; // seconds
  endTime: number; // seconds
  channels: ClipChannelMode;
  outputPath: string;
  audioVolume?: number; // 0-1 (0 = mute, 0.5 = half, 1 = original)
  pipSizePercent?: number;
  pipCorner?: PipCorner;
  onProgress?: (progress: ClipProgress) => void;
}

export function buildClipProgress(
  values: Readonly<Record<string, string>>,
  durationSeconds: number,
): ClipProgress {
  const rawMicroseconds = Number(values.out_time_us ?? values.out_time_ms);
  const processedSeconds = Number.isFinite(rawMicroseconds)
    ? Math.max(0, Math.min(durationSeconds, rawMicroseconds / 1_000_000))
    : 0;
  const fps = Number(values.fps);
  const speed = Number(values.speed?.replace(/x$/i, ""));

  return {
    percent: Math.min(
      99,
      Math.max(0, (processedSeconds / durationSeconds) * 100),
    ),
    processedSeconds,
    durationSeconds,
    ...(Number.isFinite(fps) ? { fps } : {}),
    ...(Number.isFinite(speed) ? { speed } : {}),
    phase: values.progress === "end" ? "finalizing" : "encoding",
  };
}

/**
 * Create a video clip using ffmpeg
 */
export async function createClip(
  frontPath: string | null,
  rearPath: string | null,
  options: ClipOptions,
): Promise<void> {
  const {
    startTime,
    endTime,
    channels,
    outputPath,
    audioVolume = 1,
    pipSizePercent = DEFAULT_PIP_SIZE_PERCENT,
    pipCorner = DEFAULT_PIP_CORNER,
    onProgress,
  } = options;
  const duration = endTime - startTime;
  const partialOutputPath = `${outputPath}.partial`;

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
  } else if (requiresBothChannels(channels) && frontPath && rearPath) {
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
    const filterComplex = `[0:v]scale=1920:-2[v0];[1:v]scale=1920:-2[v1];[v0][v1]vstack=inputs=2[v]`;

    args.push("-filter_complex", filterComplex, "-map", "[v]");
    addOptionalAudioMap(args, 0, audioVolume);
  } else if (channels === "both-side-by-side") {
    // Side by side: scale both to same height, preserve aspect ratio
    const filterComplex = `[0:v]scale=-2:1080[v0];[1:v]scale=-2:1080[v1];[v0][v1]hstack=inputs=2[v]`;

    args.push("-filter_complex", filterComplex, "-map", "[v]");
    addOptionalAudioMap(args, 0, audioVolume);
  } else if (isPictureInPictureMode(channels)) {
    const filterComplex = buildPictureInPictureFilter({
      channels,
      pipSizePercent,
      pipCorner,
    });
    args.push("-filter_complex", filterComplex, "-map", "[v]");
    addOptionalAudioMap(
      args,
      channels === "front-pip-rear" ? 0 : 1,
      audioVolume,
    );
  } else {
    // Single channel - map video and optionally audio with volume
    args.push("-map", "0:v");
    addOptionalAudioMap(args, 0, audioVolume);
  }

  // Output settings
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "23");

  // Audio codec (only if not muted)
  if (audioVolume > 0) {
    args.push("-c:a", "aac", "-b:a", "128k");
  }

  args.push(
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    "mp4",
    "-y",
    partialOutputPath,
  );

  logger.info({ args, outputPath }, "Starting ffmpeg clip generation");

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";
    let progressBuffer = "";
    let progressValues: Record<string, string> = {};

    onProgress?.({
      percent: 0,
      processedSeconds: 0,
      durationSeconds: duration,
      phase: "encoding",
    });

    ffmpeg.stdout.on("data", (data) => {
      progressBuffer += data.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator);
        progressValues[key] = line.slice(separator + 1);
        if (key === "progress") {
          onProgress?.(buildClipProgress(progressValues, duration));
          progressValues = {};
        }
      }
    });

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        try {
          fs.renameSync(partialOutputPath, outputPath);
          onProgress?.({
            percent: 100,
            processedSeconds: duration,
            durationSeconds: duration,
            phase: "completed",
          });
          logger.info({ outputPath }, "Clip generated successfully");
          resolve();
        } catch (error) {
          logger.error({ error, outputPath }, "Failed to finalize clip");
          reject(error);
        }
      } else {
        fs.rmSync(partialOutputPath, { force: true });
        logger.error({ code, stderr }, "ffmpeg failed");
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      fs.rmSync(partialOutputPath, { force: true });
      logger.error({ err }, "ffmpeg spawn error");
      reject(err);
    });
  });
}

import fs from "node:fs";

export interface ClipMetadata {
  videoId: string;
  clipStartTime: number;
  clipEndTime: number;
  clipChannels: string;
  createdAt: number;
  clipStartAt: string | null;
  clipEndAt: string | null;
}

export function buildClipMetadata(options: {
  videoId: string;
  clipStartTime: number;
  clipEndTime: number;
  clipChannels: string;
  createdAt?: number;
  sourceStartTime?: string;
}): ClipMetadata {
  const startMs = options.sourceStartTime
    ? new Date(options.sourceStartTime).getTime()
    : Number.NaN;
  const hasValidSourceStart = Number.isFinite(startMs);

  return {
    videoId: options.videoId,
    clipStartTime: options.clipStartTime,
    clipEndTime: options.clipEndTime,
    clipChannels: options.clipChannels,
    createdAt: options.createdAt ?? Date.now(),
    clipStartAt: hasValidSourceStart
      ? new Date(startMs + options.clipStartTime * 1000).toISOString()
      : null,
    clipEndAt: hasValidSourceStart
      ? new Date(startMs + options.clipEndTime * 1000).toISOString()
      : null,
  };
}

export function getClipMetadataPath(outputPath: string): string {
  return `${outputPath}.meta.json`;
}

export function writeClipMetadata(
  outputPath: string,
  metadata: ClipMetadata,
): void {
  fs.writeFileSync(
    getClipMetadataPath(outputPath),
    JSON.stringify(metadata),
    "utf8",
  );
}

export function readClipMetadata(outputPath: string): ClipMetadata | null {
  try {
    const raw = fs.readFileSync(getClipMetadataPath(outputPath), "utf8");
    const parsed = JSON.parse(raw) as ClipMetadata;
    if (
      typeof parsed?.videoId !== "string" ||
      typeof parsed?.clipStartTime !== "number" ||
      typeof parsed?.clipEndTime !== "number" ||
      typeof parsed?.clipChannels !== "string"
    ) {
      return null;
    }

    return {
      ...parsed,
      clipStartAt:
        typeof parsed.clipStartAt === "string" ? parsed.clipStartAt : null,
      clipEndAt: typeof parsed.clipEndAt === "string" ? parsed.clipEndAt : null,
    };
  } catch {
    return null;
  }
}

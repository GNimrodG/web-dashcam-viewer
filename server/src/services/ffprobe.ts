import { execa } from "execa";
import { processManager } from "../utils/process-manager.js";

export interface FFProbeResult {
  streams: Array<any>;
  format: any;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getUsableVideoDuration(
  metadata: FFProbeResult,
): number | undefined {
  const videoStreams = metadata.streams.filter(
    (stream) => stream?.codec_type === "video",
  );
  if (!videoStreams.length) return undefined;

  const formatDuration = positiveNumber(metadata.format?.duration);
  if (formatDuration !== undefined) return formatDuration;

  const streamDurations = videoStreams
    .map((stream) => positiveNumber(stream?.duration))
    .filter((duration): duration is number => duration !== undefined);
  return streamDurations.length ? Math.max(...streamDurations) : undefined;
}

export async function ffprobe(filePath: string): Promise<FFProbeResult> {
  const proc = execa("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format:stream=index,codec_type,codec_name,duration,start_time,avg_frame_rate,width,height,codec_tag_string:stream_tags=creation_time,location,com.apple.quicktime.location.ISO6709",
    "-print_format",
    "json",
    filePath,
  ]);

  processManager.register(proc);
  const { stdout } = await proc;

  return JSON.parse(stdout);
}

export function parseISO6709(
  val?: string,
): { lat: number; lon: number; alt?: number } | undefined {
  if (!val) return undefined;
  // Example: +37.7749-122.4194+000.00/
  // Basic parse: sequence of signed numbers
  const match = new RegExp(
    /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/,
  ).exec(val);
  if (!match) return undefined;
  const lat = Number.parseFloat(match[1]);
  const lon = Number.parseFloat(match[2]);
  const alt = match[3] ? Number.parseFloat(match[3]) : undefined;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, alt };
  }
  return undefined;
}

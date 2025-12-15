import path from "node:path";
import type { Channel } from "../types.js";

export interface ParsedName {
  key: string; // timestamp-like key
  channel?: Channel;
  date?: string; // YYYYMMDD
  time?: string; // HHMMSS
}

/**
 * Attempt to parse Viofo-like filename and infer channel key.
 * Supported patterns (ext case-insensitive):
 *  - YYYY_MMDD_HHMMSS_{X}.mp4 (X is A/B/F/R/1/2)
 *  - YYYYMMDD_HHMMSS_{X}.mp4 (X is A/B/F/R/1/2)
 *  - YYYYMMDD_HHMMSS_front.mp4 / _rear.mp4
 */
export function parseFilenameForPairing(filePath: string): ParsedName {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();

  // 0) YYYY_MMDD_HHMMSS_{X}.mp4 where X is A/B/F/R/1/2
  // Example: 2025_0910_131727_F.MP4
  let m = RegExp(/^(\d{4})_(\d{4})_(\d{6})[_-]([abfr12])\.(mp4|mov)$/i).exec(
    lower,
  );
  if (m) {
    const year = m[1];
    const md = m[2]; // MMDD
    const time = m[3]; // HHMMSS
    const chToken = m[4];
    const date = `${year}${md}`; // YYYYMMDD
    const channel = mapTokenToChannel(chToken);
    return { key: `${date}_${time}`, channel, date, time };
  }

  // 1) YYYYMMDD_HHMMSS_{X}.mp4 where X is A/B/F/R/1/2
  m = RegExp(/^(\d{8})_(\d{6})[_-]([abfr12])\.(mp4|mov)$/i).exec(lower);
  if (m) {
    const date = m[1];
    const time = m[2];
    const chToken = m[3];
    const channel = mapTokenToChannel(chToken);
    return { key: `${date}_${time}`, channel, date, time };
  }

  // 2) YYYYMMDD_HHMMSS(_anything_)?(front|rear).mp4
  m = RegExp(/^(\d{8})_(\d{6})(?:_[^_]*)?_(front|rear)\.(mp4|mov)$/i).exec(
    lower,
  );
  if (m) {
    const date = m[1];
    const time = m[2];
    const chWord = m[3] as "front" | "rear";
    return { key: `${date}_${time}`, channel: chWord, date, time };
  }

  // 3) Fallback: detect "front"/"rear" anywhere and strip them to create a key
  if (lower.includes("front") || lower.includes("rear")) {
    const ch: Channel | undefined = lower.includes("front")
      ? "front"
      : lower.includes("rear")
        ? "rear"
        : undefined;
    const core = lower.replace(/front|rear/g, "").replace(/\.(mp4|mov)$/i, "");
    return { key: core, channel: ch };
  }

  // 4) Last resort: use filename without extension as key (unpaired)
  const core = lower.replace(/\.(mp4|mov)$/i, "");
  return { key: core };
}

function mapTokenToChannel(token: string): Channel | undefined {
  const t = token.toLowerCase();
  if (t === "a" || t === "f" || t === "1") return "front";
  if (t === "b" || t === "r" || t === "2") return "rear";
  return undefined;
}

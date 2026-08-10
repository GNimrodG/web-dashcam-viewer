import path from "node:path";

export interface ByteRange {
  start: number;
  end: number;
}

export function isSafeClipFilename(filename: unknown): filename is string {
  return (
    typeof filename === "string" &&
    filename.length > 4 &&
    filename.toLowerCase().endsWith(".mp4") &&
    filename === path.basename(filename) &&
    filename === path.posix.basename(filename) &&
    filename === path.win32.basename(filename) &&
    filename !== "." &&
    filename !== ".."
  );
}

export function parseByteRange(
  header: string,
  fileSize: number,
  maxOpenEndedBytes = 10_000_001,
): ByteRange | null {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, fileSize);
    return { start: fileSize - length, end: fileSize - 1 };
  }

  const start = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize)
    return null;

  let end: number;
  if (match[2]) {
    end = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(end) || end < start) return null;
    end = Math.min(end, fileSize - 1);
  } else {
    end = Math.min(fileSize - 1, start + maxOpenEndedBytes - 1);
  }

  return { start, end };
}

export function sanitizeReturnPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

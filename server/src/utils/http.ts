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

function parseHttpUrl(value: string): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isLoopbackUrl(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
}

export function resolvePostLoginRedirect(options: {
  returnPath?: string | null;
  frontendUrl?: string;
  oidcRedirectUri?: string;
  requestOrigin: string;
}): string {
  const requestedFrontend = parseHttpUrl(options.frontendUrl || "");
  const oidcCallback = parseHttpUrl(options.oidcRedirectUri || "");
  const requestOrigin = parseHttpUrl(options.requestOrigin);
  const configuredFrontend =
    requestedFrontend &&
    oidcCallback &&
    isLoopbackUrl(requestedFrontend) &&
    !isLoopbackUrl(oidcCallback)
      ? null
      : requestedFrontend;
  const base = configuredFrontend || oidcCallback || requestOrigin;

  if (!base) throw new TypeError("Unable to determine frontend URL");

  const returnPath = sanitizeReturnPath(options.returnPath);
  if (returnPath) return new URL(returnPath, base.origin).href;
  if (configuredFrontend) return configuredFrontend.href;
  return `${base.origin}/`;
}

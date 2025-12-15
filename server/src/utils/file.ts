import fs from "node:fs/promises";
import fssync from "node:fs";

export async function statSafe(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

export function existsSync(p: string) {
  try {
    fssync.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function toWebPathSegment(p: string) {
  // Basic sanitizer for use as URL segment
  return encodeURIComponent(p);
}

export function fromWebPathSegment(s: string) {
  return decodeURIComponent(s);
}

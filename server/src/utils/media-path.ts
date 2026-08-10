import path from "node:path";

export function canonicalMediaPath(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isRoMediaPath(filePath: string): boolean {
  return path
    .normalize(filePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase() === "ro");
}

/**
 * Returns a positive value when candidatePath should win, a negative value
 * when currentPath should remain, and zero when both identify the same file.
 */
export function compareMediaPathPriority(
  candidatePath: string,
  currentPath: string,
): number {
  const priorityDifference =
    Number(isRoMediaPath(candidatePath)) - Number(isRoMediaPath(currentPath));
  if (priorityDifference !== 0) return priorityDifference;

  const candidate = canonicalMediaPath(candidatePath);
  const current = canonicalMediaPath(currentPath);
  if (candidate === current) return 0;

  // Stable fallback for unexpected duplicates outside RO.
  return candidate.localeCompare(current) < 0 ? 1 : -1;
}

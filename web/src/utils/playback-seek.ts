export const KEYBOARD_SEEK_SECONDS = 5;
export const FRAME_STEP_SECONDS = 1 / 30;

export function clampPlaybackTime(
  timeSec: number,
  durationSec?: number,
): number {
  const target = Math.max(0, timeSec);
  return durationSec !== undefined && Number.isFinite(durationSec)
    ? Math.min(durationSec, target)
    : target;
}

export function getRelativeSeekTarget(
  currentTimeSec: number,
  offsetSec: number,
  durationSec?: number,
): number {
  return clampPlaybackTime(currentTimeSec + offsetSec, durationSec);
}

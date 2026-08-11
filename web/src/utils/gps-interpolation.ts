import type { TimedCoordinate } from "./speed";

export function interpolateGpsPosition(
  points: readonly TimedCoordinate[],
  timeSec: number,
): TimedCoordinate | null {
  if (points.length === 0 || !Number.isFinite(timeSec)) return null;

  const first = points[0];
  if (points.length === 1 || timeSec <= first.tsSec) return { ...first };

  const last = points.at(-1)!;
  if (timeSec >= last.tsSec) return { ...last };

  let lowerIndex = 0;
  let upperIndex = points.length - 1;
  while (lowerIndex + 1 < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (points[middleIndex].tsSec <= timeSec) {
      lowerIndex = middleIndex;
    } else {
      upperIndex = middleIndex;
    }
  }

  const from = points[lowerIndex];
  const to = points[upperIndex];
  const elapsedSeconds = to.tsSec - from.tsSec;
  if (elapsedSeconds <= 0) return { ...to };

  const progress = (timeSec - from.tsSec) / elapsedSeconds;
  const longitudeDelta = ((((to.lon - from.lon) % 360) + 540) % 360) - 180;
  const longitude = from.lon + longitudeDelta * progress;

  return {
    tsSec: timeSec,
    lat: from.lat + (to.lat - from.lat) * progress,
    lon: ((((longitude + 180) % 360) + 360) % 360) - 180,
  };
}

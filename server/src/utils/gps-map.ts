import type { GpsPoint } from "../types.js";

export type GpsMapPoint = Pick<GpsPoint, "tsSec" | "lat" | "lon">;

/**
 * Keep map payloads bounded while retaining both endpoints and the shape of a
 * track. Points are selected at an even interval so every recording receives
 * the same maximum payload budget.
 */
export function sampleGpsTrack(
  points: readonly GpsPoint[],
  maxPoints = 500,
): GpsMapPoint[] {
  if (maxPoints < 2) throw new Error("maxPoints must be at least 2");
  if (points.length <= maxPoints) {
    return points.map(({ tsSec, lat, lon }) => ({ tsSec, lat, lon }));
  }

  const result: GpsMapPoint[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < maxPoints; index++) {
    const sourceIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    const { tsSec, lat, lon } = points[sourceIndex];
    result.push({ tsSec, lat, lon });
  }
  return result;
}

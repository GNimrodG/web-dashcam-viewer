import type { GpsMapTrack } from "../api";

export interface GpsOverlapLocation {
  lat: number;
  lon: number;
  recordingIds: string[];
}

/** Approximate 100-metre cells used to reveal routes shared by recordings. */
const OVERLAP_CELL_DEGREES = 0.001;

export function buildGpsOverlapLocations(
  tracks: readonly GpsMapTrack[],
): GpsOverlapLocation[] {
  const cells = new Map<
    string,
    { latTotal: number; lonTotal: number; samples: number; ids: Set<string> }
  >();

  for (const track of tracks) {
    const visitedByTrack = new Set<string>();
    for (const point of track.points) {
      const latCell = Math.round(point.lat / OVERLAP_CELL_DEGREES);
      const lonCell = Math.round(point.lon / OVERLAP_CELL_DEGREES);
      const key = `${latCell}:${lonCell}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { latTotal: 0, lonTotal: 0, samples: 0, ids: new Set() };
        cells.set(key, cell);
      }
      cell.latTotal += point.lat;
      cell.lonTotal += point.lon;
      cell.samples++;
      if (!visitedByTrack.has(key)) {
        cell.ids.add(track.id);
        visitedByTrack.add(key);
      }
    }
  }

  return [...cells.values()]
    .filter((cell) => cell.ids.size > 1)
    .map((cell) => ({
      lat: cell.latTotal / cell.samples,
      lon: cell.lonTotal / cell.samples,
      recordingIds: [...cell.ids].sort(),
    }))
    .sort((a, b) => b.recordingIds.length - a.recordingIds.length);
}

import type { GpsMapTrack } from "../api";

export interface GpsOverlapLocation {
  lat: number;
  lon: number;
  recordingIds: string[];
}

interface ProjectedPoint {
  x: number;
  y: number;
}

export function spaceGpsOverlapLocations(
  locations: readonly GpsOverlapLocation[],
  project: (lat: number, lon: number) => ProjectedPoint,
  minimumSpacing: number,
): GpsOverlapLocation[] {
  if (minimumSpacing <= 0) return [...locations];

  const grid = new Map<string, number[]>();
  const spaced: Array<
    GpsOverlapLocation & { point: ProjectedPoint; ids: Set<string> }
  > = [];
  const sorted = [...locations].sort(
    (a, b) => b.recordingIds.length - a.recordingIds.length,
  );

  for (const location of sorted) {
    const point = project(location.lat, location.lon);
    const cellX = Math.floor(point.x / minimumSpacing);
    const cellY = Math.floor(point.y / minimumSpacing);
    let nearestIndex: number | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let x = cellX - 1; x <= cellX + 1; x++) {
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const index of grid.get(`${x}:${y}`) || []) {
          const candidate = spaced[index];
          const distance =
            (candidate.point.x - point.x) ** 2 +
            (candidate.point.y - point.y) ** 2;
          if (distance < minimumSpacing ** 2 && distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
          }
        }
      }
    }

    if (nearestIndex !== undefined) {
      for (const id of location.recordingIds) {
        spaced[nearestIndex].ids.add(id);
      }
      continue;
    }

    const index = spaced.length;
    spaced.push({
      ...location,
      point,
      ids: new Set(location.recordingIds),
    });
    const key = `${cellX}:${cellY}`;
    grid.set(key, [...(grid.get(key) || []), index]);
  }

  return spaced.map(({ lat, lon, ids }) => ({
    lat,
    lon,
    recordingIds: [...ids].sort((a, b) => a.localeCompare(b)),
  }));
}

/** Approximate 300-metre cells used to reveal routes shared by recordings. */
const OVERLAP_CELL_DEGREES = 0.003;

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

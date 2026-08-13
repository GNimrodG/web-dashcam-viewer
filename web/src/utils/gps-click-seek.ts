interface TimedGpsPoint {
  tsSec: number;
  lat: number;
  lon: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

export function findClosestGpsTime(
  points: readonly TimedGpsPoint[],
  clicked: { lat: number; lon: number },
  project: (lat: number, lon: number) => ProjectedPoint,
): number | undefined {
  if (!points.length) return undefined;
  if (points.length === 1) return points[0].tsSec;

  const clickPoint = project(clicked.lat, clicked.lon);
  let closestTime = points[0].tsSec;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const projectedFrom = project(from.lat, from.lon);
    const projectedTo = project(to.lat, to.lon);
    const deltaX = projectedTo.x - projectedFrom.x;
    const deltaY = projectedTo.y - projectedFrom.y;
    const lengthSquared = deltaX ** 2 + deltaY ** 2;
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((clickPoint.x - projectedFrom.x) * deltaX +
                (clickPoint.y - projectedFrom.y) * deltaY) /
                lengthSquared,
            ),
          );
    const closestX = projectedFrom.x + deltaX * fraction;
    const closestY = projectedFrom.y + deltaY * fraction;
    const distanceSquared =
      (clickPoint.x - closestX) ** 2 + (clickPoint.y - closestY) ** 2;

    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestTime = from.tsSec + (to.tsSec - from.tsSec) * fraction;
    }
  }

  return closestTime;
}

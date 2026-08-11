export interface TimedCoordinate {
  tsSec: number;
  lat: number;
  lon: number;
}

export interface SpeedSegment {
  from: TimedCoordinate;
  to: TimedCoordinate;
  speedKph: number;
}

export const SPEED_COLOR_STOPS = [
  { speedKph: 0, color: "#ff0000" },
  { speedKph: 50, color: "#ffff00" },
  { speedKph: 100, color: "#80ff00" },
  { speedKph: 125, color: "#00ffff" },
  { speedKph: 150, color: "#0000ff" },
  { speedKph: 200, color: "#ff00ff" },
  { speedKph: 250, color: "#ff0080" },
] as const;

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_PLAUSIBLE_SPEED_KPH = 300;

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceMeters(
  from: Pick<TimedCoordinate, "lat" | "lon">,
  to: Pick<TimedCoordinate, "lat" | "lon">,
): number {
  const latitudeDelta = degreesToRadians(to.lat - from.lat);
  const longitudeDelta = degreesToRadians(to.lon - from.lon);
  const fromLatitude = degreesToRadians(from.lat);
  const toLatitude = degreesToRadians(to.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const clampedHaversine = Math.min(1, Math.max(0, haversine));
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(clampedHaversine), Math.sqrt(1 - clampedHaversine))
  );
}

export function calculateSpeedKph(
  from: TimedCoordinate,
  to: TimedCoordinate,
): number | null {
  const elapsedSeconds = to.tsSec - from.tsSec;
  if (elapsedSeconds <= 0) return null;
  const speedKph = (distanceMeters(from, to) / elapsedSeconds) * 3.6;
  if (!Number.isFinite(speedKph) || speedKph > MAX_PLAUSIBLE_SPEED_KPH) {
    return null;
  }
  return speedKph;
}

export function buildSpeedSegments(points: TimedCoordinate[]): SpeedSegment[] {
  const segments: SpeedSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const speedKph = calculateSpeedKph(from, to);
    if (speedKph !== null) segments.push({ from, to, speedKph });
  }
  return segments;
}

export function calculateSpeedAtTime(
  points: readonly TimedCoordinate[],
  timeSec: number,
): number | null {
  if (
    points.length < 2 ||
    !Number.isFinite(timeSec) ||
    timeSec < points[0].tsSec ||
    timeSec > points.at(-1)!.tsSec
  ) {
    return null;
  }

  if (timeSec === points.at(-1)!.tsSec) {
    return calculateSpeedKph(points.at(-2)!, points.at(-1)!);
  }

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

  return calculateSpeedKph(points[lowerIndex], points[upperIndex]);
}

export function speedColor(speedKph: number): string {
  if (speedKph <= SPEED_COLOR_STOPS[0].speedKph) {
    return SPEED_COLOR_STOPS[0].color;
  }
  const lastStop = SPEED_COLOR_STOPS.at(-1)!;
  if (speedKph >= lastStop.speedKph) return lastStop.color;

  const upperIndex = SPEED_COLOR_STOPS.findIndex(
    (stop) => speedKph <= stop.speedKph,
  );
  const lower = SPEED_COLOR_STOPS[upperIndex - 1];
  const upper = SPEED_COLOR_STOPS[upperIndex];
  const progress =
    (speedKph - lower.speedKph) / (upper.speedKph - lower.speedKph);
  const lowerRgb = hexToRgb(lower.color);
  const upperRgb = hexToRgb(upper.color);
  return rgbToHex(
    lowerRgb.map((channel, index) =>
      Math.round(channel + (upperRgb[index] - channel) * progress),
    ),
  );
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function rgbToHex(channels: number[]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface AbsoluteGpxPoint {
  lat: number;
  lon: number;
  timeMs: number;
  ele?: number;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseAbsoluteGpxPoints(gpxXml: string): AbsoluteGpxPoint[] {
  const validation = XMLValidator.validate(gpxXml);
  if (validation !== true) throw new Error("Invalid GPX file");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const document = parser.parse(gpxXml) as any;
  const points: AbsoluteGpxPoint[] = [];

  for (const track of asArray<any>(document?.gpx?.trk)) {
    for (const segment of asArray<any>(track?.trkseg)) {
      for (const point of asArray<any>(segment?.trkpt)) {
        const lat = Number(point?.["@lat"]);
        const lon = Number(point?.["@lon"]);
        const timeMs = Date.parse(String(point?.time || ""));
        const ele = point?.ele === undefined ? undefined : Number(point.ele);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          !Number.isFinite(timeMs)
        ) {
          continue;
        }
        points.push({
          lat,
          lon,
          timeMs,
          ...(Number.isFinite(ele) ? { ele } : {}),
        });
      }
    }
  }

  points.sort((a, b) => a.timeMs - b.timeMs);
  if (!points.length) {
    throw new Error("GPX file contains no timestamped track points");
  }
  return points;
}

function lowerBound(points: AbsoluteGpxPoint[], timeMs: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timeMs < timeMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function cropAbsoluteGpxPoints(
  points: AbsoluteGpxPoint[],
  startMs: number,
  endMs: number,
): AbsoluteGpxPoint[] {
  const startIndex = lowerBound(points, startMs);
  let endIndex = lowerBound(points, endMs);
  while (endIndex < points.length && points[endIndex].timeMs <= endMs) {
    endIndex++;
  }
  return points.slice(startIndex, endIndex);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildStoredGpxDocument(
  points: AbsoluteGpxPoint[],
  name: string,
  description: string,
): string {
  const trackPoints = points
    .map((point) => {
      const elevation =
        point.ele === undefined ? "" : `\n        <ele>${point.ele}</ele>`;
      return `      <trkpt lat="${point.lat}" lon="${point.lon}">${elevation}\n        <time>${new Date(point.timeMs).toISOString()}</time>\n      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Dashcam Viewer"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <desc>${escapeXml(description)}</desc>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

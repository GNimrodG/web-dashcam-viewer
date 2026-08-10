export interface GpxTrackPoint {
  lat: number;
  lon: number;
  timeMs: number;
  ele?: number;
}

export function parseGpxTrackPoints(gpxText: string): GpxTrackPoint[] {
  const parser = new DOMParser();
  const document = parser.parseFromString(gpxText, "application/xml");

  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid GPX file");
  }

  const trackPoints = Array.from(document.getElementsByTagNameNS("*", "trkpt"));

  return trackPoints
    .map((element) => {
      const lat = Number(element.getAttribute("lat"));
      const lon = Number(element.getAttribute("lon"));
      const timeText =
        element.getElementsByTagNameNS("*", "time")[0]?.textContent?.trim() ||
        "";
      const timeMs = Date.parse(timeText);
      const eleText =
        element.getElementsByTagNameNS("*", "ele")[0]?.textContent?.trim() ||
        "";
      const ele = eleText ? Number(eleText) : undefined;

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(timeMs)
      ) {
        return null;
      }

      return {
        lat,
        lon,
        timeMs,
        ...(Number.isFinite(ele) ? { ele } : {}),
      } satisfies GpxTrackPoint;
    })
    .filter((point): point is GpxTrackPoint => point !== null)
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function cropGpxTrack(
  points: GpxTrackPoint[],
  clipStartAt: string,
  clipEndAt: string,
): GpxTrackPoint[] {
  const startMs = Date.parse(clipStartAt);
  const endMs = Date.parse(clipEndAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError("Invalid clip window");
  }

  return points.filter(
    (point) => point.timeMs >= startMs && point.timeMs <= endMs,
  );
}

export function buildGpxDocument(
  points: GpxTrackPoint[],
  name: string,
  description?: string,
): string {
  const trackPoints = points
    .map((point) => {
      const ele =
        point.ele !== undefined ? `\n    <ele>${point.ele}</ele>` : "";

      return `  <trkpt lat="${point.lat}" lon="${point.lon}">${ele}
    <time>${new Date(point.timeMs).toISOString()}</time>
  </trkpt>`;
    })
    .join("\n");

  const safeDescription = description
    ? `  <desc>${escapeXml(description)}</desc>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Dashcam Viewer"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
${safeDescription}    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], {
    type: "application/gpx+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

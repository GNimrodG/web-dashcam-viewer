import type { GpsPoint } from "../types.js";

/**
 * Convert GPS track data to GPX format
 * @param points GPS points with relative timestamps (tsSec from start of recording)
 * @param name Track name
 * @param description Track description (optional)
 * @param startTime ISO timestamp of when the recording started (optional)
 */
export function generateGPX(
  points: GpsPoint[],
  name: string,
  description?: string,
  startTime?: string,
): string {
  // Parse start time if provided, otherwise default to Unix epoch
  const startTimeMs = startTime ? new Date(startTime).getTime() : 0;

  const trackPoints = points
    .map((pt) => {
      // tsSec is seconds from start of recording, so add it to startTime
      const absoluteTimeMs = startTimeMs + pt.tsSec * 1000;
      const timestamp = new Date(absoluteTimeMs).toISOString();
      const ele = pt.alt ? `\n    <ele>${pt.alt}</ele>` : "";
      const speed = pt.speedKph
        ? `\n    <extensions>\n      <speed>${(pt.speedKph / 3.6).toFixed(2)}</speed>\n    </extensions>`
        : "";

      return `  <trkpt lat="${pt.lat}" lon="${pt.lon}">${ele}
    <time>${timestamp}</time>${speed}
  </trkpt>`;
    })
    .join("\n");

  const desc = description ? `  <desc>${escapeXml(description)}</desc>\n` : "";

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
${desc}    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoredGpxDocument,
  cropAbsoluteGpxPoints,
  parseAbsoluteGpxPoints,
} from "./gpx.js";

const sample = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="47.1" lon="19.1"><time>2026-03-29T19:17:00Z</time></trkpt>
  <trkpt lat="47.2" lon="19.2"><ele>123</ele><time>2026-03-29T19:17:01Z</time></trkpt>
  <trkpt lat="47.3" lon="19.3"><time>2026-03-29T19:17:02Z</time></trkpt>
</trkseg></trk></gpx>`;

test("parses and crops absolute GPX timestamps inclusively", () => {
  const points = parseAbsoluteGpxPoints(sample);
  const cropped = cropAbsoluteGpxPoints(
    points,
    Date.parse("2026-03-29T19:17:01Z"),
    Date.parse("2026-03-29T19:17:02Z"),
  );
  assert.equal(cropped.length, 2);
  assert.equal(cropped[0].ele, 123);
});

test("generated stored GPX can be parsed again", () => {
  const points = parseAbsoluteGpxPoints(sample);
  const output = buildStoredGpxDocument(points, "Test & recording", "Bulk GPX");
  assert.deepEqual(parseAbsoluteGpxPoints(output), points);
  assert.match(output, /Test &amp; recording/);
});

test("rejects GPX without timestamped track points", () => {
  assert.throws(
    () => parseAbsoluteGpxPoints("<gpx><trk><trkseg /></trk></gpx>"),
    /no timestamped track points/,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GPS_EXTRACTION_VERSION,
  deleteRecordedGpxTrack,
  disableRecordedGps,
  enableRecordedGps,
  hasRecordedGpxTrack,
  hasCurrentNoGpsResult,
  isRecordedGpsDisabled,
  isGpsCacheUsable,
  parseNmeaLog,
  readGpsSidecarTrack,
  saveRecordedGpxTrack,
} from "./gps.js";

const point = { tsSec: 0, lat: 47.48, lon: 19.05 };

test("retries legacy empty GPS caches created by failed extractors", () => {
  assert.equal(isGpsCacheUsable({ mtimeMs: 100, data: [] }, 100), false);
});

test("keeps valid legacy data and versioned empty GPS caches", () => {
  assert.equal(isGpsCacheUsable({ mtimeMs: 100, data: [point] }, 100), true);
  assert.equal(
    isGpsCacheUsable({ version: 2, mtimeMs: 100, data: [] }, 100),
    true,
  );
  assert.equal(
    isGpsCacheUsable({ version: 2, mtimeMs: 99, data: [point] }, 100),
    false,
  );
});

test("retries no-GPS flags created by an older extractor", () => {
  assert.equal(hasCurrentNoGpsResult(undefined), true);
  assert.equal(hasCurrentNoGpsResult({ noGps: true }), false);
  assert.equal(
    hasCurrentNoGpsResult({
      noGps: true,
      gpsExtractionVersion: GPS_EXTRACTION_VERSION,
    }),
    true,
  );
  assert.equal(
    hasCurrentNoGpsResult({
      noGps: false,
      gpsExtractionVersion: GPS_EXTRACTION_VERSION,
    }),
    false,
  );
});

test("durably disables GPS while deleting a stored GPX override", () => {
  const mediaDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dashcam-gps-delete-"),
  );
  try {
    const storedPath = saveRecordedGpxTrack(
      mediaDir,
      "20260509_185356",
      "<gpx />",
    );
    assert.equal(fs.existsSync(storedPath), true);
    assert.equal(hasRecordedGpxTrack(mediaDir, "20260509_185356"), true);

    deleteRecordedGpxTrack(mediaDir, "20260509_185356");
    assert.equal(hasRecordedGpxTrack(mediaDir, "20260509_185356"), false);
    saveRecordedGpxTrack(mediaDir, "20260509_185356", "<gpx />");

    disableRecordedGps(mediaDir, "20260509_185356");
    assert.equal(fs.existsSync(storedPath), false);
    assert.equal(isRecordedGpsDisabled(mediaDir, "20260509_185356"), true);

    enableRecordedGps(mediaDir, "20260509_185356");
    assert.equal(isRecordedGpsDisabled(mediaDir, "20260509_185356"), false);
  } finally {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// A BlackVue ".gps" sidecar: unix milliseconds in brackets, then an NMEA sentence.
const BLACKVUE_GPS_LOG = [
  "[1555957502837]$GPRMC,162458.00,A,5228.16177,N,00612.34567,E,0.05,,220419,,,A*7C",
  "[1555957502838]$GPGGA,162458.00,5228.16177,N,00612.34567,E,1,08,1.20,42.5,M,45.0,M,,*5A",
  "[1555957503840]$GPRMC,162459.00,A,5228.16277,N,00612.34667,E,10.00,,220419,,,A*7C",
  "",
].join("\r\n");

function assertClose(actual: number | undefined, expected: number) {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-6,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("reads a BlackVue GPS log into a timed track", () => {
  const points = parseNmeaLog(BLACKVUE_GPS_LOG);
  assert.equal(points.length, 2);

  // RMC and GGA of one fix merge: position and speed from RMC, altitude from GGA.
  assertClose(points[0].tsSec, 0);
  assertClose(points[0].lat, 52 + 28.16177 / 60);
  assertClose(points[0].lon, 6 + 12.34567 / 60);
  assertClose(points[0].alt, 42.5);
  assertClose(points[0].speedKph, 0.05 * 1.852);

  // Elapsed time comes from the bracketed log timestamps.
  assertClose(points[1].tsSec, 1.003);
  assertClose(points[1].speedKph, 10 * 1.852);
});

test("drops GPS fixes the receiver reported as void", () => {
  const points = parseNmeaLog(
    // A void fix can still carry the last known position, so it has to be
    // rejected on the status flag rather than on missing coordinates.
    "[1555957502837]$GPRMC,162458.00,V,5228.16000,N,00612.34000,E,0.00,,220419,,,N*53\r\n" +
      "[1555957503840]$GPRMC,162459.00,A,5228.16277,N,00612.34667,E,10.00,,220419,,,A*7C",
  );
  assert.equal(points.length, 1);
  assertClose(points[0].tsSec, 0);
  assertClose(points[0].lat, 52 + 28.16277 / 60);
});

test("falls back to NMEA time of day when the log has no timestamps", () => {
  const points = parseNmeaLog(
    "$GPRMC,162458.00,A,5228.16177,N,00612.34567,E,0.05,,220419,,,A*7C\n" +
      "$GPRMC,162501.00,A,5228.16277,N,00612.34667,E,10.00,,220419,,,A*7C",
  );
  assert.equal(points.length, 2);
  assertClose(points[0].tsSec, 0);
  assertClose(points[1].tsSec, 3);
});

test("finds the GPS sidecar beside a clip, and tolerates its absence", () => {
  const mediaDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dashcam-gps-sidecar-"),
  );
  try {
    const frontClip = path.join(mediaDir, "20190422_162458_NF.mp4");
    const rearClip = path.join(mediaDir, "20190422_162458_NR.mp4");
    fs.writeFileSync(frontClip, "");
    fs.writeFileSync(rearClip, "");
    fs.writeFileSync(
      path.join(mediaDir, "20190422_162458_NF.gps"),
      BLACKVUE_GPS_LOG,
    );

    assert.equal(readGpsSidecarTrack(frontClip).length, 2);
    // Only the front unit has a receiver; the rear clip must not borrow its track.
    assert.deepEqual(readGpsSidecarTrack(rearClip), []);
  } finally {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

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

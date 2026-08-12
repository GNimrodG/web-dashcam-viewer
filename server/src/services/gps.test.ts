import assert from "node:assert/strict";
import test from "node:test";
import {
  GPS_EXTRACTION_VERSION,
  hasCurrentNoGpsResult,
  isGpsCacheUsable,
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

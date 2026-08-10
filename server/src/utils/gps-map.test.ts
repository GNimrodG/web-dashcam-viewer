import assert from "node:assert/strict";
import test from "node:test";
import { sampleGpsTrack } from "./gps-map.js";

test("samples long GPS tracks while retaining both endpoints", () => {
  const points = Array.from({ length: 1000 }, (_, index) => ({
    tsSec: index,
    lat: 47 + index / 1000,
    lon: 19 + index / 1000,
  }));

  const sampled = sampleGpsTrack(points, 100);
  assert.equal(sampled.length, 100);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
});

test("copies short GPS tracks without dropping map fields", () => {
  const sampled = sampleGpsTrack([
    { tsSec: 0, lat: 47, lon: 19, speedKph: 50 },
    { tsSec: 1, lat: 48, lon: 20, alt: 100 },
  ]);

  assert.deepEqual(sampled, [
    { tsSec: 0, lat: 47, lon: 19 },
    { tsSec: 1, lat: 48, lon: 20 },
  ]);
});

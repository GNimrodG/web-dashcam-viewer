import assert from "node:assert/strict";
import test from "node:test";
import { buildGpsMapSignature, sampleGpsTrack } from "./gps-map.js";
import type { VideoPair } from "../types.js";

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

test("GPS map signatures change when a recording source changes", () => {
  const pair = {
    id: "20260326_160911",
    startTime: "2026-03-26T14:09:11.000Z",
    channels: {
      front: {
        path: "recording.mp4",
        filename: "recording.mp4",
        size: 100,
        mtimeMs: 200,
      },
    },
  };
  const original = buildGpsMapSignature([pair]);
  const unchanged = buildGpsMapSignature([{ ...pair }]);
  const changed = buildGpsMapSignature([
    {
      ...pair,
      channels: { front: { ...pair.channels.front, mtimeMs: 201 } },
    },
  ]);
  assert.equal(unchanged, original);
  assert.notEqual(changed, original);
});

test("GPS map signatures change when the extractor version changes", () => {
  const pair: VideoPair = {
    id: "20260326_160911",
    channels: {
      front: {
        path: "recording.mp4",
        filename: "recording.mp4",
        size: 100,
      },
    },
  };
  pair.channels.front!.noGps = true;
  const legacySignature = buildGpsMapSignature([pair]);
  pair.channels.front!.gpsExtractionVersion = 2;
  assert.notEqual(buildGpsMapSignature([pair]), legacySignature);
});

test("GPS map signatures change when GPS is disabled", () => {
  const pair: VideoPair = {
    id: "20260509_185356",
    channels: {},
  };
  const enabledSignature = buildGpsMapSignature([pair]);
  pair.gpsDisabled = true;
  assert.notEqual(buildGpsMapSignature([pair]), enabledSignature);
});

test("GPS map signatures change when an external GPX is removed", () => {
  const pair: VideoPair = {
    id: "20260509_185356",
    channels: {},
    hasExternalGps: true,
  };
  const externalSignature = buildGpsMapSignature([pair]);
  pair.hasExternalGps = false;
  assert.notEqual(buildGpsMapSignature([pair]), externalSignature);
});

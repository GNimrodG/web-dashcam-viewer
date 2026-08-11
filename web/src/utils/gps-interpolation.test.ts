import assert from "node:assert/strict";
import test from "node:test";
import { interpolateGpsPosition } from "./gps-interpolation";

test("interpolates a position based on playback time", () => {
  const position = interpolateGpsPosition(
    [
      { tsSec: 10, lat: 47, lon: 19 },
      { tsSec: 14, lat: 48, lon: 21 },
    ],
    11,
  );

  assert.deepEqual(position, { tsSec: 11, lat: 47.25, lon: 19.5 });
});

test("clamps playback times outside the available track", () => {
  const points = [
    { tsSec: 2, lat: 47, lon: 19 },
    { tsSec: 3, lat: 48, lon: 20 },
  ];

  assert.deepEqual(interpolateGpsPosition(points, 0), points[0]);
  assert.deepEqual(interpolateGpsPosition(points, 5), points[1]);
});

test("takes the shortest path when crossing the date line", () => {
  const position = interpolateGpsPosition(
    [
      { tsSec: 0, lat: 0, lon: 179 },
      { tsSec: 2, lat: 0, lon: -179 },
    ],
    1,
  );

  assert.equal(position?.lon, -180);
});

test("returns null when a position cannot be calculated", () => {
  assert.equal(interpolateGpsPosition([], 0), null);
  assert.equal(
    interpolateGpsPosition([{ tsSec: 0, lat: 47, lon: 19 }], Number.NaN),
    null,
  );
});

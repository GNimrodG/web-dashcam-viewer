import assert from "node:assert/strict";
import test from "node:test";
import { calculateSpeedAtTime } from "./speed";

const points = [
  { tsSec: 0, lat: 0, lon: 0 },
  { tsSec: 10, lat: 0, lon: 0.001 },
  { tsSec: 20, lat: 0, lon: 0.003 },
];

test("returns the calculated speed for the segment at playback time", () => {
  assert.ok(Math.abs(calculateSpeedAtTime(points, 5)! - 40.03) < 0.1);
  assert.ok(Math.abs(calculateSpeedAtTime(points, 10)! - 80.06) < 0.1);
  assert.ok(Math.abs(calculateSpeedAtTime(points, 20)! - 80.06) < 0.1);
});

test("does not report speed outside the available GPS window", () => {
  assert.equal(calculateSpeedAtTime(points, -0.1), null);
  assert.equal(calculateSpeedAtTime(points, 20.1), null);
  assert.equal(calculateSpeedAtTime([points[0]], 0), null);
});

test("does not report an implausible GPS segment", () => {
  assert.equal(
    calculateSpeedAtTime(
      [
        { tsSec: 0, lat: 0, lon: 0 },
        { tsSec: 1, lat: 1, lon: 1 },
      ],
      0.5,
    ),
    null,
  );
});

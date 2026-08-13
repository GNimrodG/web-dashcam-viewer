import assert from "node:assert/strict";
import test from "node:test";
import { findClosestGpsTime } from "./gps-click-seek";

const project = (lat: number, lon: number) => ({ x: lon, y: lat });

test("interpolates the recording time along the clicked route segment", () => {
  const timeSec = findClosestGpsTime(
    [
      { tsSec: 0, lat: 0, lon: 0 },
      { tsSec: 10, lat: 0, lon: 10 },
    ],
    { lat: 1, lon: 2.5 },
    project,
  );
  assert.equal(timeSec, 2.5);
});

test("uses the closest segment in a multi-segment route", () => {
  const timeSec = findClosestGpsTime(
    [
      { tsSec: 0, lat: 0, lon: 0 },
      { tsSec: 10, lat: 0, lon: 10 },
      { tsSec: 20, lat: 10, lon: 10 },
    ],
    { lat: 7.5, lon: 9 },
    project,
  );
  assert.equal(timeSec, 17.5);
});

test("handles tracks containing only one GPS point", () => {
  assert.equal(
    findClosestGpsTime(
      [{ tsSec: 12, lat: 1, lon: 2 }],
      { lat: 3, lon: 4 },
      project,
    ),
    12,
  );
  assert.equal(findClosestGpsTime([], { lat: 0, lon: 0 }, project), undefined);
});

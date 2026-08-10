import assert from "node:assert/strict";
import test from "node:test";
import {
  getDashcamTimeZone,
  parseDashcamFilenameTimeIso,
} from "./dashcam-time.js";

test("converts winter dashcam filename time using the configured zone", () => {
  assert.equal(
    parseDashcamFilenameTimeIso(
      { date: "20260327", time: "151428" },
      "Europe/Berlin",
    ),
    "2026-03-27T14:14:28Z",
  );
});

test("applies daylight saving time for summer dashcam filenames", () => {
  assert.equal(
    parseDashcamFilenameTimeIso(
      { date: "20260329", time: "211701" },
      "Europe/Berlin",
    ),
    "2026-03-29T19:17:01Z",
  );
});

test("supports a dashcam clock fixed at UTC+2 before DST", () => {
  assert.equal(
    parseDashcamFilenameTimeIso(
      { date: "20260326", time: "160911" },
      "Etc/GMT-2",
    ),
    "2026-03-26T14:09:11Z",
  );
});

test("rejects an invalid configured time zone", () => {
  const previous = process.env.DASHCAM_TIME_ZONE;
  process.env.DASHCAM_TIME_ZONE = "Not/AZone";
  try {
    assert.throws(() => getDashcamTimeZone(), /valid IANA time zone/);
  } finally {
    if (previous === undefined) delete process.env.DASHCAM_TIME_ZONE;
    else process.env.DASHCAM_TIME_ZONE = previous;
  }
});

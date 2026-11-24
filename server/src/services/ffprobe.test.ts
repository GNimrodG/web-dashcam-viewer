import assert from "node:assert/strict";
import test from "node:test";
import { getUsableVideoDuration } from "./ffprobe.js";

test("accepts a positive container duration for a video", () => {
  assert.equal(
    getUsableVideoDuration({
      streams: [{ codec_type: "video", duration: "9" }],
      format: { duration: "10.5" },
    }),
    10.5,
  );
});

test("falls back to the longest video stream duration", () => {
  assert.equal(
    getUsableVideoDuration({
      streams: [
        { codec_type: "video", duration: "8.5" },
        { codec_type: "video", duration: "9.25" },
        { codec_type: "audio", duration: "12" },
      ],
      format: {},
    }),
    9.25,
  );
});

test("rejects media without a readable video duration", () => {
  assert.equal(
    getUsableVideoDuration({
      streams: [{ codec_type: "audio", duration: "10" }],
      format: { duration: "10" },
    }),
    undefined,
  );
  assert.equal(
    getUsableVideoDuration({
      streams: [{ codec_type: "video" }],
      format: {},
    }),
    undefined,
  );
});

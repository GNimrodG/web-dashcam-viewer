import assert from "node:assert/strict";
import test from "node:test";
import { buildClipProgress } from "./clipper.js";

test("converts ffmpeg microsecond progress into clip progress", () => {
  assert.deepEqual(
    buildClipProgress(
      {
        out_time_us: "5000000",
        fps: "42.5",
        speed: "0.75x",
        progress: "continue",
      },
      20,
    ),
    {
      percent: 25,
      processedSeconds: 5,
      durationSeconds: 20,
      fps: 42.5,
      speed: 0.75,
      phase: "encoding",
    },
  );
});

test("reserves 100 percent for a successfully finalized clip", () => {
  const progress = buildClipProgress(
    { out_time_us: "25000000", progress: "end" },
    20,
  );
  assert.equal(progress.percent, 99);
  assert.equal(progress.processedSeconds, 20);
  assert.equal(progress.phase, "finalizing");
});

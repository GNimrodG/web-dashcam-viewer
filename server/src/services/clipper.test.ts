import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClipProgress,
  buildPictureInPictureFilter,
  requiresBothChannels,
} from "./clipper.js";

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

test("builds a bottom-right rear overlay over the fullscreen front camera", () => {
  assert.equal(
    buildPictureInPictureFilter({
      channels: "front-pip-rear",
      pipSizePercent: 30,
      pipCorner: "bottom-right",
    }),
    "[1:v][0:v]scale2ref=w=trunc(main_w*0.3/2)*2:h=-2[pip][base];[base][pip]overlay=x=main_w-overlay_w-trunc(main_w*0.02):y=main_h-overlay_h-trunc(main_w*0.02):shortest=1[v]",
  );
});

test("builds a top-left front overlay over the fullscreen rear camera", () => {
  assert.equal(
    buildPictureInPictureFilter({
      channels: "rear-pip-front",
      pipSizePercent: 40,
      pipCorner: "top-left",
    }),
    "[0:v][1:v]scale2ref=w=trunc(main_w*0.4/2)*2:h=-2[pip][base];[base][pip]overlay=x=trunc(main_w*0.02):y=trunc(main_w*0.02):shortest=1[v]",
  );
});

test("all combined clip layouts require both camera channels", () => {
  assert.equal(requiresBothChannels("front"), false);
  assert.equal(requiresBothChannels("rear"), false);
  assert.equal(requiresBothChannels("both-stacked"), true);
  assert.equal(requiresBothChannels("both-side-by-side"), true);
  assert.equal(requiresBothChannels("front-pip-rear"), true);
  assert.equal(requiresBothChannels("rear-pip-front"), true);
});

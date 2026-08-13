import assert from "node:assert/strict";
import test from "node:test";
import { calculateClipPreviewLayout } from "./clip-layout";

const front = { width: 3840, height: 2160 };
const rear = { width: 1920, height: 1080 };

test("places a 30 percent rear image in the bottom-right of the front frame", () => {
  assert.deepEqual(
    calculateClipPreviewLayout({
      mode: "front-pip-rear",
      front,
      rear,
      pipSizePercent: 30,
      pipCorner: "bottom-right",
    }),
    {
      width: 3840,
      height: 2160,
      front: { x: 0, y: 0, width: 3840, height: 2160 },
      rear: { x: 2612, y: 1436, width: 1152, height: 648 },
    },
  );
});

test("places the front image over fullscreen rear in the selected corner", () => {
  assert.deepEqual(
    calculateClipPreviewLayout({
      mode: "rear-pip-front",
      front,
      rear,
      pipSizePercent: 40,
      pipCorner: "top-left",
    }),
    {
      width: 1920,
      height: 1080,
      rear: { x: 0, y: 0, width: 1920, height: 1080 },
      front: { x: 38, y: 38, width: 768, height: 432 },
    },
  );
});

test("matches the fixed FFmpeg dimensions for existing combined modes", () => {
  assert.deepEqual(
    calculateClipPreviewLayout({ mode: "both-stacked", front, rear }),
    {
      width: 1920,
      height: 2160,
      front: { x: 0, y: 0, width: 1920, height: 1080 },
      rear: { x: 0, y: 1080, width: 1920, height: 1080 },
    },
  );
  assert.deepEqual(
    calculateClipPreviewLayout({
      mode: "both-side-by-side",
      front,
      rear,
    }),
    {
      width: 3840,
      height: 1080,
      front: { x: 0, y: 0, width: 1920, height: 1080 },
      rear: { x: 1920, y: 0, width: 1920, height: 1080 },
    },
  );
});

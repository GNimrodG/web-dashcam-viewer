import assert from "node:assert/strict";
import test from "node:test";
import { detectCameraSaveEvents } from "./audio-events.js";

const SAMPLE_RATE = 8_000;

function makePcm(
  durationSec: number,
  beepStarts: readonly number[],
): Int16Array {
  const pcm = new Int16Array(Math.ceil(durationSec * SAMPLE_RATE));
  for (const startSec of beepStarts) {
    const start = Math.round(startSec * SAMPLE_RATE);
    const end = Math.min(pcm.length, start + Math.round(0.06 * SAMPLE_RATE));
    for (let index = start; index < end; index++) {
      pcm[index] = Math.round(
        Math.sin((2 * Math.PI * 2_000 * index) / SAMPLE_RATE) * 12_000,
      );
    }
  }
  return pcm;
}

test("detects three bursts of two 2 kHz camera-save beeps", () => {
  const events = detectCameraSaveEvents(
    makePcm(8, [4, 4.15, 4.45, 4.6, 4.9, 5.05]),
  );
  assert.equal(events.length, 1);
  assert.ok(Math.abs(events[0] - 4) < 0.05);
});

test("rejects isolated tones and incomplete beep patterns", () => {
  assert.deepEqual(detectCameraSaveEvents(makePcm(4, [1, 1.15])), []);
  assert.deepEqual(
    detectCameraSaveEvents(makePcm(5, [1, 1.15, 1.45, 1.6])),
    [],
  );
});

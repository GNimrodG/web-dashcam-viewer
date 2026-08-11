import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_STEP_SECONDS,
  getRelativeSeekTarget,
  KEYBOARD_SEEK_SECONDS,
} from "./playback-seek";

test("seeks by the YouTube-style five second interval", () => {
  assert.equal(getRelativeSeekTarget(20, KEYBOARD_SEEK_SECONDS, 60), 25);
  assert.equal(getRelativeSeekTarget(20, -KEYBOARD_SEEK_SECONDS, 60), 15);
});

test("clamps relative seeks to the recording boundaries", () => {
  assert.equal(getRelativeSeekTarget(2, -KEYBOARD_SEEK_SECONDS, 60), 0);
  assert.equal(getRelativeSeekTarget(58, KEYBOARD_SEEK_SECONDS, 60), 60);
});

test("uses a 30 fps step for comma and period shortcuts", () => {
  assert.equal(getRelativeSeekTarget(1, FRAME_STEP_SECONDS, 2), 1 + 1 / 30);
  assert.equal(getRelativeSeekTarget(0, -FRAME_STEP_SECONDS, 2), 0);
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  canonicalMediaPath,
  compareMediaPathPriority,
  isRoMediaPath,
  isSupportedVideoFile,
} from "./media-path.js";

test("only supported video extensions can enter the recording index", () => {
  assert.equal(isSupportedVideoFile("20260326_160911_F.MP4"), true);
  assert.equal(isSupportedVideoFile("20260326_160911_R.mov"), true);
  assert.equal(isSupportedVideoFile("20260326_160911.gpx"), false);
  assert.equal(isSupportedVideoFile("video.mp4.gpscache.json"), false);
});

test(
  "canonical paths ignore slash style on Windows",
  { skip: process.platform !== "win32" },
  () => {
    const nativePath = path.join("Z:\\", "dashcam", "video.MP4");
    const alternatePath = nativePath.replaceAll("\\", "/");
    assert.equal(
      canonicalMediaPath(nativePath),
      canonicalMediaPath(alternatePath),
    );
  },
);

test("detects RO as a complete directory segment", () => {
  assert.equal(isRoMediaPath(path.join("Z:\\dashcam", "RO", "video.MP4")), true);
  assert.equal(
    isRoMediaPath(path.join("Z:\\dashcam", "ROAD", "video.MP4")),
    false,
  );
});

test("RO always has priority over the normal recording", () => {
  const normal = path.join("Z:\\dashcam", "2026_0329_211701_R.MP4");
  const ro = path.join("Z:\\dashcam", "RO", "2026_0329_211701_R.MP4");
  assert.ok(compareMediaPathPriority(ro, normal) > 0);
  assert.ok(compareMediaPathPriority(normal, ro) < 0);
});

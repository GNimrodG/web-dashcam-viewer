import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test, { after } from "node:test";
import { closeDatabase, initDatabase } from "../db/database.js";
import { buildIndex, getVideoPairs } from "./indexer.js";

// The indexer skips clips that ffprobe cannot read or that have no usable
// duration, so each test clip is a copy of one real one-second video.
const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashcam-sample-"));
const sampleClip = path.join(sampleDir, "sample.mp4");
let ffmpegMissing: string | false = false;
try {
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x64:rate=5:duration=1",
      "-pix_fmt",
      "yuv420p",
      "-y",
      sampleClip,
    ],
    { stdio: "ignore" },
  );
} catch {
  ffmpegMissing = "ffmpeg is needed to generate a playable test clip";
}
after(() => fs.rmSync(sampleDir, { recursive: true, force: true }));
const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: ffmpegMissing }, fn);

/**
 * Index a throwaway media folder containing the given clips and return the
 * recordings the app would show.
 */
async function indexClips(clipNames: string[]) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashcam-index-"));
  initDatabase(mediaDir);
  try {
    for (const name of clipNames) {
      fs.copyFileSync(sampleClip, path.join(mediaDir, name));
    }
    await buildIndex(mediaDir);
    return getVideoPairs();
  } finally {
    closeDatabase();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
}

it("indexes a BlackVue front and rear clip as one recording", async () => {
  const pairs = await indexClips([
    "20250910_131727_NF.mp4",
    "20250910_131727_NR.mp4",
  ]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].id, "20250910_131727");
  assert.equal(pairs[0].channels.front?.filename, "20250910_131727_NF.mp4");
  assert.equal(pairs[0].channels.rear?.filename, "20250910_131727_NR.mp4");
});

it("indexes Viofo and BlackVue recordings side by side", async () => {
  const pairs = await indexClips([
    "2025_0910_131727_F.MP4",
    "2025_0910_131727_R.MP4",
    "20250910_140000_NF.mp4",
    "20250910_140000_NR.mp4",
  ]);

  assert.deepEqual(
    pairs.map((pair) => pair.id),
    ["20250910_131727", "20250910_140000"],
  );
  for (const pair of pairs) {
    assert.ok(pair.channels.front, `${pair.id} front`);
    assert.ok(pair.channels.rear, `${pair.id} rear`);
  }
});

it("indexes a BlackVue event recording with only the front camera", async () => {
  const pairs = await indexClips(["20250910_131727_EF.mp4"]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].channels.front?.filename, "20250910_131727_EF.mp4");
  assert.equal(pairs[0].channels.rear, undefined);
});

it("keeps a clip with no identifiable channel out of the library", async () => {
  // This is what happened to every BlackVue clip before the filename pattern
  // existed: parsing yields no channel, the file joins no channel of its pair,
  // and a pair holding neither front nor rear is never listed. The failure is
  // silent, so it is worth pinning: the interior lens of a three-channel model
  // must not resurface as an empty recording either.
  const pairs = await indexClips(["20250910_131727_NI.mp4"]);

  assert.deepEqual(pairs, []);
});

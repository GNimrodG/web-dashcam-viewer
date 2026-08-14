import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildClipMetadata,
  getClipMetadataPath,
  getGeneratedClipVideoId,
  readClipMetadata,
  writeClipMetadata,
} from "./clip-metadata.js";

test("builds clip metadata with source timing and HDR state", () => {
  assert.deepEqual(
    buildClipMetadata({
      videoId: "20260814_180000",
      clipStartTime: 10,
      clipEndTime: 20,
      clipChannels: "front",
      createdAt: 123,
      sourceStartTime: "2026-08-14T16:00:00.000Z",
      hdr: true,
    }),
    {
      videoId: "20260814_180000",
      clipStartTime: 10,
      clipEndTime: 20,
      clipChannels: "front",
      createdAt: 123,
      clipStartAt: "2026-08-14T16:00:10.000Z",
      clipEndAt: "2026-08-14T16:00:20.000Z",
      hdr: true,
    },
  );
});

test("persists clip HDR metadata and reads legacy sidecars", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcam-clip-metadata-"));
  const outputPath = path.join(directory, "clip.mp4");
  try {
    const metadata = buildClipMetadata({
      videoId: "20260814_180000",
      clipStartTime: 0,
      clipEndTime: 5,
      clipChannels: "front",
      hdr: true,
    });
    writeClipMetadata(outputPath, metadata);
    assert.deepEqual(readClipMetadata(outputPath), metadata);

    writeFileSync(
      getClipMetadataPath(outputPath),
      JSON.stringify({
        videoId: "20260814_180000",
        clipStartTime: 0,
        clipEndTime: 5,
        clipChannels: "front",
        createdAt: 123,
      }),
    );
    assert.equal(readClipMetadata(outputPath)?.hdr, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("extracts the source recording id from generated clip filenames", () => {
  assert.equal(
    getGeneratedClipVideoId(
      "clip_20260814_180000_2026-08-14T16-00-10-000Z.mp4",
    ),
    "20260814_180000",
  );
  assert.equal(getGeneratedClipVideoId("renamed.mp4"), undefined);
});

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  createVideoPoi,
  deleteRecordingStartTime,
  deleteVideoPoi,
  getVideoPoiCount,
  getVideoPoiCounts,
  getVideoPois,
  getAllVideoPois,
  getAllVideoPoisMap,
  getRecordingAudioScan,
  getRecordingTimeZone,
  getRecordingTimeZones,
  getRecordingStartTime,
  getRecordingStartTimes,
  getRecordingOverlayMetadata,
  getRecordingOverlayMetadataMap,
  initDatabase,
  setRecordingOverlayMetadataCorrection,
  setRecordingTimeZone,
  setRecordingStartTime,
  upsertRecordingOverlayMetadata,
  replaceRecordingAudioEvents,
} from "./database";

test("persists, orders, and deletes video POIs within their recording", () => {
  const mediaDir = mkdtempSync(path.join(tmpdir(), "dashcam-viewer-pois-"));
  initDatabase(mediaDir);

  try {
    createVideoPoi({
      id: "later",
      videoId: "recording-a",
      timeSec: 20,
      label: "Later POI",
      createdAt: 2,
    });
    createVideoPoi({
      id: "earlier",
      videoId: "recording-a",
      timeSec: 10,
      label: "Earlier POI",
      createdAt: 1,
    });

    assert.deepEqual(
      getVideoPois("recording-a").map((poi) => poi.id),
      ["earlier", "later"],
    );
    assert.equal(getVideoPoiCount("recording-a"), 2);
    assert.equal(getVideoPoiCount("recording-b"), 0);
    assert.deepEqual([...getVideoPoiCounts()], [["recording-a", 2]]);
    assert.equal(deleteVideoPoi("recording-b", "earlier"), false);
    assert.equal(deleteVideoPoi("recording-a", "earlier"), true);
    assert.deepEqual(
      getVideoPois("recording-a").map((poi) => poi.id),
      ["later"],
    );
    assert.equal(getVideoPoiCount("recording-a"), 1);

    replaceRecordingAudioEvents(
      {
        videoId: "recording-a",
        sourceSignature: "source-v1",
        detectorVersion: 1,
        status: "scanned",
        scannedAt: 100,
      },
      [
        {
          id: "automatic-save",
          videoId: "recording-a",
          timeSec: 254.465,
          label: "Recording saved",
          kind: "camera-save",
          createdAt: 100,
        },
      ],
    );
    assert.deepEqual(getRecordingAudioScan("recording-a"), {
      videoId: "recording-a",
      sourceSignature: "source-v1",
      detectorVersion: 1,
      status: "scanned",
      scannedAt: 100,
    });
    assert.deepEqual(
      getAllVideoPois("recording-a").map((poi) => [poi.id, poi.kind]),
      [
        ["later", "manual"],
        ["automatic-save", "camera-save"],
      ],
    );
    assert.equal(getAllVideoPoisMap().get("recording-a")?.length, 2);
    assert.equal(getVideoPoiCount("recording-a"), 2);
    assert.deepEqual([...getVideoPoiCounts()], [["recording-a", 2]]);
    assert.equal(deleteVideoPoi("recording-a", "automatic-save"), false);

    assert.equal(getRecordingTimeZone("recording-a"), undefined);
    setRecordingTimeZone("recording-a", "Europe/Berlin");
    setRecordingTimeZone("recording-b", "Etc/GMT-2");
    setRecordingTimeZone("recording-a", "Europe/Budapest");
    assert.equal(getRecordingTimeZone("recording-a"), "Europe/Budapest");
    assert.deepEqual([...getRecordingTimeZones()].sort(), [
      ["recording-a", "Europe/Budapest"],
      ["recording-b", "Etc/GMT-2"],
    ]);

    assert.equal(getRecordingStartTime("recording-a"), undefined);
    setRecordingStartTime("recording-a", "2026-05-09T16:53:56.000Z");
    setRecordingStartTime("recording-b", "2026-05-09T17:00:00.000Z");
    setRecordingStartTime("recording-a", "2026-05-09T16:54:00.000Z");
    assert.equal(
      getRecordingStartTime("recording-a"),
      "2026-05-09T16:54:00.000Z",
    );
    assert.equal(getAllVideoPois("recording-a").at(-1)?.kind, "camera-save");
    assert.deepEqual([...getRecordingStartTimes()].sort(), [
      ["recording-a", "2026-05-09T16:54:00.000Z"],
      ["recording-b", "2026-05-09T17:00:00.000Z"],
    ]);
    deleteRecordingStartTime("recording-b");
    assert.equal(getRecordingStartTime("recording-b"), undefined);

    assert.equal(getRecordingOverlayMetadata("recording-a"), undefined);
    upsertRecordingOverlayMetadata({
      videoId: "recording-a",
      cameraType: "VIOFO A139 PRO",
      licensePlate: "TEST123",
      sourcePath: "RO/recording-a.mp4",
      sourceMtimeMs: 1234,
      extractorVersion: 1,
      status: "found",
      scannedAt: 5678,
      frameTimeSec: 30,
    });
    assert.deepEqual(getRecordingOverlayMetadata("recording-a"), {
      videoId: "recording-a",
      cameraType: "VIOFO A139 PRO",
      licensePlate: "TEST123",
      sourcePath: "RO/recording-a.mp4",
      sourceMtimeMs: 1234,
      extractorVersion: 1,
      status: "found",
      scannedAt: 5678,
      frameTimeSec: 30,
    });
    assert.equal(getRecordingOverlayMetadataMap().size, 1);

    setRecordingOverlayMetadataCorrection({
      videoId: "recording-a",
      cameraType: "Corrected camera",
      licensePlate: "MANUAL",
      sourcePath: "RO/recording-a.mp4",
      sourceMtimeMs: 1234,
      extractorVersion: 1,
    });
    upsertRecordingOverlayMetadata({
      videoId: "recording-a",
      cameraType: "Different OCR camera",
      licensePlate: "OCRVALUE",
      sourcePath: "RO/recording-a.mp4",
      sourceMtimeMs: 2345,
      extractorVersion: 2,
      status: "found",
      scannedAt: 6789,
      frameTimeSec: 60,
    });
    assert.deepEqual(getRecordingOverlayMetadata("recording-a"), {
      videoId: "recording-a",
      cameraType: "Corrected camera",
      licensePlate: "MANUAL",
      sourcePath: "RO/recording-a.mp4",
      sourceMtimeMs: 2345,
      extractorVersion: 2,
      status: "found",
      scannedAt: 6789,
      frameTimeSec: 60,
    });

    closeDatabase();
    initDatabase(mediaDir);
    assert.equal(getRecordingTimeZone("recording-a"), "Europe/Budapest");
    assert.equal(
      getRecordingStartTime("recording-a"),
      "2026-05-09T16:54:00.000Z",
    );
    assert.equal(
      getRecordingOverlayMetadata("recording-a")?.cameraType,
      "Corrected camera",
    );
    assert.equal(
      getRecordingOverlayMetadata("recording-a")?.licensePlate,
      "MANUAL",
    );
  } finally {
    closeDatabase();
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("migrates existing overlay metadata before saving corrections", () => {
  const mediaDir = mkdtempSync(path.join(tmpdir(), "dashcam-viewer-ocr-"));
  const legacyDatabase = new Database(
    path.join(mediaDir, ".dashcam-viewer.db"),
  );
  legacyDatabase.exec(`
    CREATE TABLE recording_overlay_metadata (
      video_id TEXT PRIMARY KEY,
      camera_type TEXT,
      license_plate TEXT,
      source_path TEXT NOT NULL,
      source_mtime_ms REAL NOT NULL,
      extractor_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      scanned_at INTEGER NOT NULL,
      frame_time_sec REAL
    );
    INSERT INTO recording_overlay_metadata VALUES
      ('recording-a', 'Legacy camera', NULL, 'recording-a.mp4', 100, 1, 'found', 200, 0);
  `);
  legacyDatabase.close();

  initDatabase(mediaDir);
  try {
    assert.equal(
      getRecordingOverlayMetadata("recording-a")?.cameraType,
      "Legacy camera",
    );
    setRecordingOverlayMetadataCorrection({
      videoId: "recording-a",
      cameraType: "Corrected camera",
      sourcePath: "recording-a.mp4",
      sourceMtimeMs: 100,
      extractorVersion: 1,
    });
    assert.equal(
      getRecordingOverlayMetadata("recording-a")?.cameraType,
      "Corrected camera",
    );
  } finally {
    closeDatabase();
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

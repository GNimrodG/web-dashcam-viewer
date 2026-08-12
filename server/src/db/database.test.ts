import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  createVideoPoi,
  deleteVideoPoi,
  getVideoPoiCount,
  getVideoPoiCounts,
  getVideoPois,
  getRecordingTimeZone,
  getRecordingTimeZones,
  initDatabase,
  setRecordingTimeZone,
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

    assert.equal(getRecordingTimeZone("recording-a"), undefined);
    setRecordingTimeZone("recording-a", "Europe/Berlin");
    setRecordingTimeZone("recording-b", "Etc/GMT-2");
    setRecordingTimeZone("recording-a", "Europe/Budapest");
    assert.equal(getRecordingTimeZone("recording-a"), "Europe/Budapest");
    assert.deepEqual([...getRecordingTimeZones()].sort(), [
      ["recording-a", "Europe/Budapest"],
      ["recording-b", "Etc/GMT-2"],
    ]);

    closeDatabase();
    initDatabase(mediaDir);
    assert.equal(getRecordingTimeZone("recording-a"), "Europe/Budapest");
  } finally {
    closeDatabase();
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

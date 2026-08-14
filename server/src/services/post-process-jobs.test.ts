import assert from "node:assert/strict";
import test from "node:test";
import type { VideoPair } from "../types.js";
import {
  audioJobStatus,
  createRuntimeLookup,
  gpsJobStatus,
  overlayJobStatus,
} from "./post-process-jobs.js";

const emptyRuntime = createRuntimeLookup([], []);

function pair(overrides: Partial<VideoPair> = {}): VideoPair {
  return {
    id: "20260814_120000",
    channels: {
      front: {
        path: "recording.mp4",
        filename: "recording.mp4",
        size: 100,
        mtimeMs: 10,
      },
    },
    ...overrides,
  };
}

test("queued runtime state takes priority over a completed OCR result", () => {
  const status = overlayJobStatus(
    pair({
      overlayMetadataOcrStatus: "found",
      overlayMetadataScannedAt: 100,
    }),
    {
      state: "ready",
      message: "available",
      limit: 1,
      extractorVersion: 2,
      processing: [],
      queued: [],
      summary: {
        total: 1,
        notProcessed: 0,
        pending: 0,
        found: 1,
        notFound: 0,
        failed: 0,
      },
    },
    createRuntimeLookup(
      [],
      [
        { id: "other", queuedAt: 10 },
        { id: "20260814_120000", queuedAt: 20 },
      ],
    ),
  );

  assert.equal(status.state, "queued");
  assert.equal(status.message, "Waiting in the processing queue (#2)");
  assert.equal(status.retryable, false);
});

test("reports disabled beep detection when no current scan exists", () => {
  const status = audioJobStatus(
    pair(),
    { enabled: false, limit: 1, processing: [], queued: [] },
    emptyRuntime,
    undefined,
    0,
  );
  assert.deepEqual(status, {
    state: "disabled",
    message: "Camera-save beep detection is disabled",
    retryable: false,
  });
});

test("distinguishes GPS data, no-data, and disabled results", () => {
  assert.equal(
    gpsJobStatus(
      pair({
        channels: {
          front: {
            path: "recording.mp4",
            filename: "recording.mp4",
            size: 100,
            gpsExtractionVersion: 2,
            noGps: false,
          },
        },
      }),
      emptyRuntime,
    ).state,
    "completed",
  );
  assert.equal(
    gpsJobStatus(
      pair({
        channels: {
          front: {
            path: "recording.mp4",
            filename: "recording.mp4",
            size: 100,
            gpsExtractionVersion: 2,
            noGps: true,
          },
        },
      }),
      emptyRuntime,
    ).state,
    "no-data",
  );
  assert.deepEqual(gpsJobStatus(pair({ gpsDisabled: true }), emptyRuntime), {
    state: "disabled",
    message: "GPS is disabled for this recording",
    retryable: false,
  });
});

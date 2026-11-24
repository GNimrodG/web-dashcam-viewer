import assert from "node:assert/strict";
import test from "node:test";
import type { VideoPair } from "../types.js";
import {
  audioJobStatus,
  createRuntimeLookup,
  gpsJobStatus,
  overlayJobStatus,
} from "./post-process-jobs.js";
import { getAudioSourceSignature } from "./audio-events.js";

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

test("reports live OCR progress for a running job", () => {
  const progress = {
    current: 12,
    total: 33,
    percent: 36,
    label: "Sampling 12 of 30 frames",
  };
  const status = overlayJobStatus(
    pair(),
    {
      state: "ready",
      message: "available",
      limit: 1,
      extractorVersion: 2,
      processing: [],
      queued: [],
      summary: {
        total: 1,
        notProcessed: 1,
        pending: 0,
        found: 0,
        notFound: 0,
        failed: 0,
      },
    },
    createRuntimeLookup(
      [{ id: "20260814_120000", startedAt: 100, progress }],
      [],
    ),
  );

  assert.equal(status.state, "running");
  assert.equal(status.message, progress.label);
  assert.deepEqual(status.progress, progress);
});

test("reports unreadable recordings as unavailable for OCR", () => {
  const status = overlayJobStatus(
    pair(),
    {
      state: "ready",
      message: "available",
      limit: 1,
      extractorVersion: 3,
      processing: [],
      queued: [],
      summary: {
        total: 1,
        notProcessed: 1,
        pending: 0,
        found: 0,
        notFound: 0,
        failed: 0,
      },
    },
    emptyRuntime,
  );

  assert.deepEqual(status, {
    state: "unavailable",
    message:
      "Recording duration is unavailable; the video may be incomplete or unreadable",
    retryable: false,
  });
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

test("reports a silent audio track separately from a missing track", () => {
  const scanner = { enabled: true, limit: 1, processing: [], queued: [] };
  const videoPair = pair();
  const sourceSignature = getAudioSourceSignature(videoPair);
  const silent = audioJobStatus(
    videoPair,
    scanner,
    emptyRuntime,
    {
      videoId: "20260814_120000",
      sourceSignature,
      detectorVersion: 2,
      status: "silent",
      scannedAt: 100,
    },
    0,
  );
  const noAudio = audioJobStatus(
    videoPair,
    scanner,
    emptyRuntime,
    {
      videoId: "20260814_120000",
      sourceSignature,
      detectorVersion: 2,
      status: "no-audio",
      scannedAt: 100,
    },
    0,
  );

  assert.equal(silent.message, "Audio track contains only silence");
  assert.equal(noAudio.message, "No audio stream was available");
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

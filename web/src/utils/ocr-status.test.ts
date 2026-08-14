import assert from "node:assert/strict";
import test from "node:test";
import type { VideoPair } from "../api";
import { getOcrStatusInfo } from "./ocr-status";

const pair = (overrides: Partial<VideoPair> = {}): VideoPair => ({
  id: "20260101_120000",
  channels: {},
  ...overrides,
});

test("distinguishes recordings that were never processed from no-match OCR", () => {
  assert.deepEqual(getOcrStatusInfo(pair()), {
    label: "OCR not processed",
    description: "No completed OCR run is recorded for this recording.",
    color: "neutral",
    processed: false,
  });
  assert.equal(
    getOcrStatusInfo(pair({ overlayMetadataOcrStatus: "not-found" })).label,
    "OCR checked · no match",
  );
});

test("does not present manually entered metadata as a completed OCR run", () => {
  const status = getOcrStatusInfo(
    pair({
      cameraType: "Corrected camera",
      overlayMetadataStatus: "found",
      overlayMetadataOverridden: true,
    }),
  );
  assert.equal(status.label, "OCR not processed · manually set");
  assert.equal(status.processed, false);
});

test("reports pending, successful, and failed OCR distinctly", () => {
  assert.equal(
    getOcrStatusInfo(pair({ overlayMetadataStatus: "pending" })).label,
    "OCR queued",
  );
  assert.equal(
    getOcrStatusInfo(pair({ overlayMetadataOcrStatus: "found" })).label,
    "OCR processed",
  );
  assert.equal(
    getOcrStatusInfo(pair({ overlayMetadataOcrStatus: "failed" })).label,
    "OCR failed",
  );
});

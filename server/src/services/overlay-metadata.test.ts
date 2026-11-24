import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOverlayOcrError,
  getOverlayMetadataScanIssue,
  getOverlaySampleTimes,
  summarizeOverlayMetadataStatuses,
  type OverlayMetadataCandidate,
  parseOverlayOcrConcurrency,
  parseOverlayOcrProcessTimeout,
  parseOverlayTsv,
  runOverlayQueueTask,
  selectBestOverlayMetadata,
} from "./overlay-metadata.js";
import type { VideoPair } from "../types.js";

function statusPair(
  id: string,
  status?: VideoPair["overlayMetadataStatus"],
  ocrStatus?: VideoPair["overlayMetadataOcrStatus"],
): VideoPair {
  return {
    id,
    channels: {},
    overlayMetadataStatus: status,
    overlayMetadataOcrStatus: ocrStatus,
  };
}

test("distinguishes recordings that were never processed from completed OCR results", () => {
  assert.deepEqual(
    summarizeOverlayMetadataStatuses([
      statusPair("never-run"),
      statusPair("queued", "pending"),
      statusPair("found", "found", "found"),
      statusPair("no-match", "not-found", "not-found"),
      statusPair("failed", "failed", "failed"),
    ]),
    {
      total: 5,
      notProcessed: 1,
      pending: 1,
      found: 1,
      notFound: 1,
      failed: 1,
    },
  );
});

test("parses overlay OCR concurrency without an upper limit", () => {
  assert.equal(parseOverlayOcrConcurrency(undefined), 1);
  assert.equal(parseOverlayOcrConcurrency("2"), 2);
  assert.equal(parseOverlayOcrConcurrency("2.9"), 2);
  assert.equal(parseOverlayOcrConcurrency("0"), 1);
  assert.equal(parseOverlayOcrConcurrency("not-a-number"), 1);
  assert.equal(parseOverlayOcrConcurrency("180"), 180);
});

test("uses a bounded subprocess timeout for OCR tools", () => {
  assert.equal(parseOverlayOcrProcessTimeout(undefined), 30_000);
  assert.equal(parseOverlayOcrProcessTimeout("0"), 30_000);
  assert.equal(parseOverlayOcrProcessTimeout("45000"), 45_000);
});

test("releases OCR queue capacity after a failed task", async () => {
  let released = false;
  await assert.rejects(
    runOverlayQueueTask(
      async () => {
        throw new Error("invalid video");
      },
      () => {
        released = true;
      },
    ),
    /invalid video/,
  );
  assert.equal(released, true);
});

test("extracts camera type and plate from the spatial middle overlay block", () => {
  const header =
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const rows = [
    "1\t1\t0\t0\t0\t0\t0\t0\t7680\t180\t-1\t",
    "5\t1\t1\t1\t1\t1\t56\t28\t424\t78\t80\t025KM/H",
    "5\t1\t1\t1\t1\t2\t558\t28\t452\t82\t80\tN:47.4845",
    "5\t1\t1\t1\t1\t3\t1058\t28\t420\t82\t60\tE19.0536",
    "5\t1\t1\t1\t1\t4\t3408\t28\t292\t78\t88\tVIOFO",
    "5\t1\t1\t1\t1\t5\t3744\t28\t218\t78\t90\tA139",
    "5\t1\t1\t1\t1\t6\t4010\t28\t206\t78\t90\tPRO",
    "5\t1\t1\t1\t1\t7\t4282\t28\t376\t78\t48\tTEST123",
    "5\t1\t1\t1\t1\t8\t6252\t30\t202\t74\t87\tHDR",
    "5\t1\t1\t1\t1\t9\t6682\t28\t532\t78\t91\t2026/05/09",
  ];
  const result = parseOverlayTsv([header, ...rows].join("\n"));
  assert.equal(result?.cameraType, "VIOFO A139 PRO");
  assert.equal(result?.licensePlate, "TEST123");
  assert.equal(result?.hdr, true);
  assert.equal(result?.cameraConfidence, (88 + 90 + 90) / 3);
  assert.equal(result?.licensePlateConfidence, 48);
  assert.deepEqual(result?.plateBounds, {
    left: 4282,
    width: 376,
    pageWidth: 7680,
  });
});

test("rejects a line without a middle camera and plate block", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1920\t180\t-1\t",
    "5\t1\t1\t1\t1\t1\t10\t20\t200\t50\t90\t000KM/H",
    "5\t1\t1\t1\t1\t2\t1600\t20\t200\t50\t90\tHDR",
  ].join("\n");
  assert.equal(parseOverlayTsv(tsv), undefined);
});

test("samples three frames near every ten-percent checkpoint", () => {
  const times = getOverlaySampleTimes(100);
  assert.equal(times.length, 30);
  assert.deepEqual(times.slice(0, 6), [0, 0.5, 1, 10, 10.5, 11]);
  assert.deepEqual(times.slice(-3), [90, 90.5, 91]);
  assert.deepEqual(getOverlaySampleTimes(0), [0]);
});

test("does not queue overlay OCR for unreadable video sources", () => {
  assert.equal(
    getOverlayMetadataScanIssue({
      id: "unreadable",
      channels: {
        front: {
          path: "broken.mp4",
          filename: "broken.mp4",
          size: 100,
        },
      },
    }),
    "Recording duration is unavailable; the video may be incomplete or unreadable",
  );
  assert.equal(
    getOverlayMetadataScanIssue({
      id: "readable",
      channels: {
        front: {
          path: "video.mp4",
          filename: "video.mp4",
          size: 100,
          durationSec: 60,
        },
      },
    }),
    undefined,
  );
});

test("formats buffered ffmpeg errors as readable text", () => {
  assert.equal(
    formatOverlayOcrError({
      stderr: Buffer.from("moov atom not found\nInvalid data found"),
    }),
    "moov atom not found\nInvalid data found",
  );
});

test("prefers repeated OCR values over a single high-confidence result", () => {
  const candidates: OverlayMetadataCandidate[] = [
    {
      cameraType: "SINGLE CAMERA",
      licensePlate: "SINGLE",
      hdr: false,
      cameraConfidence: 99,
      licensePlateConfidence: 99,
      frameTimeSec: 0,
    },
    {
      cameraType: "CONSENSUS CAMERA",
      licensePlate: "CONSENSUS",
      hdr: true,
      cameraConfidence: 65,
      licensePlateConfidence: 60,
      frameTimeSec: 10,
    },
    {
      cameraType: "CONSENSUS CAMERA",
      licensePlate: "CONSENSUS",
      hdr: false,
      cameraConfidence: 55,
      licensePlateConfidence: 50,
      frameTimeSec: 20,
    },
  ];

  assert.deepEqual(selectBestOverlayMetadata(candidates), {
    cameraType: "CONSENSUS CAMERA",
    licensePlate: "CONSENSUS",
    hdr: true,
    frameTimeSec: 10,
  });
});

test("selects camera and plate consensus independently", () => {
  const candidates: OverlayMetadataCandidate[] = [
    {
      cameraType: "CAMERA A",
      licensePlate: "VALUE A",
      hdr: false,
      cameraConfidence: 70,
      licensePlateConfidence: 70,
      frameTimeSec: 10,
    },
    {
      cameraType: "CAMERA A",
      licensePlate: "VALUE B",
      hdr: false,
      cameraConfidence: 80,
      licensePlateConfidence: 80,
      frameTimeSec: 20,
    },
    {
      cameraType: "CAMERA B",
      licensePlate: "VALUE B",
      hdr: false,
      cameraConfidence: 90,
      licensePlateConfidence: 90,
      frameTimeSec: 30,
    },
  ];

  assert.deepEqual(selectBestOverlayMetadata(candidates), {
    cameraType: "CAMERA A",
    licensePlate: "VALUE B",
    hdr: false,
    frameTimeSec: 20,
  });
});

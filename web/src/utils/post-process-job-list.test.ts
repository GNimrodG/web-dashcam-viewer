import assert from "node:assert/strict";
import test from "node:test";
import type { PostProcessJobStatus } from "../api";
import {
  comparePostProcessJobsByExecutionOrder,
  isFinishedPostProcessJob,
  type PostProcessJobRow,
} from "./post-process-job-list";

function row(
  recordingId: string,
  state: PostProcessJobStatus["state"],
  updatedAt?: number,
): PostProcessJobRow {
  return {
    recordingId,
    kind: "overlay-ocr",
    job: { state, message: state, retryable: false, updatedAt },
  };
}

test("classifies completed and no-data jobs as finished", () => {
  assert.equal(isFinishedPostProcessJob(row("a", "completed").job), true);
  assert.equal(isFinishedPostProcessJob(row("a", "no-data").job), true);
  assert.equal(isFinishedPostProcessJob(row("a", "failed").job), false);
  assert.equal(isFinishedPostProcessJob(row("a", "queued").job), false);
});

test("orders jobs by execution sequence", () => {
  const jobs = [
    row("finished", "completed", 500),
    row("queued-later", "queued", 300),
    row("waiting", "not-processed"),
    row("running-later", "running", 200),
    row("queued-first", "queued", 100),
    row("running-first", "running", 50),
  ];

  jobs.sort(comparePostProcessJobsByExecutionOrder);

  assert.deepEqual(
    jobs.map((job) => job.recordingId),
    [
      "running-first",
      "running-later",
      "queued-first",
      "queued-later",
      "waiting",
      "finished",
    ],
  );
});

test("shows the most recently finished jobs first", () => {
  const jobs = [
    row("older", "completed", 100),
    row("newer", "no-data", 300),
    row("middle", "completed", 200),
  ];

  jobs.sort(comparePostProcessJobsByExecutionOrder);

  assert.deepEqual(
    jobs.map((job) => job.recordingId),
    ["newer", "middle", "older"],
  );
});

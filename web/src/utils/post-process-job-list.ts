import type {
  PostProcessJobStatus,
  PostProcessKind,
  RecordingPostProcessJobs,
} from "../api";
import { POST_PROCESS_KINDS } from "./post-process-jobs";

export interface PostProcessJobRow {
  recordingId: string;
  kind: PostProcessKind;
  job: PostProcessJobStatus;
}

export function flattenPostProcessJobs(
  recordings: readonly RecordingPostProcessJobs[],
): PostProcessJobRow[] {
  return recordings.flatMap((recording) =>
    POST_PROCESS_KINDS.map((kind) => ({
      recordingId: recording.id,
      kind,
      job: recording.jobs[kind],
    })),
  );
}

export function isFinishedPostProcessJob(job: PostProcessJobStatus): boolean {
  return job.state === "completed" || job.state === "no-data";
}

const EXECUTION_STATE_ORDER: Record<PostProcessJobStatus["state"], number> = {
  running: 0,
  queued: 1,
  failed: 2,
  "not-processed": 3,
  unavailable: 4,
  disabled: 5,
  completed: 6,
  "no-data": 6,
};

export function comparePostProcessJobsByExecutionOrder(
  left: PostProcessJobRow,
  right: PostProcessJobRow,
): number {
  const stateDifference =
    EXECUTION_STATE_ORDER[left.job.state] -
    EXECUTION_STATE_ORDER[right.job.state];
  if (stateDifference !== 0) return stateDifference;

  if (left.job.state === "running" || left.job.state === "queued") {
    const runtimeDifference =
      (left.job.updatedAt ?? Number.MAX_SAFE_INTEGER) -
      (right.job.updatedAt ?? Number.MAX_SAFE_INTEGER);
    if (runtimeDifference !== 0) return runtimeDifference;
  } else if (
    isFinishedPostProcessJob(left.job) &&
    isFinishedPostProcessJob(right.job)
  ) {
    const completionDifference =
      (right.job.updatedAt ?? 0) - (left.job.updatedAt ?? 0);
    if (completionDifference !== 0) return completionDifference;
  }

  const recordingDifference = right.recordingId.localeCompare(left.recordingId);
  if (recordingDifference !== 0) return recordingDifference;
  return (
    POST_PROCESS_KINDS.indexOf(left.kind) -
    POST_PROCESS_KINDS.indexOf(right.kind)
  );
}

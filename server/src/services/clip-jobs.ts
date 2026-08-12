import { randomUUID } from "node:crypto";
import type { ClipProgress } from "./clipper.js";
import { logger } from "../logger.js";

const JOB_RETENTION_MS = 60 * 60 * 1000;

export interface ClipJobResult {
  filename: string;
  downloadUrl: string;
}

export interface ClipJobStatus {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
  progress: ClipProgress;
  result?: ClipJobResult;
  error?: string;
  updatedAt: string;
}

const jobs = new Map<string, ClipJobStatus>();

function pruneExpiredJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    if (now - Date.parse(job.updatedAt) > JOB_RETENTION_MS) jobs.delete(id);
  }
}

export function startClipJob(
  durationSeconds: number,
  task: (
    onProgress: (progress: ClipProgress) => void,
  ) => Promise<ClipJobResult>,
): ClipJobStatus {
  pruneExpiredJobs();
  const id = randomUUID();
  const job: ClipJobStatus = {
    id,
    state: "queued",
    progress: {
      percent: 0,
      processedSeconds: 0,
      durationSeconds,
      phase: "encoding",
    },
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  void (async () => {
    job.state = "running";
    job.updatedAt = new Date().toISOString();
    try {
      job.result = await task((progress) => {
        job.progress = progress;
        job.updatedAt = new Date().toISOString();
      });
      job.state = "completed";
      job.progress = {
        percent: 100,
        processedSeconds: durationSeconds,
        durationSeconds,
        phase: "completed",
      };
    } catch (error) {
      job.state = "failed";
      job.error =
        error instanceof Error ? error.message : "Clip generation failed";
      logger.error({ error, clipJobId: id }, "Clip generation job failed");
    }
    job.updatedAt = new Date().toISOString();
  })();

  return job;
}

export function getClipJob(id: string): ClipJobStatus | undefined {
  pruneExpiredJobs();
  return jobs.get(id);
}

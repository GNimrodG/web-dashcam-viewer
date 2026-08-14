import { createHash } from "node:crypto";
import { execa } from "execa";
import {
  getAllVideoPois,
  getRecordingAudioScan,
  replaceRecordingAudioEvents,
  type RecordingAudioScan,
  type VideoPoi,
} from "../db/database.js";
import { logger } from "../logger.js";
import type { VideoFile, VideoPair } from "../types.js";
import { canonicalMediaPath } from "../utils/media-path.js";
import { processManager } from "../utils/process-manager.js";
import { ffprobe } from "./ffprobe.js";

export const AUDIO_EVENT_DETECTOR_VERSION = 2;
const SAMPLE_RATE = 8_000;
const SILENCE_THRESHOLD_DB = -60;
const WINDOW_SAMPLES = 240;
const HOP_SAMPLES = 40;
const TARGET_FREQUENCY_HZ = 2_000;
const AUDIO_EVENT_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUDIO_EVENT_CONCURRENCY) || 1,
);

interface TonePulse {
  startSec: number;
  endSec: number;
  peakSec: number;
  score: number;
}

interface ScanJob {
  pair: VideoPair;
  queuedAt: number;
  force: boolean;
  resolve: (pois: VideoPoi[]) => void;
  reject: (error: unknown) => void;
}

const queue: ScanJob[] = [];
const jobsById = new Map<string, ScanJob>();
const activeScans = new Map<string, Promise<VideoPoi[]>>();
const activeScanStartedAt = new Map<string, number>();
let activeCount = 0;
let scannerTimer: NodeJS.Timeout | undefined;
let scannerEnabled = process.env.AUDIO_EVENT_DETECTION_ENABLED !== "0";

export function getAudioEventScannerStatus() {
  return {
    enabled: scannerEnabled,
    limit: AUDIO_EVENT_CONCURRENCY,
    processing: [...activeScanStartedAt].map(([id, startedAt]) => ({
      id,
      startedAt,
    })),
    queued: queue.map((job) => ({
      id: job.pair.id,
      queuedAt: job.queuedAt,
    })),
  };
}

function goertzelPower(
  pcm: Int16Array,
  start: number,
  length: number,
  frequencyHz: number,
  sampleRate: number,
): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequencyHz) / sampleRate);
  let previous = 0;
  let previousPrevious = 0;
  for (let index = 0; index < length; index++) {
    const sample = pcm[start + index] / 32768;
    const current = sample + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }
  return (
    previous * previous +
    previousPrevious * previousPrevious -
    coefficient * previous * previousPrevious
  );
}

export function detectCameraSaveEvents(
  pcm: Int16Array,
  sampleRate = SAMPLE_RATE,
): number[] {
  const windowSamples = Math.round((WINDOW_SAMPLES * sampleRate) / SAMPLE_RATE);
  const hopSamples = Math.round((HOP_SAMPLES * sampleRate) / SAMPLE_RATE);
  const toneWindows: Array<{ timeSec: number; score: number }> = [];

  for (
    let start = 0;
    start + windowSamples <= pcm.length;
    start += hopSamples
  ) {
    let energy = 0;
    for (let offset = 0; offset < windowSamples; offset++) {
      const sample = pcm[start + offset] / 32768;
      energy += sample * sample;
    }
    if (energy <= 1e-12) continue;

    const targetPower = goertzelPower(
      pcm,
      start,
      windowSamples,
      TARGET_FREQUENCY_HZ,
      sampleRate,
    );
    const toneRatio = targetPower / (windowSamples * energy + 1e-20);
    const rmsDb = 10 * Math.log10(energy / windowSamples + 1e-20);
    if (toneRatio > 0.015 && rmsDb > -45) {
      toneWindows.push({
        timeSec: (start + windowSamples / 2) / sampleRate,
        score: toneRatio,
      });
    }
  }

  const pulses: TonePulse[] = [];
  for (const window of toneWindows) {
    const previous = pulses.at(-1);
    if (!previous || window.timeSec - previous.endSec > 0.05) {
      pulses.push({
        startSec: window.timeSec,
        endSec: window.timeSec,
        peakSec: window.timeSec,
        score: window.score,
      });
      continue;
    }
    previous.endSec = window.timeSec;
    if (window.score > previous.score) {
      previous.score = window.score;
      previous.peakSec = window.timeSec;
    }
  }

  const events: number[] = [];
  for (let index = 0; index + 5 < pulses.length; index++) {
    const candidate = pulses.slice(index, index + 6);
    const gaps = candidate.slice(1).map((pulse, pulseIndex) => {
      return pulse.startSec - candidate[pulseIndex].startSec;
    });
    const matchesThreeDoubleBeeps =
      gaps[0] >= 0.1 &&
      gaps[0] <= 0.21 &&
      gaps[1] >= 0.22 &&
      gaps[1] <= 0.4 &&
      gaps[2] >= 0.1 &&
      gaps[2] <= 0.21 &&
      gaps[3] >= 0.22 &&
      gaps[3] <= 0.4 &&
      gaps[4] >= 0.1 &&
      gaps[4] <= 0.21;
    if (!matchesThreeDoubleBeeps) continue;

    const eventTime = candidate[0].startSec;
    if (!events.some((existing) => Math.abs(existing - eventTime) < 1)) {
      events.push(eventTime);
    }
    index += 5;
  }
  return events;
}

export function isSilentAudio(pcm: Int16Array): boolean {
  if (pcm.length === 0) return true;

  let sumSquares = 0;
  for (const sample of pcm) {
    const normalized = sample / 32768;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / pcm.length);
  const rmsDb = 20 * Math.log10(rms || Number.EPSILON);
  return rmsDb <= SILENCE_THRESHOLD_DB;
}

export function getAudioSourceSignature(pair: VideoPair): string {
  const sources = Object.entries(pair.channels)
    .filter((entry): entry is [string, VideoFile] => Boolean(entry[1]))
    .map(([channel, file]) => ({
      channel,
      path: canonicalMediaPath(file.path),
      size: file.size,
      mtimeMs: file.mtimeMs ?? 0,
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
}

export function isRecordingAudioScanCurrent(
  pair: VideoPair,
  scan: RecordingAudioScan | undefined,
): scan is RecordingAudioScan {
  return Boolean(
    scan?.detectorVersion === AUDIO_EVENT_DETECTOR_VERSION &&
      scan.sourceSignature === getAudioSourceSignature(pair),
  );
}

export type RecordingAudioStatus =
  | "pending"
  | "present"
  | "silent"
  | "no-audio"
  | "failed";

export function getRecordingAudioStatus(
  pair: VideoPair,
  scan: RecordingAudioScan | undefined,
  enabled = scannerEnabled,
): RecordingAudioStatus | undefined {
  if (isRecordingAudioScanCurrent(pair, scan)) {
    if (scan.status === "scanned") return "present";
    return scan.status;
  }

  const important = Object.values(pair.channels).some(
    (channel) => channel?.important,
  );
  return enabled && important ? "pending" : undefined;
}

function hasCurrentScan(pair: VideoPair): boolean {
  const scan = getRecordingAudioScan(pair.id);
  return isRecordingAudioScanCurrent(pair, scan) && scan.status !== "failed";
}

async function findAudioSource(
  pair: VideoPair,
): Promise<VideoFile | undefined> {
  const sources = [pair.channels.front, pair.channels.rear].filter(
    (source): source is VideoFile => Boolean(source),
  );
  let inspectedSources = 0;
  for (const source of sources) {
    try {
      const metadata = await ffprobe(source.path);
      inspectedSources++;
      if (
        metadata.streams.some(
          (stream) => stream.codec_type === "audio" && stream.codec_name,
        )
      ) {
        return source;
      }
    } catch (error) {
      logger.warn(
        { error, videoId: pair.id, filePath: source.path },
        "Failed to inspect recording audio",
      );
    }
  }
  if (sources.length > 0 && inspectedSources === 0) {
    throw new Error("Could not inspect any recording audio source");
  }
  return undefined;
}

async function extractMonoPcm(
  source: VideoFile,
  durationSec: number,
): Promise<Int16Array> {
  const maxBuffer = Math.max(
    16 * 1024 * 1024,
    Math.min(
      256 * 1024 * 1024,
      Math.ceil((durationSec + 10) * SAMPLE_RATE * 2),
    ),
  );
  const proc = execa(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      source.path,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer },
  );
  processManager.register(proc);
  const output = (await proc).stdout;
  return new Int16Array(
    output.buffer,
    output.byteOffset,
    Math.floor(output.byteLength / 2),
  );
}

async function scanPair(pair: VideoPair, force = false): Promise<VideoPoi[]> {
  if (!force && hasCurrentScan(pair)) return getAllVideoPois(pair.id);

  const sourceSignature = getAudioSourceSignature(pair);
  const scannedAt = Date.now();
  try {
    const source = await findAudioSource(pair);
    if (!source) {
      replaceRecordingAudioEvents(
        {
          videoId: pair.id,
          sourceSignature,
          detectorVersion: AUDIO_EVENT_DETECTOR_VERSION,
          status: "no-audio",
          scannedAt,
        },
        [],
      );
      return getAllVideoPois(pair.id);
    }

    const pcm = await extractMonoPcm(
      source,
      pair.durationSec ?? source.durationSec ?? 0,
    );
    if (isSilentAudio(pcm)) {
      replaceRecordingAudioEvents(
        {
          videoId: pair.id,
          sourceSignature,
          detectorVersion: AUDIO_EVENT_DETECTOR_VERSION,
          status: "silent",
          scannedAt,
        },
        [],
      );
      logger.info({ videoId: pair.id }, "Recording audio track is silent");
      return getAllVideoPois(pair.id);
    }

    const eventTimes = detectCameraSaveEvents(pcm);
    const events = eventTimes.map(
      (timeSec): VideoPoi => ({
        id: `audio-camera-save-${pair.id}-${Math.round(timeSec * 1000)}`,
        videoId: pair.id,
        timeSec,
        label: "Recording saved",
        kind: "camera-save",
        createdAt: scannedAt,
      }),
    );
    replaceRecordingAudioEvents(
      {
        videoId: pair.id,
        sourceSignature,
        detectorVersion: AUDIO_EVENT_DETECTOR_VERSION,
        status: "scanned",
        scannedAt,
      },
      events,
    );
    logger.info(
      { videoId: pair.id, count: events.length, eventTimes },
      "Finished camera save beep detection",
    );
    return getAllVideoPois(pair.id);
  } catch (error) {
    replaceRecordingAudioEvents(
      {
        videoId: pair.id,
        sourceSignature,
        detectorVersion: AUDIO_EVENT_DETECTOR_VERSION,
        status: "failed",
        scannedAt,
      },
      [],
    );
    logger.warn(
      { error, videoId: pair.id },
      "Camera save beep detection failed",
    );
    throw error;
  }
}

function processQueue(): void {
  while (activeCount < AUDIO_EVENT_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    jobsById.delete(job.pair.id);
    activeCount++;
    const promise = scanPair(job.pair, job.force);
    activeScans.set(job.pair.id, promise);
    activeScanStartedAt.set(job.pair.id, Date.now());
    promise.then(job.resolve, job.reject).finally(() => {
      activeCount--;
      activeScans.delete(job.pair.id);
      activeScanStartedAt.delete(job.pair.id);
      processQueue();
    });
  }
}

function enqueuePair(
  pair: VideoPair,
  prioritize: boolean,
  force = false,
): Promise<VideoPoi[]> {
  if (!force && hasCurrentScan(pair)) {
    return Promise.resolve(getAllVideoPois(pair.id));
  }
  const active = activeScans.get(pair.id);
  if (active) return active;
  const existing = jobsById.get(pair.id);
  if (existing) {
    existing.force ||= force;
    if (prioritize) {
      const index = queue.indexOf(existing);
      if (index > 0) {
        queue.splice(index, 1);
        queue.unshift(existing);
      }
    }
    return new Promise((resolve, reject) => {
      const originalResolve = existing.resolve;
      const originalReject = existing.reject;
      existing.resolve = (value) => {
        originalResolve(value);
        resolve(value);
      };
      existing.reject = (error) => {
        originalReject(error);
        reject(error);
      };
    });
  }

  const promise = new Promise<VideoPoi[]>((resolve, reject) => {
    const job = { pair, queuedAt: Date.now(), force, resolve, reject };
    jobsById.set(pair.id, job);
    if (prioritize) queue.unshift(job);
    else queue.push(job);
  });
  processQueue();
  return promise;
}

export function ensureRecordingAudioEvents(
  pair: VideoPair,
): Promise<VideoPoi[]> {
  if (process.env.AUDIO_EVENT_DETECTION_ENABLED === "0") {
    return Promise.resolve(getAllVideoPois(pair.id));
  }
  return enqueuePair(pair, true);
}

export function retryRecordingAudioEvents(
  pair: VideoPair,
): Promise<VideoPoi[]> {
  if (!scannerEnabled) {
    throw new Error("Camera-save beep detection is disabled");
  }
  return enqueuePair(pair, true, true);
}

function enqueueUnscannedPairs(pairs: readonly VideoPair[]): void {
  const importantPairs = pairs.filter((pair) =>
    Object.values(pair.channels).some((channel) => channel?.important),
  );
  for (const pair of [...importantPairs].reverse()) {
    if (
      !hasCurrentScan(pair) &&
      !jobsById.has(pair.id) &&
      !activeScans.has(pair.id)
    ) {
      void enqueuePair(pair, false).catch(() => undefined);
    }
  }
}

export function startAudioEventScanner(getPairs: () => VideoPair[]): void {
  if (process.env.AUDIO_EVENT_DETECTION_ENABLED === "0") {
    scannerEnabled = false;
    logger.info("Camera save beep detection is disabled");
    return;
  }
  scannerEnabled = true;
  enqueueUnscannedPairs(getPairs());
  scannerTimer = setInterval(() => enqueueUnscannedPairs(getPairs()), 30_000);
  scannerTimer.unref();
}

import {
  getRecordingAudioScan,
  getRecordingAudioScans,
  getVideoPoiTypeCounts,
  getVideoPoiTypeCountsMap,
  type RecordingAudioScan,
} from "../db/database.js";
import { logger } from "../logger.js";
import type { VideoPair } from "../types.js";
import { GPS_EXTRACTION_VERSION } from "./gps.js";
import {
  getGpsExtractionQueueStatus,
  getRecentGpsExtractionResult,
  getVideoPairById,
  getVideoPairs,
  retryGpsExtractionForPair,
} from "./indexer.js";
import {
  getAudioEventScannerStatus,
  isRecordingAudioScanCurrent,
  retryRecordingAudioEvents,
} from "./audio-events.js";
import {
  getOverlayMetadataScannerStatus,
  retryOverlayMetadataScan,
} from "./overlay-metadata.js";

export type PostProcessKind = "overlay-ocr" | "audio-events" | "gps-extraction";

export type PostProcessJobState =
  | "not-processed"
  | "queued"
  | "running"
  | "completed"
  | "no-data"
  | "failed"
  | "disabled"
  | "unavailable";

export interface PostProcessJobStatus {
  state: PostProcessJobState;
  message: string;
  retryable: boolean;
  updatedAt?: number;
  progress?: {
    current: number;
    total: number;
    percent: number;
    label: string;
  };
}

export interface RecordingPostProcessJobs {
  id: string;
  startTime?: string;
  jobs: Record<PostProcessKind, PostProcessJobStatus>;
}

export interface RuntimeLookup {
  processing: Map<
    string,
    {
      startedAt: number;
      progress?: PostProcessJobStatus["progress"];
    }
  >;
  queued: Map<string, { queuedAt: number; position: number }>;
}

interface ScannerSnapshots {
  overlay: ReturnType<typeof getOverlayMetadataScannerStatus>;
  audio: ReturnType<typeof getAudioEventScannerStatus>;
  gps: ReturnType<typeof getGpsExtractionQueueStatus>;
}

export function createRuntimeLookup(
  processing: readonly {
    id: string;
    startedAt: number;
    progress?: PostProcessJobStatus["progress"];
  }[],
  queued: readonly { id: string; queuedAt: number }[],
): RuntimeLookup {
  return {
    processing: new Map(
      processing.map((item) => [
        item.id,
        { startedAt: item.startedAt, progress: item.progress },
      ]),
    ),
    queued: new Map(
      queued.map((item, index) => [
        item.id,
        { queuedAt: item.queuedAt, position: index + 1 },
      ]),
    ),
  };
}

function runtimeState(
  id: string,
  runtime: RuntimeLookup,
): PostProcessJobStatus | undefined {
  const processing = runtime.processing.get(id);
  if (processing !== undefined) {
    return {
      state: "running",
      message: processing.progress?.label ?? "Processing now",
      retryable: false,
      updatedAt: processing.startedAt,
      progress: processing.progress,
    };
  }
  const pending = runtime.queued.get(id);
  if (pending) {
    return {
      state: "queued",
      message: `Waiting in the processing queue (#${pending.position})`,
      retryable: false,
      updatedAt: pending.queuedAt,
    };
  }
  return undefined;
}

export function overlayJobStatus(
  pair: VideoPair,
  scanner: ReturnType<typeof getOverlayMetadataScannerStatus>,
  runtime: RuntimeLookup,
): PostProcessJobStatus {
  const active = runtimeState(pair.id, runtime);
  if (active) return active;
  const retryable = scanner.state === "ready";
  switch (pair.overlayMetadataOcrStatus) {
    case "found":
      return {
        state: "completed",
        message: "Camera overlay metadata found",
        retryable,
        updatedAt: pair.overlayMetadataScannedAt,
      };
    case "not-found":
      return {
        state: "no-data",
        message: "No usable camera overlay metadata found",
        retryable,
        updatedAt: pair.overlayMetadataScannedAt,
      };
    case "failed":
      return {
        state: "failed",
        message: "Camera overlay OCR failed",
        retryable,
        updatedAt: pair.overlayMetadataScannedAt,
      };
  }
  if (scanner.state === "disabled") {
    return {
      state: "disabled",
      message: scanner.message,
      retryable: false,
    };
  }
  if (scanner.state === "unavailable") {
    return {
      state: "unavailable",
      message: scanner.message,
      retryable: false,
    };
  }
  return {
    state: "not-processed",
    message: "OCR has not run for this recording",
    retryable,
  };
}

export function audioJobStatus(
  pair: VideoPair,
  scanner: ReturnType<typeof getAudioEventScannerStatus>,
  runtime: RuntimeLookup,
  scan: RecordingAudioScan | undefined,
  eventCount: number,
): PostProcessJobStatus {
  const active = runtimeState(pair.id, runtime);
  if (active) return active;
  if (scan && isRecordingAudioScanCurrent(pair, scan)) {
    switch (scan.status) {
      case "scanned":
        return {
          state: "completed",
          message: `${eventCount} saving beep event${eventCount === 1 ? "" : "s"} detected`,
          retryable: scanner.enabled,
          updatedAt: scan.scannedAt,
        };
      case "no-audio":
        return {
          state: "no-data",
          message: "No audio stream was available",
          retryable: scanner.enabled,
          updatedAt: scan.scannedAt,
        };
      case "silent":
        return {
          state: "no-data",
          message: "Audio track contains only silence",
          retryable: scanner.enabled,
          updatedAt: scan.scannedAt,
        };
      case "failed":
        return {
          state: "failed",
          message: "Saving beep detection failed",
          retryable: scanner.enabled,
          updatedAt: scan.scannedAt,
        };
    }
  }
  if (!scanner.enabled) {
    return {
      state: "disabled",
      message: "Camera-save beep detection is disabled",
      retryable: false,
    };
  }
  return {
    state: "not-processed",
    message: scan
      ? "The recording changed since the previous beep scan"
      : "Saving beep detection has not run for this recording",
    retryable: true,
  };
}

export function gpsJobStatus(
  pair: VideoPair,
  runtime: RuntimeLookup,
): PostProcessJobStatus {
  const active = runtimeState(pair.id, runtime);
  if (active) return active;
  const recent = getRecentGpsExtractionResult(pair.id);
  if (recent?.state === "failed") {
    return {
      state: "failed",
      message: recent.error || "GPS extraction failed",
      retryable: !pair.gpsDisabled,
      updatedAt: recent.finishedAt,
    };
  }
  if (pair.gpsDisabled) {
    return {
      state: "disabled",
      message: "GPS is disabled for this recording",
      retryable: false,
    };
  }
  if (pair.hasExternalGps) {
    return {
      state: "completed",
      message: "External GPX data is active",
      retryable: true,
      updatedAt: recent?.finishedAt,
    };
  }

  const channels = [pair.channels.front, pair.channels.rear].filter(
    (channel): channel is NonNullable<typeof channel> => Boolean(channel),
  );
  const current =
    channels.length > 0 &&
    channels.every(
      (channel) => channel.gpsExtractionVersion === GPS_EXTRACTION_VERSION,
    );
  if (current) {
    const found = channels.some((channel) => channel.noGps === false);
    return {
      state: found ? "completed" : "no-data",
      message: found
        ? "Embedded GPS extraction completed"
        : "No embedded GPS data found",
      retryable: true,
      updatedAt: recent?.finishedAt,
    };
  }
  return {
    state: "not-processed",
    message: "GPS extraction has not run for this recording",
    retryable: true,
  };
}

export function getRecordingPostProcessJobs(
  scanners: ScannerSnapshots = {
    overlay: getOverlayMetadataScannerStatus(),
    audio: getAudioEventScannerStatus(),
    gps: getGpsExtractionQueueStatus(),
  },
): RecordingPostProcessJobs[] {
  const overlayRuntime = createRuntimeLookup(
    scanners.overlay.processing,
    scanners.overlay.queued,
  );
  const audioRuntime = createRuntimeLookup(
    scanners.audio.processing,
    scanners.audio.queued,
  );
  const gpsRuntime = createRuntimeLookup(
    scanners.gps.processing,
    scanners.gps.queued,
  );
  const audioScans = getRecordingAudioScans();
  const poiCounts = getVideoPoiTypeCountsMap();

  return getVideoPairs()
    .map((pair) => ({
      id: pair.id,
      startTime: pair.startTime,
      jobs: {
        "overlay-ocr": overlayJobStatus(pair, scanners.overlay, overlayRuntime),
        "audio-events": audioJobStatus(
          pair,
          scanners.audio,
          audioRuntime,
          audioScans.get(pair.id),
          poiCounts.get(pair.id)?.cameraSave ?? 0,
        ),
        "gps-extraction": gpsJobStatus(pair, gpsRuntime),
      },
    }))
    .sort((left, right) => right.id.localeCompare(left.id));
}

export function getRecordingPostProcessJobsById(
  id: string,
  scanners: ScannerSnapshots = {
    overlay: getOverlayMetadataScannerStatus(),
    audio: getAudioEventScannerStatus(),
    gps: getGpsExtractionQueueStatus(),
  },
): RecordingPostProcessJobs | undefined {
  const pair = getVideoPairById(id);
  if (!pair) return undefined;

  const poiCounts = getVideoPoiTypeCounts(id);
  return {
    id: pair.id,
    startTime: pair.startTime,
    jobs: {
      "overlay-ocr": overlayJobStatus(
        pair,
        scanners.overlay,
        createRuntimeLookup(
          scanners.overlay.processing,
          scanners.overlay.queued,
        ),
      ),
      "audio-events": audioJobStatus(
        pair,
        scanners.audio,
        createRuntimeLookup(scanners.audio.processing, scanners.audio.queued),
        getRecordingAudioScan(id),
        poiCounts.cameraSave,
      ),
      "gps-extraction": gpsJobStatus(
        pair,
        createRuntimeLookup(scanners.gps.processing, scanners.gps.queued),
      ),
    },
  };
}

export function retryRecordingPostProcesses(
  id: string,
  requested: PostProcessKind | "all",
): Record<PostProcessKind, { accepted: boolean; message: string }> {
  const pair = getVideoPairById(id);
  if (!pair) throw new Error("Video pair not found");
  const selected: PostProcessKind[] =
    requested === "all"
      ? ["overlay-ocr", "audio-events", "gps-extraction"]
      : [requested];
  const results = Object.fromEntries(
    (["overlay-ocr", "audio-events", "gps-extraction"] as const).map((kind) => [
      kind,
      { accepted: false, message: "Not requested" },
    ]),
  ) as Record<PostProcessKind, { accepted: boolean; message: string }>;

  for (const kind of selected) {
    try {
      if (kind === "overlay-ocr") retryOverlayMetadataScan(pair);
      if (kind === "audio-events") {
        void retryRecordingAudioEvents(pair).catch((error) =>
          logger.warn({ error, videoId: id }, "Retried beep detection failed"),
        );
      }
      if (kind === "gps-extraction") {
        void retryGpsExtractionForPair(id).catch((error) =>
          logger.warn({ error, videoId: id }, "Retried GPS extraction failed"),
        );
      }
      results[kind] = { accepted: true, message: "Queued" };
    } catch (error) {
      results[kind] = {
        accepted: false,
        message: error instanceof Error ? error.message : "Could not queue job",
      };
    }
  }
  return results;
}

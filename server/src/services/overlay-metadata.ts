import { execa } from "execa";
import { logger } from "../logger.js";
import {
  getRecordingOverlayMetadata,
  upsertRecordingOverlayMetadata,
} from "../db/database.js";
import type { VideoPair } from "../types.js";
import { canonicalMediaPath } from "../utils/media-path.js";
import { processManager } from "../utils/process-manager.js";

export const OVERLAY_METADATA_EXTRACTOR_VERSION = 2;
const SAMPLE_CHECKPOINT_FRACTIONS = Array.from(
  { length: 10 },
  (_, index) => index / 10,
);
const SAMPLE_OFFSETS = [0, 0.005, 0.01] as const;
const OCR_CONCURRENCY = Math.max(
  1,
  Number(process.env.OVERLAY_OCR_CONCURRENCY) || 1,
);

interface OcrWord {
  text: string;
  left: number;
  width: number;
  confidence: number;
}

interface ParsedOverlayMetadata {
  cameraType: string;
  licensePlate: string;
  cameraConfidence: number;
  licensePlateConfidence: number;
  plateBounds: { left: number; width: number; pageWidth: number };
}

export interface ExtractedOverlayMetadata {
  cameraType: string;
  licensePlate: string;
  frameTimeSec: number;
}

export interface OverlayMetadataCandidate extends ExtractedOverlayMetadata {
  cameraConfidence: number;
  licensePlateConfidence: number;
  plateBounds?: { left: number; width: number; pageWidth: number };
}

const queue: VideoPair[] = [];
const queuedIds = new Set<string>();
let active = 0;
let scannerTimer: NodeJS.Timeout | undefined;

function applyStoredMetadata(
  pair: VideoPair,
  metadata: ReturnType<typeof getRecordingOverlayMetadata>,
): void {
  if (!metadata) return;
  pair.cameraType = metadata.cameraType;
  pair.licensePlate = metadata.licensePlate;
  pair.overlayMetadataStatus = metadata.status;
}

function cleanOcrToken(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[“”'`]/g, "")
    .replaceAll(/[^A-Z0-9./:-]/g, "")
    .trim();
}

export function parseOverlayTsv(
  tsv: string,
): ParsedOverlayMetadata | undefined {
  const rows = tsv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split("\t"));
  const page = rows.find((columns) => columns[0] === "1");
  const pageWidth = Number(page?.[8]);
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return undefined;

  const words: OcrWord[] = rows
    .filter((columns) => columns[0] === "5" && columns.length >= 12)
    .map((columns) => ({
      left: Number(columns[6]),
      width: Number(columns[8]),
      confidence: Number(columns[10]),
      text: cleanOcrToken(columns.slice(11).join("\t")),
    }))
    .filter(
      (word) =>
        word.text &&
        Number.isFinite(word.left) &&
        Number.isFinite(word.width) &&
        word.confidence >= 10,
    );

  const middleWords = words.filter((word) => {
    const center = (word.left + word.width / 2) / pageWidth;
    return (
      center >= 0.35 &&
      center <= 0.75 &&
      word.text !== "HDR" &&
      !/^\d{4}[./-]\d{2}[./-]\d{2}$/.test(word.text)
    );
  });
  if (middleWords.length < 2) return undefined;

  const plateWord = middleWords.at(-1)!;
  const cameraWords = middleWords.slice(0, -1);
  const cameraType = cameraWords
    .map((word) => word.text)
    .join(" ")
    .trim();
  const licensePlate = plateWord.text.replaceAll(/[^A-Z0-9-]/g, "");

  if (
    cameraType.length < 4 ||
    !/[A-Z]{2}/.test(cameraType) ||
    !/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(licensePlate)
  ) {
    return undefined;
  }

  return {
    cameraType,
    licensePlate,
    cameraConfidence:
      cameraWords.reduce((total, word) => total + word.confidence, 0) /
      cameraWords.length,
    licensePlateConfidence: plateWord.confidence,
    plateBounds: {
      left: plateWord.left,
      width: plateWord.width,
      pageWidth,
    },
  };
}

export function getOverlaySampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];

  const sampleTimes = new Set<number>();
  for (const checkpoint of SAMPLE_CHECKPOINT_FRACTIONS) {
    for (const offset of SAMPLE_OFFSETS) {
      const timeSec = Math.min(
        Math.max(0, durationSec - 0.05),
        durationSec * (checkpoint + offset),
      );
      sampleTimes.add(Math.round(timeSec * 1000) / 1000);
    }
  }
  return [...sampleTimes];
}

function selectBestValue(
  candidates: readonly OverlayMetadataCandidate[],
  getValue: (candidate: OverlayMetadataCandidate) => string,
  getConfidence: (candidate: OverlayMetadataCandidate) => number,
): { value: string; matches: number } {
  const groups = new Map<
    string,
    { count: number; confidenceTotal: number; bestConfidence: number }
  >();
  for (const candidate of candidates) {
    const value = getValue(candidate);
    const confidence = getConfidence(candidate);
    const group = groups.get(value) ?? {
      count: 0,
      confidenceTotal: 0,
      bestConfidence: 0,
    };
    group.count++;
    group.confidenceTotal += confidence;
    group.bestConfidence = Math.max(group.bestConfidence, confidence);
    groups.set(value, group);
  }

  const [best] = [...groups].sort(([, left], [, right]) => {
    if (left.count !== right.count) return right.count - left.count;
    const averageDifference =
      right.confidenceTotal / right.count - left.confidenceTotal / left.count;
    if (averageDifference !== 0) return averageDifference;
    return right.bestConfidence - left.bestConfidence;
  });
  return { value: best[0], matches: best[1].count };
}

export function selectBestOverlayMetadata(
  candidates: readonly OverlayMetadataCandidate[],
): ExtractedOverlayMetadata | undefined {
  if (!candidates.length) return undefined;

  const camera = selectBestValue(
    candidates,
    (candidate) => candidate.cameraType,
    (candidate) => candidate.cameraConfidence,
  );
  const plate = selectBestValue(
    candidates,
    (candidate) => candidate.licensePlate,
    (candidate) => candidate.licensePlateConfidence,
  );
  const representative = [...candidates].sort((left, right) => {
    const getMatchCount = (candidate: OverlayMetadataCandidate) =>
      Number(candidate.cameraType === camera.value) +
      Number(candidate.licensePlate === plate.value);
    const matchDifference = getMatchCount(right) - getMatchCount(left);
    if (matchDifference !== 0) return matchDifference;
    const getMatchingConfidence = (candidate: OverlayMetadataCandidate) =>
      (candidate.cameraType === camera.value ? candidate.cameraConfidence : 0) +
      (candidate.licensePlate === plate.value
        ? candidate.licensePlateConfidence
        : 0);
    return getMatchingConfidence(right) - getMatchingConfidence(left);
  })[0];

  return {
    cameraType: camera.value,
    licensePlate: plate.value,
    frameTimeSec: representative.frameTimeSec,
  };
}

async function extractBottomFrame(
  filePath: string,
  timeSec: number,
  plateBounds?: ParsedOverlayMetadata["plateBounds"],
): Promise<Uint8Array> {
  let filter = "crop=iw:90:0:ih-90,scale=iw*2:ih*2,format=gray";
  if (plateBounds) {
    const padding = plateBounds.pageWidth * 0.008;
    const left =
      Math.max(0, plateBounds.left - padding) / plateBounds.pageWidth;
    const width =
      Math.min(
        plateBounds.pageWidth - Math.max(0, plateBounds.left - padding),
        plateBounds.width + padding * 2,
      ) / plateBounds.pageWidth;
    filter = `crop=iw*${width}:90:iw*${left}:ih-90,scale=iw*4:ih*4,format=gray,lut=y='if(gte(val,128),255,0)'`;
  }

  const proc = execa(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      timeSec.toFixed(3),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      filter,
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );
  processManager.register(proc);
  return (await proc).stdout;
}

async function runTesseract(
  image: Uint8Array,
  output: "tsv" | "text",
): Promise<string> {
  const args = ["stdin", "stdout", "-l", "eng", "--psm", "7"];
  if (output === "tsv") args.push("tsv");
  else
    args.push(
      "-c",
      "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
    );
  const proc = execa("tesseract", args, {
    input: image,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  processManager.register(proc);
  return (await proc).stdout;
}

export async function extractOverlayMetadata(
  filePath: string,
  durationSec: number,
): Promise<ExtractedOverlayMetadata | undefined> {
  const candidates: OverlayMetadataCandidate[] = [];
  let successfulSamples = 0;
  let firstError: unknown;
  for (const frameTimeSec of getOverlaySampleTimes(durationSec)) {
    try {
      const frame = await extractBottomFrame(filePath, frameTimeSec);
      const parsed = parseOverlayTsv(await runTesseract(frame, "tsv"));
      successfulSamples++;
      if (!parsed) continue;
      candidates.push({
        cameraType: parsed.cameraType,
        licensePlate: parsed.licensePlate,
        cameraConfidence: parsed.cameraConfidence,
        licensePlateConfidence: parsed.licensePlateConfidence,
        frameTimeSec,
        plateBounds: parsed.plateBounds,
      });
    } catch (error) {
      firstError ??= error;
      logger.debug(
        { error, filePath, frameTimeSec },
        "Overlay OCR sample failed",
      );
    }
  }
  if (!successfulSamples && firstError) throw firstError;
  const selected = selectBestOverlayMetadata(candidates);
  if (!selected) return undefined;

  const refinementFrames = [...candidates]
    .sort((left, right) => {
      const getMatchCount = (candidate: OverlayMetadataCandidate) =>
        Number(candidate.cameraType === selected.cameraType) +
        Number(candidate.licensePlate === selected.licensePlate);
      const matchDifference = getMatchCount(right) - getMatchCount(left);
      if (matchDifference !== 0) return matchDifference;
      return (
        right.cameraConfidence +
        right.licensePlateConfidence -
        left.cameraConfidence -
        left.licensePlateConfidence
      );
    })
    .slice(0, 3);
  const focusedPlates: Array<{ value: string; frameTimeSec: number }> = [];
  for (const candidate of refinementFrames) {
    if (!candidate.plateBounds) continue;
    try {
      const plateFrame = await extractBottomFrame(
        filePath,
        candidate.frameTimeSec,
        candidate.plateBounds,
      );
      const value = cleanOcrToken(
        await runTesseract(plateFrame, "text"),
      ).replaceAll(/[^A-Z0-9-]/g, "");
      if (/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(value)) {
        focusedPlates.push({ value, frameTimeSec: candidate.frameTimeSec });
      }
    } catch (error) {
      logger.debug(
        { error, filePath, frameTimeSec: candidate.frameTimeSec },
        "Focused plate OCR sample failed",
      );
    }
  }

  const focusedGroups = new Map<string, number>();
  for (const plate of focusedPlates) {
    focusedGroups.set(plate.value, (focusedGroups.get(plate.value) ?? 0) + 1);
  }
  const bestFocusedPlate = [...focusedGroups].sort(
    (left, right) => right[1] - left[1],
  )[0];
  if (bestFocusedPlate?.[1] >= 2) {
    selected.licensePlate = bestFocusedPlate[0];
    selected.frameTimeSec = focusedPlates.find(
      (plate) => plate.value === bestFocusedPlate[0],
    )!.frameTimeSec;
  }

  logger.debug(
    {
      filePath,
      sampledFrames: successfulSamples,
      candidates: candidates.length,
      cameraMatches: candidates.filter(
        (candidate) => candidate.cameraType === selected.cameraType,
      ).length,
      plateMatches: candidates.filter(
        (candidate) => candidate.licensePlate === selected.licensePlate,
      ).length,
      focusedPlateMatches: bestFocusedPlate?.[1] ?? 0,
    },
    "Selected recording overlay metadata from sampled frames",
  );
  return selected;
}

async function scanPair(pair: VideoPair): Promise<void> {
  const source = pair.channels.front || pair.channels.rear;
  if (!source) return;
  const sourceMtimeMs = source.mtimeMs ?? 0;
  const cached = getRecordingOverlayMetadata(pair.id);
  if (
    cached?.extractorVersion === OVERLAY_METADATA_EXTRACTOR_VERSION &&
    canonicalMediaPath(cached.sourcePath) === canonicalMediaPath(source.path) &&
    Math.abs(cached.sourceMtimeMs - sourceMtimeMs) <= 1
  ) {
    applyStoredMetadata(pair, cached);
    return;
  }

  pair.overlayMetadataStatus = "pending";
  try {
    const extracted = await extractOverlayMetadata(
      source.path,
      pair.durationSec ?? 0,
    );
    if (extracted) {
      const stored = upsertRecordingOverlayMetadata({
        videoId: pair.id,
        cameraType: extracted.cameraType,
        licensePlate: extracted.licensePlate,
        sourcePath: source.path,
        sourceMtimeMs,
        extractorVersion: OVERLAY_METADATA_EXTRACTOR_VERSION,
        status: "found",
        scannedAt: Date.now(),
        frameTimeSec: extracted.frameTimeSec,
      });
      applyStoredMetadata(pair, stored);
      logger.info(
        {
          videoId: pair.id,
          cameraType: extracted.cameraType,
          licensePlate: extracted.licensePlate,
          frameTimeSec: extracted.frameTimeSec,
        },
        "Extracted recording overlay metadata",
      );
      return;
    }

    const stored = upsertRecordingOverlayMetadata({
      videoId: pair.id,
      sourcePath: source.path,
      sourceMtimeMs,
      extractorVersion: OVERLAY_METADATA_EXTRACTOR_VERSION,
      status: "not-found",
      scannedAt: Date.now(),
    });
    applyStoredMetadata(pair, stored);
  } catch (error) {
    const stored = upsertRecordingOverlayMetadata({
      videoId: pair.id,
      sourcePath: source.path,
      sourceMtimeMs,
      extractorVersion: OVERLAY_METADATA_EXTRACTOR_VERSION,
      status: "failed",
      scannedAt: Date.now(),
    });
    applyStoredMetadata(pair, stored);
    logger.warn({ error, videoId: pair.id }, "Recording overlay OCR failed");
  }
}

function processQueue(): void {
  while (active < OCR_CONCURRENCY && queue.length > 0) {
    const pair = queue.shift()!;
    active++;
    scanPair(pair)
      .catch((error) =>
        logger.warn({ error, videoId: pair.id }, "Overlay scan failed"),
      )
      .finally(() => {
        active--;
        queuedIds.delete(pair.id);
        processQueue();
      });
  }
}

function enqueuePairs(pairs: VideoPair[]): void {
  for (const pair of pairs) {
    if (queuedIds.has(pair.id)) continue;
    const source = pair.channels.front || pair.channels.rear;
    if (!source) continue;
    const cached = getRecordingOverlayMetadata(pair.id);
    const cacheCurrent =
      cached?.extractorVersion === OVERLAY_METADATA_EXTRACTOR_VERSION &&
      canonicalMediaPath(cached.sourcePath) ===
        canonicalMediaPath(source.path) &&
      Math.abs(cached.sourceMtimeMs - (source.mtimeMs ?? 0)) <= 1;
    if (cacheCurrent) {
      applyStoredMetadata(pair, cached);
      continue;
    }
    pair.overlayMetadataStatus = "pending";
    queuedIds.add(pair.id);
    queue.push(pair);
  }
  processQueue();
}

function hydratePairsFromCache(pairs: VideoPair[]): void {
  for (const pair of pairs) {
    const source = pair.channels.front || pair.channels.rear;
    if (!source) continue;
    const cached = getRecordingOverlayMetadata(pair.id);
    if (
      cached?.extractorVersion === OVERLAY_METADATA_EXTRACTOR_VERSION &&
      canonicalMediaPath(cached.sourcePath) ===
        canonicalMediaPath(source.path) &&
      Math.abs(cached.sourceMtimeMs - (source.mtimeMs ?? 0)) <= 1
    ) {
      applyStoredMetadata(pair, cached);
    }
  }
}

export async function startOverlayMetadataScanner(
  getPairs: () => VideoPair[],
): Promise<void> {
  const initialPairs = getPairs();
  hydratePairsFromCache(initialPairs);
  if (process.env.OVERLAY_OCR_ENABLED === "0") {
    logger.info("Recording overlay OCR is disabled");
    return;
  }
  try {
    await execa("tesseract", ["--version"]);
  } catch (error) {
    logger.warn(
      { error },
      "Tesseract is unavailable; recording camera and license plate OCR is disabled",
    );
    return;
  }

  enqueuePairs(initialPairs);
  scannerTimer = setInterval(() => enqueuePairs(getPairs()), 30_000);
  scannerTimer.unref();
}

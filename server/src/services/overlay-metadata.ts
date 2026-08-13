import { execa } from "execa";
import { logger } from "../logger.js";
import {
  getRecordingOverlayMetadata,
  upsertRecordingOverlayMetadata,
} from "../db/database.js";
import type { VideoPair } from "../types.js";
import { canonicalMediaPath } from "../utils/media-path.js";
import { processManager } from "../utils/process-manager.js";

export const OVERLAY_METADATA_EXTRACTOR_VERSION = 1;
const SAMPLE_FRACTIONS = Array.from({ length: 10 }, (_, index) => index / 10);
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
  plateBounds: { left: number; width: number; pageWidth: number };
}

export interface ExtractedOverlayMetadata {
  cameraType: string;
  licensePlate: string;
  frameTimeSec: number;
}

const queue: VideoPair[] = [];
const queuedIds = new Set<string>();
let active = 0;
let scannerTimer: NodeJS.Timeout | undefined;

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
    plateBounds: {
      left: plateWord.left,
      width: plateWord.width,
      pageWidth,
    },
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
  const fractions = durationSec > 0 ? SAMPLE_FRACTIONS : [0];
  for (const fraction of fractions) {
    const frameTimeSec = Math.max(0, durationSec * fraction);
    const frame = await extractBottomFrame(filePath, frameTimeSec);
    const parsed = parseOverlayTsv(await runTesseract(frame, "tsv"));
    if (!parsed) continue;

    let licensePlate = parsed.licensePlate;
    try {
      const plateFrame = await extractBottomFrame(
        filePath,
        frameTimeSec,
        parsed.plateBounds,
      );
      const focusedPlate = cleanOcrToken(
        await runTesseract(plateFrame, "text"),
      ).replaceAll(/[^A-Z0-9-]/g, "");
      if (/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(focusedPlate)) {
        licensePlate = focusedPlate;
      }
    } catch (error) {
      logger.debug({ error }, "Focused plate OCR failed");
    }

    return {
      cameraType: parsed.cameraType,
      licensePlate,
      frameTimeSec,
    };
  }
  return undefined;
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
    pair.cameraType = cached.cameraType;
    pair.licensePlate = cached.licensePlate;
    pair.overlayMetadataStatus = cached.status;
    return;
  }

  pair.overlayMetadataStatus = "pending";
  try {
    const extracted = await extractOverlayMetadata(
      source.path,
      pair.durationSec ?? 0,
    );
    if (extracted) {
      pair.cameraType = extracted.cameraType;
      pair.licensePlate = extracted.licensePlate;
      pair.overlayMetadataStatus = "found";
      upsertRecordingOverlayMetadata({
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

    pair.overlayMetadataStatus = "not-found";
    upsertRecordingOverlayMetadata({
      videoId: pair.id,
      sourcePath: source.path,
      sourceMtimeMs,
      extractorVersion: OVERLAY_METADATA_EXTRACTOR_VERSION,
      status: "not-found",
      scannedAt: Date.now(),
    });
  } catch (error) {
    pair.overlayMetadataStatus = "failed";
    upsertRecordingOverlayMetadata({
      videoId: pair.id,
      sourcePath: source.path,
      sourceMtimeMs,
      extractorVersion: OVERLAY_METADATA_EXTRACTOR_VERSION,
      status: "failed",
      scannedAt: Date.now(),
    });
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
      pair.cameraType = cached.cameraType;
      pair.licensePlate = cached.licensePlate;
      pair.overlayMetadataStatus = cached.status;
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
      pair.cameraType = cached.cameraType;
      pair.licensePlate = cached.licensePlate;
      pair.overlayMetadataStatus = cached.status;
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

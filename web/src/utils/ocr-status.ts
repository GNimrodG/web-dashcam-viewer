import type { VideoPair } from "../api";

export type OcrStatusColor = "success" | "neutral" | "warning" | "danger";

export interface OcrStatusInfo {
  label: string;
  description: string;
  color: OcrStatusColor;
  processed: boolean;
}

export function getOcrStatusInfo(pair: VideoPair): OcrStatusInfo {
  if (pair.overlayMetadataStatus === "pending") {
    return {
      label: "OCR queued",
      description: "Camera and license plate OCR is queued or running.",
      color: "warning",
      processed: false,
    };
  }

  switch (pair.overlayMetadataOcrStatus) {
    case "found":
      return {
        label: "OCR processed",
        description: "OCR completed and found camera overlay metadata.",
        color: "success",
        processed: true,
      };
    case "not-found":
      return {
        label: "OCR checked · no match",
        description: "OCR completed but did not find usable camera metadata.",
        color: "neutral",
        processed: true,
      };
    case "failed":
      return {
        label: "OCR failed",
        description: "OCR ran but failed while processing this recording.",
        color: "danger",
        processed: true,
      };
    default:
      return {
        label: pair.overlayMetadataOverridden
          ? "OCR not processed · manually set"
          : "OCR not processed",
        description: pair.overlayMetadataOverridden
          ? "Metadata was entered manually; no completed OCR run is recorded."
          : "No completed OCR run is recorded for this recording.",
        color: "neutral",
        processed: false,
      };
  }
}

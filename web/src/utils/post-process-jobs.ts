import type { PostProcessJobState, PostProcessKind } from "../api";

export const POST_PROCESS_LABELS: Record<PostProcessKind, string> = {
  "overlay-ocr": "Camera overlay OCR",
  "audio-events": "Saving beep detection",
  "gps-extraction": "GPS extraction",
};

export const POST_PROCESS_KINDS = Object.keys(
  POST_PROCESS_LABELS,
) as PostProcessKind[];

export function getPostProcessStatePresentation(state: PostProcessJobState): {
  label: string;
  color: "success" | "neutral" | "warning" | "danger" | "primary";
} {
  switch (state) {
    case "completed":
      return { label: "Completed", color: "success" };
    case "no-data":
      return { label: "No data", color: "neutral" };
    case "queued":
      return { label: "Queued", color: "warning" };
    case "running":
      return { label: "Running", color: "primary" };
    case "failed":
      return { label: "Failed", color: "danger" };
    case "disabled":
      return { label: "Disabled", color: "neutral" };
    case "unavailable":
      return { label: "Unavailable", color: "danger" };
    case "not-processed":
      return { label: "Not processed", color: "warning" };
  }
}

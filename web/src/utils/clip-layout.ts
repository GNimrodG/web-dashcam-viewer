export type ClipChannelMode =
  | "front"
  | "rear"
  | "both-stacked"
  | "both-side-by-side"
  | "front-pip-rear"
  | "rear-pip-front";

export type PipCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const DEFAULT_PIP_SIZE_PERCENT = 30;
export const MIN_PIP_SIZE_PERCENT = 10;
export const MAX_PIP_SIZE_PERCENT = 50;
export const DEFAULT_PIP_CORNER: PipCorner = "bottom-right";
const PIP_MARGIN_RATIO = 0.02;

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface ClipFrameRect extends FrameDimensions {
  x: number;
  y: number;
}

export interface ClipPreviewLayout extends FrameDimensions {
  front?: ClipFrameRect;
  rear?: ClipFrameRect;
}

export function isPictureInPictureMode(
  mode: ClipChannelMode,
): mode is "front-pip-rear" | "rear-pip-front" {
  return mode === "front-pip-rear" || mode === "rear-pip-front";
}

function scaleToWidth(
  dimensions: FrameDimensions,
  width: number,
): FrameDimensions {
  return {
    width,
    height: Math.max(
      2,
      Math.round((dimensions.height * width) / dimensions.width / 2) * 2,
    ),
  };
}

function scaleToHeight(
  dimensions: FrameDimensions,
  height: number,
): FrameDimensions {
  return {
    width: Math.max(
      2,
      Math.round((dimensions.width * height) / dimensions.height / 2) * 2,
    ),
    height,
  };
}

function pictureInPictureLayout(
  mode: "front-pip-rear" | "rear-pip-front",
  front: FrameDimensions,
  rear: FrameDimensions,
  pipSizePercent: number,
  pipCorner: PipCorner,
): ClipPreviewLayout {
  const main = mode === "front-pip-rear" ? front : rear;
  const small = mode === "front-pip-rear" ? rear : front;
  const smallWidth = Math.max(
    2,
    Math.trunc((main.width * (pipSizePercent / 100)) / 2) * 2,
  );
  const scaledSmall = scaleToWidth(small, smallWidth);
  const margin = Math.trunc(main.width * PIP_MARGIN_RATIO);
  const smallRect: ClipFrameRect = {
    ...scaledSmall,
    x: pipCorner.endsWith("right")
      ? main.width - scaledSmall.width - margin
      : margin,
    y: pipCorner.startsWith("bottom")
      ? main.height - scaledSmall.height - margin
      : margin,
  };
  const mainRect = { x: 0, y: 0, ...main };

  return {
    ...main,
    ...(mode === "front-pip-rear"
      ? { front: mainRect, rear: smallRect }
      : { rear: mainRect, front: smallRect }),
  };
}

export function calculateClipPreviewLayout(options: {
  mode: ClipChannelMode;
  front?: FrameDimensions;
  rear?: FrameDimensions;
  pipSizePercent?: number;
  pipCorner?: PipCorner;
}): ClipPreviewLayout | undefined {
  const {
    mode,
    front,
    rear,
    pipSizePercent = DEFAULT_PIP_SIZE_PERCENT,
    pipCorner = DEFAULT_PIP_CORNER,
  } = options;
  if (mode === "front") {
    return front ? { ...front, front: { x: 0, y: 0, ...front } } : undefined;
  }
  if (mode === "rear") {
    return rear ? { ...rear, rear: { x: 0, y: 0, ...rear } } : undefined;
  }
  if (!front || !rear) return undefined;

  if (mode === "both-stacked") {
    const scaledFront = scaleToWidth(front, 1920);
    const scaledRear = scaleToWidth(rear, 1920);
    return {
      width: 1920,
      height: scaledFront.height + scaledRear.height,
      front: { x: 0, y: 0, ...scaledFront },
      rear: { x: 0, y: scaledFront.height, ...scaledRear },
    };
  }
  if (mode === "both-side-by-side") {
    const scaledFront = scaleToHeight(front, 1080);
    const scaledRear = scaleToHeight(rear, 1080);
    return {
      width: scaledFront.width + scaledRear.width,
      height: 1080,
      front: { x: 0, y: 0, ...scaledFront },
      rear: { x: scaledFront.width, y: 0, ...scaledRear },
    };
  }
  return pictureInPictureLayout(mode, front, rear, pipSizePercent, pipCorner);
}

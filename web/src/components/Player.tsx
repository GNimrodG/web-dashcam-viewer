import { useRef, useEffect, useState, useMemo } from "react";
import {
  VideoPair,
  videoSourceUrl,
  createClip,
  watchClipJob,
  type ClipJobStatus,
  type VideoPoi,
} from "../api";
import Box from "@mui/joy/Box";
import Stack from "@mui/joy/Stack";
import Typography from "@mui/joy/Typography";
import IconButton from "@mui/joy/IconButton";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import StopIcon from "@mui/icons-material/Stop";
import ButtonGroup from "@mui/joy/ButtonGroup";
import Slider from "@mui/joy/Slider";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import Menu from "@mui/joy/Menu";
import MenuItem from "@mui/joy/MenuItem";
import ListItemDecorator from "@mui/joy/ListItemDecorator";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Dropdown from "@mui/joy/Dropdown";
import MenuButton from "@mui/joy/MenuButton";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import DialogTitle from "@mui/joy/DialogTitle";
import DialogContent from "@mui/joy/DialogContent";
import DialogActions from "@mui/joy/DialogActions";
import Button from "@mui/joy/Button";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import Radio from "@mui/joy/Radio";
import RadioGroup from "@mui/joy/RadioGroup";
import type { Mark } from "@mui/base/useSlider";
import { useHotkeys } from "@mantine/hooks";
import { formatPairTime } from "../utils/recording-time";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Input from "@mui/joy/Input";
import LinearProgress from "@mui/joy/LinearProgress";
import {
  clampPlaybackTime,
  FRAME_STEP_SECONDS,
  getRelativeSeekTarget,
  KEYBOARD_SEEK_SECONDS,
} from "../utils/playback-seek";

interface PlayerProps {
  pair: VideoPair | null;
  onTimeUpdate?: (t: number) => void;
  seekRequest?: { timeSec: number; requestId: number };
  pois?: readonly VideoPoi[];
  poisLoading?: boolean;
  onCreatePoi?: (timeSec: number, label: string) => Promise<VideoPoi>;
  onDeletePoi?: (poiId: string) => Promise<void>;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Get minimum marks for a video duration slider.
 * @param duration in seconds
 * @returns array of marks
 */
function getMinMarksForLength(duration: number): Mark[] {
  const marks: Mark[] = [];
  const totalMinutes = Math.floor(duration / 60);
  const step =
    totalMinutes <= 5
      ? 0.5
      : totalMinutes <= 10
        ? 1
        : totalMinutes <= 30
          ? 5
          : 10;

  for (let i = 0; i <= totalMinutes; i += step) {
    marks.push({
      value: i * 60,
      label: formatTime(i * 60),
    });
  }

  // Only add final mark if it's different from the last one
  const lastMark = marks.at(-1);
  if (lastMark?.value !== duration) {
    marks.push({ value: duration, label: formatTime(duration) });
  }

  return marks;
}

export function Player({
  pair,
  onTimeUpdate,
  seekRequest,
  pois = [],
  poisLoading = false,
  onCreatePoi,
  onDeletePoi,
}: Readonly<PlayerProps>) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const lastAudibleVolumeRef = useRef(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenCamera, setFullscreenCamera] = useState<
    "front" | "rear" | null
  >(null);
  const frontRef = useRef<HTMLVideoElement | null>(null);
  const rearRef = useRef<HTMLVideoElement | null>(null);
  const frontContainerRef = useRef<HTMLDivElement | null>(null);
  const rearContainerRef = useRef<HTMLDivElement | null>(null);

  // Clip creation state
  const [showClipDialog, setShowClipDialog] = useState(false);
  const [clipStartTime, setClipStartTime] = useState(0);
  const [clipEndTime, setClipEndTime] = useState(0);
  const [clipChannels, setClipChannels] = useState<
    "front" | "rear" | "both-stacked" | "both-side-by-side"
  >("front");
  const [clipAudioVolume, setClipAudioVolume] = useState(1); // 0-1 (0=mute, 1=original)
  const [isCreatingClip, setIsCreatingClip] = useState(false);
  const [clipJobStatus, setClipJobStatus] = useState<ClipJobStatus | null>(
    null,
  );
  const clipJobCleanupRef = useRef<(() => void) | null>(null);
  const [showPoiDialog, setShowPoiDialog] = useState(false);
  const [poiTimeSec, setPoiTimeSec] = useState(0);
  const [poiLabel, setPoiLabel] = useState("");
  const [poiSaving, setPoiSaving] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const startPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const endPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Store original video times when opening clip dialog
  const originalTimeFrontRef = useRef<number>(0);
  const originalTimeRearRef = useRef<number>(0);

  const handleOpenClipDialog = () => {
    const currentTime = frontRef.current?.currentTime || 0;
    setClipStartTime(Math.max(0, currentTime - 10));
    setClipEndTime(Math.min(pair?.durationSec || 0, currentTime + 10));

    // Store original times
    originalTimeFrontRef.current = frontRef.current?.currentTime || 0;
    originalTimeRearRef.current = rearRef.current?.currentTime || 0;

    // Set default channel based on what's available
    if (pair?.channels.front) {
      setClipChannels("front");
    } else if (pair?.channels.rear) {
      setClipChannels("rear");
    }

    setShowClipDialog(true);
    setClipJobStatus(null);

    // Update preview frames after a short delay to ensure dialog is rendered
    setTimeout(updatePreviewFrames, 100);
  };

  const restoreClipPreviewPosition = () => {
    if (frontRef.current) {
      frontRef.current.currentTime = originalTimeFrontRef.current;
    }
    if (rearRef.current) {
      rearRef.current.currentTime = originalTimeRearRef.current;
    }
  };

  const handleCloseClipDialog = () => {
    if (isCreatingClip) return;
    restoreClipPreviewPosition();
    setShowClipDialog(false);
  };

  // Update preview frames when time changes
  const updatePreviewFrames = (which: "start" | "end" | "both" = "both") => {
    const captureFrame = (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (clipChannels === "front" && frontRef.current) {
        canvas.width = frontRef.current.videoWidth;
        canvas.height = frontRef.current.videoHeight;
        ctx.drawImage(frontRef.current, 0, 0);
      } else if (clipChannels === "rear" && rearRef.current) {
        canvas.width = rearRef.current.videoWidth;
        canvas.height = rearRef.current.videoHeight;
        ctx.drawImage(rearRef.current, 0, 0);
      } else if (
        clipChannels === "both-stacked" &&
        frontRef.current &&
        rearRef.current
      ) {
        // Stack vertically: front on top, rear on bottom
        const width = Math.max(
          frontRef.current.videoWidth,
          rearRef.current.videoWidth,
        );
        const height = Math.max(
          frontRef.current.videoHeight,
          rearRef.current.videoHeight,
        );
        canvas.width = width;
        canvas.height = height * 2;

        // Draw front on top
        ctx.drawImage(frontRef.current, 0, 0, width, height);
        // Draw rear on bottom
        ctx.drawImage(rearRef.current, 0, height, width, height);
      } else if (
        clipChannels === "both-side-by-side" &&
        frontRef.current &&
        rearRef.current
      ) {
        // Place side by side: front on left, rear on right
        const width = Math.max(
          frontRef.current.videoWidth,
          rearRef.current.videoWidth,
        );
        const height = Math.max(
          frontRef.current.videoHeight,
          rearRef.current.videoHeight,
        );
        canvas.width = width * 2;
        canvas.height = height;

        // Draw front on left
        ctx.drawImage(frontRef.current, 0, 0, width, height);
        // Draw rear on right
        ctx.drawImage(
          rearRef.current,
          frontRef.current.videoWidth,
          0,
          width,
          height,
        );
      }
    };

    const primaryRef = frontRef.current || rearRef.current;
    if (!primaryRef) return;

    // Only update the preview that changed
    if (which === "start" || which === "both") {
      // Seek to start time
      if (frontRef.current) frontRef.current.currentTime = clipStartTime;
      if (rearRef.current) rearRef.current.currentTime = clipStartTime;

      primaryRef.onseeked = () => {
        if (startPreviewCanvasRef.current) {
          captureFrame(startPreviewCanvasRef.current);
        }

        // If we also need to update end, do it after start is done
        if (which === "both") {
          if (frontRef.current) frontRef.current.currentTime = clipEndTime;
          if (rearRef.current) rearRef.current.currentTime = clipEndTime;

          primaryRef.onseeked = () => {
            if (endPreviewCanvasRef.current) {
              captureFrame(endPreviewCanvasRef.current);
            }
            primaryRef.onseeked = null;
          };
        } else {
          primaryRef.onseeked = null;
        }
      };
    } else if (which === "end") {
      // Only seek to end time
      if (frontRef.current) frontRef.current.currentTime = clipEndTime;
      if (rearRef.current) rearRef.current.currentTime = clipEndTime;

      primaryRef.onseeked = () => {
        if (endPreviewCanvasRef.current) {
          captureFrame(endPreviewCanvasRef.current);
        }
        primaryRef.onseeked = null;
      };
    }
  };

  const handleCreateClip = async () => {
    if (!pair) return;

    setIsCreatingClip(true);
    setClipJobStatus(null);
    try {
      const job = await createClip(
        pair.id,
        clipStartTime,
        clipEndTime,
        clipChannels,
        clipAudioVolume,
      );
      await new Promise<void>((resolve, reject) => {
        clipJobCleanupRef.current = watchClipJob(job.statusUrl, (status) => {
          setClipJobStatus(status);
          if (status.state === "completed" && status.result) {
            window.open(status.result.downloadUrl, "_blank");
            resolve();
          } else if (status.state === "failed") {
            reject(new Error(status.error || "Clip generation failed"));
          }
        });
      });
      restoreClipPreviewPosition();
      setShowClipDialog(false);
    } catch (err) {
      console.error("Clip creation failed:", err);
      alert(
        err instanceof Error
          ? `Failed to create clip: ${err.message}`
          : "Failed to create clip. Check console for details.",
      );
    } finally {
      clipJobCleanupRef.current?.();
      clipJobCleanupRef.current = null;
      setIsCreatingClip(false);
    }
  };

  useEffect(
    () => () => {
      clipJobCleanupRef.current?.();
    },
    [],
  );

  /**
   * Capture a frame from a video element and return as canvas
   */
  const captureFrame = (videoElement: HTMLVideoElement): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  };

  /**
   * Download a canvas as PNG image
   */
  const downloadCanvas = (canvas: HTMLCanvasElement, filename: string) => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  /**
   * Copy canvas image to clipboard
   */
  const copyCanvasToClipboard = async (canvas: HTMLCanvasElement) => {
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });
      if (!blob) throw new Error("Failed to create blob");

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      alert("Failed to copy to clipboard. Please try downloading instead.");
    }
  };

  /**
   * Capture frame from specified video and perform action
   */
  const handleCapture = async (
    camera: "front" | "rear",
    action: "download" | "copy",
  ) => {
    const videoElement =
      camera === "front" ? frontRef.current : rearRef.current;
    if (!videoElement || !pair) return;

    const canvas = captureFrame(videoElement);
    const timestamp = formatTime(videoElement.currentTime).replaceAll(":", "-");
    const filename = `${pair.id}_${camera}_${timestamp}.png`;

    if (action === "download") {
      downloadCanvas(canvas, filename);
    } else {
      await copyCanvasToClipboard(canvas);
    }
  };

  const handleFullscreen = async (camera: "front" | "rear") => {
    const container =
      camera === "front" ? frontContainerRef.current : rearContainerRef.current;
    if (!container) return;

    try {
      await container.requestFullscreen();
      setFullscreenCamera(camera);
      setIsFullscreen(true);
    } catch (err) {
      console.error("Failed to enter fullscreen:", err);
    }
  };

  const handleExitFullscreen = async () => {
    try {
      await document.exitFullscreen();
    } catch (err) {
      console.error("Failed to exit fullscreen:", err);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        setFullscreenCamera(null);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    // Reset on clip change
    if (frontRef.current) {
      frontRef.current.pause();
      frontRef.current.currentTime = 0;
    }

    if (rearRef.current) {
      rearRef.current.pause();
      rearRef.current.currentTime = 0;
    }

    setIsPlaying(false);
    setShowPoiDialog(false);
  }, [pair?.id]);

  useEffect(() => {
    if (frontRef.current) frontRef.current.volume = volume;
  }, [volume, pair?.id]);

  const onPlayBoth = () => {
    const front = frontRef.current;
    const rear = rearRef.current;
    if (!front) return;

    if (rear) {
      rear.currentTime = front.currentTime || 0;
      rear.volume = 0;
      rear.play();
    }
    front.play();
    setIsPlaying(true);
  };

  const onPauseBoth = () => {
    const front = frontRef.current;
    const rear = rearRef.current;
    if (!front) return;

    if (rear) {
      rear.currentTime = front.currentTime || 0;
      rear.pause();
    }
    front.pause();
    setIsPlaying(false);
  };

  const onStopBoth = () => {
    const front = frontRef.current;
    const rear = rearRef.current;
    if (!front) return;

    front.pause();
    front.currentTime = 0;
    if (rear) {
      rear.pause();
      rear.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const seekTo = (timeSec: number) => {
    const video = frontRef.current || rearRef.current;
    const durationSec = pair?.durationSec ?? video?.duration;
    const target = clampPlaybackTime(timeSec, durationSec);
    if (frontRef.current) frontRef.current.currentTime = target;
    if (rearRef.current) rearRef.current.currentTime = target;
    onTimeUpdate?.(target);
  };

  const seekRelative = (offsetSec: number) => {
    const video = frontRef.current || rearRef.current;
    if (!video) return;
    const durationSec = pair?.durationSec ?? video.duration;
    seekTo(getRelativeSeekTarget(video.currentTime, offsetSec, durationSec));
  };

  const handleOpenPoiDialog = () => {
    const currentTime =
      frontRef.current?.currentTime ?? rearRef.current?.currentTime ?? 0;
    setPoiTimeSec(currentTime);
    setPoiLabel("");
    setPoiError(null);
    setShowPoiDialog(true);
  };

  const handleCreatePoi = async () => {
    const label = poiLabel.trim();
    if (!onCreatePoi || !label) return;
    setPoiSaving(true);
    setPoiError(null);
    try {
      await onCreatePoi(poiTimeSec, label);
      setShowPoiDialog(false);
    } catch (error) {
      setPoiError(
        error instanceof Error ? error.message : "Failed to create POI",
      );
    } finally {
      setPoiSaving(false);
    }
  };

  const handleDeletePoi = async (poiId: string) => {
    if (!onDeletePoi) return;
    setPoiError(null);
    try {
      await onDeletePoi(poiId);
    } catch (error) {
      setPoiError(
        error instanceof Error ? error.message : "Failed to delete POI",
      );
    }
  };

  useHotkeys([
    ["space", () => (isPlaying ? onPauseBoth() : onPlayBoth())],
    ["ArrowLeft", () => seekRelative(-KEYBOARD_SEEK_SECONDS)],
    ["ArrowRight", () => seekRelative(KEYBOARD_SEEK_SECONDS)],
    [",", () => !isPlaying && seekRelative(-FRAME_STEP_SECONDS)],
    [".", () => !isPlaying && seekRelative(FRAME_STEP_SECONDS)],
  ]);

  useEffect(() => {
    const v = frontRef.current || rearRef.current;
    if (!v || !onTimeUpdate) return;
    setIsPlaying(false);

    const handler = () => onTimeUpdate(v.currentTime || 0);
    v.addEventListener("timeupdate", handler);
    v.addEventListener("seeked", handler);
    return () => {
      v.removeEventListener("timeupdate", handler);
      v.removeEventListener("seeked", handler);
    };
  }, [onTimeUpdate, pair?.id]);

  useEffect(() => {
    const video = frontRef.current || rearRef.current;
    if (!video || !onTimeUpdate || !isPlaying) return;

    let videoFrameId: number | null = null;
    let animationFrameId: number | null = null;
    const supportsVideoFrameCallback =
      typeof video.requestVideoFrameCallback === "function" &&
      typeof video.cancelVideoFrameCallback === "function";

    const updatePlaybackTime = () => {
      onTimeUpdate(video.currentTime || 0);
      if (supportsVideoFrameCallback) {
        videoFrameId = video.requestVideoFrameCallback(updatePlaybackTime);
      } else {
        animationFrameId = requestAnimationFrame(updatePlaybackTime);
      }
    };

    updatePlaybackTime();

    return () => {
      if (videoFrameId !== null) {
        video.cancelVideoFrameCallback(videoFrameId);
      }
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, onTimeUpdate, pair?.id]);

  useEffect(() => {
    if (!seekRequest) return;
    const target = Math.max(
      0,
      Math.min(seekRequest.timeSec, pair?.durationSec || seekRequest.timeSec),
    );
    if (frontRef.current) frontRef.current.currentTime = target;
    if (rearRef.current) rearRef.current.currentTime = target;
    onTimeUpdate?.(target);
  }, [seekRequest, pair?.durationSec, onTimeUpdate]);

  useEffect(() => {
    const front = frontRef.current;
    const rear = rearRef.current;
    if (!front || !rear) return;

    const syncTime = () => {
      rear.currentTime = front.currentTime;
    };
    front.addEventListener("timeupdate", syncTime);

    const playHandler = () => {
      rear.currentTime = front.currentTime;
      front.play();
      rear.play();
      setIsPlaying(true);
    };

    front.addEventListener("play", playHandler);
    rear.addEventListener("play", playHandler);
    front.addEventListener("playing", playHandler);

    const pausedHandler = () => {
      front.pause();
      rear.pause();
      setIsPlaying(false);
    };

    front.addEventListener("pause", pausedHandler);
    rear.addEventListener("pause", pausedHandler);

    return () => {
      front.removeEventListener("timeupdate", syncTime);
      front.removeEventListener("play", playHandler);
      rear.removeEventListener("play", playHandler);
      front.removeEventListener("playing", playHandler);
      front.removeEventListener("pause", pausedHandler);
      rear.removeEventListener("pause", pausedHandler);
    };
  }, [frontRef.current, rearRef.current]);

  const marks = useMemo(() => {
    const timelineMarks = getMinMarksForLength(pair?.durationSec || 0);
    for (const poi of pois) {
      const poiIndicator = (
        <Box
          component="span"
          title={`${poi.label} at ${formatTime(poi.timeSec)}`}
          sx={{ color: "#f97316" }}>
          ◆
        </Box>
      );
      const existingMark = timelineMarks.find(
        (mark) => Math.abs(mark.value - poi.timeSec) < 0.01,
      );
      if (existingMark) {
        existingMark.label = (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <span>{existingMark.label}</span>
            {poiIndicator}
          </Stack>
        );
      } else {
        timelineMarks.push({ value: poi.timeSec, label: poiIndicator });
      }
    }
    return timelineMarks.sort((a, b) => a.value - b.value);
  }, [pair?.durationSec, pois]);

  if (!pair)
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
        }}>
        No video selected
      </Box>
    );

  return (
    <Stack direction="column" sx={{ width: "100%", height: "100%" }}>
      <Stack spacing={0} sx={{ width: "100%" }} direction="column">
        {/* Player Controls */}
        {/* Without the key prop, the slider doesn't re-render correctly, keeping the old marks */}
        <Slider
          key={pair.id + "-slider"}
          value={frontRef.current?.currentTime || 0}
          min={0}
          step={1}
          max={pair.durationSec || 60}
          aria-label="Video progress"
          onChange={(_, newValue) => {
            if (frontRef.current)
              frontRef.current.currentTime = newValue as number;

            if (rearRef.current)
              rearRef.current.currentTime = newValue as number;
          }}
          marks={marks}
          sx={{ mb: 2, marginInline: 3, width: "auto" }}
        />

        <Stack direction="row" spacing={1} alignItems="center">
          <ButtonGroup>
            <IconButton
              aria-label={isPlaying ? "Pause videos" : "Play videos"}
              onClick={isPlaying ? onPauseBoth : onPlayBoth}>
              {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
            </IconButton>
            <IconButton aria-label="Stop videos" onClick={onStopBoth}>
              <StopIcon />
            </IconButton>
          </ButtonGroup>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flex: 1 }}>
            {frontRef.current?.currentTime !== undefined &&
              pair.durationSec !== undefined && (
                <Typography
                  level="body-sm"
                  sx={{ color: "text.secondary" }}
                  fontFamily="monospace">
                  {formatTime(frontRef.current.currentTime)} /{" "}
                  {formatTime(pair.durationSec)}
                </Typography>
              )}
            {/* Volume Control */}
            <Stack direction="row" spacing={0.5} alignItems="center">
              <IconButton
                aria-label={volume > 0 ? "Mute audio" : "Unmute audio"}
                size="sm"
                color="neutral"
                onClick={() => {
                  if (volume > 0) {
                    lastAudibleVolumeRef.current = volume;
                    setVolume(0);
                  } else {
                    setVolume(lastAudibleVolumeRef.current || 1);
                  }
                }}>
                {volume > 0 ? <VolumeUpIcon /> : <VolumeOffIcon />}
              </IconButton>
              <Slider
                value={volume}
                onChange={(_, newValue) => {
                  const nextVolume = newValue as number;
                  if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
                  setVolume(nextVolume);
                }}
                min={0}
                max={1}
                step={0.1}
                sx={{ width: 100 }}
              />
            </Stack>

            <Box sx={{ flex: 1 }} />

            <IconButton
              aria-label="Mark point of interest"
              size="sm"
              color="warning"
              variant="outlined"
              onClick={handleOpenPoiDialog}>
              <AddLocationAltIcon />
            </IconButton>

            {/* Create Clip Button */}
            <IconButton
              aria-label="Create clip"
              size="sm"
              color="primary"
              variant="outlined"
              onClick={handleOpenClipDialog}>
              <ContentCutIcon />
            </IconButton>

            {/* Capture Frame Buttons */}
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    color: "neutral",
                    variant: "outlined",
                  },
                }}>
                <CameraAltIcon />
              </MenuButton>
              <Menu placement="bottom-end">
                <MenuItem
                  onClick={() => handleCapture("front", "download")}
                  disabled={!pair.channels.front && !pair.channels.rear}>
                  <ListItemDecorator>
                    <DownloadIcon />
                  </ListItemDecorator>
                  Download {pair.channels.front ? "Front" : "Rear"} Frame
                </MenuItem>
                <MenuItem
                  onClick={() => handleCapture("front", "copy")}
                  disabled={!pair.channels.front && !pair.channels.rear}>
                  <ListItemDecorator>
                    <ContentCopyIcon />
                  </ListItemDecorator>
                  Copy {pair.channels.front ? "Front" : "Rear"} to Clipboard
                </MenuItem>
                {pair.channels.rear && pair.channels.front && (
                  <>
                    <MenuItem onClick={() => handleCapture("rear", "download")}>
                      <ListItemDecorator>
                        <DownloadIcon />
                      </ListItemDecorator>
                      Download Rear Frame
                    </MenuItem>
                    <MenuItem onClick={() => handleCapture("rear", "copy")}>
                      <ListItemDecorator>
                        <ContentCopyIcon />
                      </ListItemDecorator>
                      Copy Rear to Clipboard
                    </MenuItem>
                  </>
                )}
              </Menu>
            </Dropdown>

            <Typography level="title-md">{formatPairTime(pair)}</Typography>
          </Stack>
        </Stack>
      </Stack>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ flex: 1 }}
        justifyContent="center">
        <Stack
          direction="column"
          spacing={1}
          ref={frontContainerRef}
          sx={{
            flexBasis: "50%",
            maxHeight: "100%",
            position: "relative",
            "&:fullscreen": {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          }}
          alignItems="center">
          <Typography level="title-lg" sx={{ color: "text.secondary" }}>
            {pair.channels.front ? "Front" : "Rear"} Camera
          </Typography>
          <Box
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              backgroundColor: "black",
              display: "flex",
              justifyContent: "center",
            }}>
            <video
              ref={frontRef}
              src={
                pair.channels.front
                  ? videoSourceUrl(pair.id, "front")
                  : pair.channels.rear
                    ? videoSourceUrl(pair.id, "rear")
                    : undefined
              }
              title={pair.channels.front ? "Front" : "Rear"}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                width:
                  isFullscreen && fullscreenCamera === "front"
                    ? "100%"
                    : "auto",
                height:
                  isFullscreen && fullscreenCamera === "front"
                    ? "100%"
                    : "auto",
                objectFit: "contain",
              }}>
              <track kind="captions" label="Captions" src="" default />
            </video>
            {/* Fullscreen button */}
            <IconButton
              size="sm"
              variant="solid"
              color="neutral"
              onClick={() => handleFullscreen("front")}
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                opacity: 0.7,
                "&:hover": { opacity: 1 },
              }}>
              <FullscreenIcon />
            </IconButton>
            {/* Fullscreen controls overlay */}
            {isFullscreen && fullscreenCamera === "front" && (
              <Box
                sx={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                  padding: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}>
                <Slider
                  value={frontRef.current?.currentTime || 0}
                  min={0}
                  step={1}
                  max={pair.durationSec || 60}
                  onChange={(_, newValue) => {
                    if (frontRef.current)
                      frontRef.current.currentTime = newValue as number;
                    if (rearRef.current)
                      rearRef.current.currentTime = newValue as number;
                  }}
                  sx={{ color: "white", mx: 3, width: "auto" }}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <ButtonGroup>
                    <IconButton
                      onClick={isPlaying ? onPauseBoth : onPlayBoth}
                      sx={{ color: "white" }}>
                      {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                    </IconButton>
                    <IconButton onClick={onStopBoth} sx={{ color: "white" }}>
                      <StopIcon />
                    </IconButton>
                  </ButtonGroup>
                  <Typography
                    level="body-sm"
                    sx={{ color: "white" }}
                    fontFamily="monospace">
                    {formatTime(frontRef.current?.currentTime || 0)} /{" "}
                    {formatTime(pair.durationSec || 0)}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <IconButton
                    onClick={handleExitFullscreen}
                    sx={{ color: "white" }}>
                    <FullscreenExitIcon />
                  </IconButton>
                </Stack>
              </Box>
            )}
          </Box>
        </Stack>
        {pair.channels.front && pair.channels.rear && (
          <Stack
            direction="column"
            spacing={1}
            ref={rearContainerRef}
            sx={{
              flexBasis: "50%",
              maxHeight: "100%",
              position: "relative",
              "&:fullscreen": {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              },
            }}
            alignItems="center">
            <Typography level="title-lg" sx={{ color: "text.secondary" }}>
              Rear Camera
            </Typography>
            <Box
              sx={{
                position: "relative",
                width: "100%",
                height: "100%",
                backgroundColor: "black",
                display: "flex",
                justifyContent: "center",
              }}>
              <video
                ref={rearRef}
                src={videoSourceUrl(pair.id, "rear")}
                title="Rear"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width:
                    isFullscreen && fullscreenCamera === "rear"
                      ? "100%"
                      : "auto",
                  height:
                    isFullscreen && fullscreenCamera === "rear"
                      ? "100%"
                      : "auto",
                  objectFit: "contain",
                }}>
                <track kind="captions" label="Captions" src="" default />
              </video>
              {/* Fullscreen button */}
              <IconButton
                size="sm"
                variant="solid"
                color="neutral"
                onClick={() => handleFullscreen("rear")}
                sx={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  opacity: 0.7,
                  "&:hover": { opacity: 1 },
                }}>
                <FullscreenIcon />
              </IconButton>
              {/* Fullscreen controls overlay */}
              {isFullscreen && fullscreenCamera === "rear" && (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                    padding: 2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}>
                  <Slider
                    value={rearRef.current?.currentTime || 0}
                    min={0}
                    step={1}
                    max={pair.durationSec || 60}
                    onChange={(_, newValue) => {
                      if (frontRef.current)
                        frontRef.current.currentTime = newValue as number;
                      if (rearRef.current)
                        rearRef.current.currentTime = newValue as number;
                    }}
                    sx={{ color: "white", mx: 3, width: "auto" }}
                  />
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ButtonGroup>
                      <IconButton
                        onClick={isPlaying ? onPauseBoth : onPlayBoth}
                        sx={{ color: "white" }}>
                        {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                      </IconButton>
                      <IconButton onClick={onStopBoth} sx={{ color: "white" }}>
                        <StopIcon />
                      </IconButton>
                    </ButtonGroup>
                    <Typography
                      level="body-sm"
                      sx={{ color: "white" }}
                      fontFamily="monospace">
                      {formatTime(rearRef.current?.currentTime || 0)} /{" "}
                      {formatTime(pair.durationSec || 0)}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <IconButton
                      onClick={handleExitFullscreen}
                      sx={{ color: "white" }}>
                      <FullscreenExitIcon />
                    </IconButton>
                  </Stack>
                </Box>
              )}
            </Box>
          </Stack>
        )}
      </Stack>

      <Modal open={showPoiDialog} onClose={() => setShowPoiDialog(false)}>
        <ModalDialog sx={{ width: "min(520px, calc(100vw - 32px))" }}>
          <DialogTitle>Points of interest</DialogTitle>
          <DialogContent>
            Mark something visible at {formatTime(poiTimeSec)} or jump to an
            existing marker.
          </DialogContent>
          <Stack spacing={1.5}>
            <FormControl>
              <FormLabel>POI label</FormLabel>
              <Input
                autoFocus
                value={poiLabel}
                placeholder="What is visible here?"
                slotProps={{ input: { maxLength: 120 } }}
                onChange={(event) => setPoiLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreatePoi();
                }}
              />
            </FormControl>

            <Button
              startDecorator={<AddLocationAltIcon />}
              loading={poiSaving}
              disabled={!poiLabel.trim() || !onCreatePoi}
              onClick={() => void handleCreatePoi()}>
              Add POI at {formatTime(poiTimeSec)}
            </Button>

            {poiError && (
              <Typography color="danger" level="body-sm">
                {poiError}
              </Typography>
            )}

            <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
              {poisLoading ? (
                <Typography level="body-sm">Loading POIs…</Typography>
              ) : pois.length === 0 ? (
                <Typography level="body-sm" sx={{ color: "text.secondary" }}>
                  No points of interest marked yet.
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {pois.map((poi) => (
                    <Stack
                      key={poi.id}
                      direction="row"
                      spacing={0.5}
                      alignItems="center">
                      <Button
                        variant="plain"
                        color="neutral"
                        startDecorator={<LocationOnIcon color="warning" />}
                        onClick={() => {
                          seekTo(poi.timeSec);
                          setShowPoiDialog(false);
                        }}
                        sx={{ flex: 1, justifyContent: "flex-start" }}>
                        {formatTime(poi.timeSec)} · {poi.label}
                      </Button>
                      <IconButton
                        aria-label={`Delete ${poi.label}`}
                        color="danger"
                        variant="plain"
                        onClick={() => void handleDeletePoi(poi.id)}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
          <DialogActions>
            <Button
              variant="plain"
              color="neutral"
              onClick={() => setShowPoiDialog(false)}>
              Close
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>

      {/* Clip Creation Dialog */}
      <Modal open={showClipDialog} onClose={handleCloseClipDialog}>
        <ModalDialog sx={{ minWidth: 600, maxWidth: 1000, overflow: "hidden" }}>
          <DialogTitle>Create Video Clip</DialogTitle>
          <DialogContent sx={{ overflow: "visible", p: 1 }}>
            <Stack spacing={3}>
              {/* Preview Frames */}
              <Stack direction="row" spacing={2} justifyContent="center">
                <Box sx={{ textAlign: "center" }}>
                  <Typography level="body-sm" sx={{ mb: 1 }}>
                    Start: {formatTime(clipStartTime)}
                  </Typography>
                  <canvas
                    ref={startPreviewCanvasRef}
                    style={{
                      maxWidth: "100%",
                      height: "auto",
                      border: "2px solid",
                      borderColor: "primary.500",
                      borderRadius: "4px",
                    }}
                  />
                </Box>
                <Box sx={{ textAlign: "center" }}>
                  <Typography level="body-sm" sx={{ mb: 1 }}>
                    End: {formatTime(clipEndTime)}
                  </Typography>
                  <canvas
                    ref={endPreviewCanvasRef}
                    style={{
                      maxWidth: "100%",
                      height: "auto",
                      border: "2px solid",
                      borderColor: "primary.500",
                      borderRadius: "4px",
                    }}
                  />
                </Box>
              </Stack>

              {/* Time Range Slider */}
              <FormControl>
                <FormLabel>
                  Clip Range: {formatTime(clipStartTime)} →{" "}
                  {formatTime(clipEndTime)} (Duration:{" "}
                  {formatTime(clipEndTime - clipStartTime)})
                </FormLabel>
                <Slider
                  disabled={isCreatingClip}
                  value={[clipStartTime, clipEndTime]}
                  onChange={(_, value) => {
                    const [_start, _end] = value as number[];
                    if (_start === _end) return; // Prevent zero-length clips

                    const startChanged = _start !== clipStartTime;
                    const endChanged = _end !== clipEndTime;

                    if (startChanged) setClipStartTime(_start);
                    if (endChanged) setClipEndTime(_end);

                    // Only update the preview that changed
                    if (startChanged && endChanged) {
                      updatePreviewFrames("both");
                    } else if (startChanged) {
                      updatePreviewFrames("start");
                    } else if (endChanged) {
                      updatePreviewFrames("end");
                    }
                  }}
                  min={0}
                  max={pair?.durationSec || 100}
                  step={0.1}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => formatTime(value)}
                  disableSwap
                />
              </FormControl>

              <FormControl>
                <FormLabel>Channel(s)</FormLabel>
                <RadioGroup
                  value={clipChannels}
                  onChange={(e) =>
                    setClipChannels(e.target.value as typeof clipChannels)
                  }>
                  {pair?.channels.front && (
                    <Radio
                      disabled={isCreatingClip}
                      value="front"
                      label="Front only"
                    />
                  )}
                  {pair?.channels.rear && (
                    <Radio
                      disabled={isCreatingClip}
                      value="rear"
                      label="Rear only"
                    />
                  )}
                  {pair?.channels.front && pair?.channels.rear && (
                    <>
                      <Radio
                        disabled={isCreatingClip}
                        value="both-side-by-side"
                        label="Both (side by side)"
                      />
                      <Radio
                        disabled={isCreatingClip}
                        value="both-stacked"
                        label="Both (stacked)"
                      />
                    </>
                  )}
                </RadioGroup>
              </FormControl>

              <FormControl>
                <FormLabel>
                  Audio Volume:{" "}
                  {clipAudioVolume === 0
                    ? "Muted"
                    : `${Math.round(clipAudioVolume * 100)}%`}
                </FormLabel>
                <Slider
                  value={clipAudioVolume}
                  onChange={(_, value) => setClipAudioVolume(value as number)}
                  min={0}
                  max={1}
                  step={0.1}
                  marks={[
                    { value: 0, label: "Mute" },
                    { value: 0.5, label: "50%" },
                    { value: 1, label: "100%" },
                  ]}
                  disabled={isCreatingClip}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
                />
              </FormControl>

              {isCreatingClip && (
                <Box>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    sx={{ mb: 0.75 }}>
                    <Typography level="body-sm">
                      {clipJobStatus?.progress.phase === "finalizing"
                        ? "Finalizing clip…"
                        : clipJobStatus?.state === "queued"
                          ? "Waiting to start…"
                          : "Generating clip…"}
                    </Typography>
                    <Typography level="body-sm" fontWeight="lg">
                      {Math.round(clipJobStatus?.progress.percent ?? 0)}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    determinate
                    value={clipJobStatus?.progress.percent ?? 0}
                    aria-label="Clip generation progress"
                  />
                  {clipJobStatus?.progress && (
                    <Typography level="body-xs" sx={{ mt: 0.75 }}>
                      {formatTime(clipJobStatus.progress.processedSeconds)} of{" "}
                      {formatTime(clipJobStatus.progress.durationSeconds)}
                      {clipJobStatus.progress.speed !== undefined &&
                        ` • ${clipJobStatus.progress.speed.toFixed(2)}× encoding speed`}
                    </Typography>
                  )}
                </Box>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              color="neutral"
              disabled={isCreatingClip}
              onClick={handleCloseClipDialog}>
              Cancel
            </Button>
            <Button
              variant="solid"
              color="primary"
              onClick={handleCreateClip}
              loading={isCreatingClip}
              disabled={clipEndTime <= clipStartTime}>
              Create Clip
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Stack>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Typography from "@mui/joy/Typography";
import Alert from "@mui/joy/Alert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  buildGpxDocument,
  cropGpxTrack,
  parseGpxTrackPoints,
} from "../utils/gpx";
import { storeRecordedGpx } from "../api";

type Props = {
  videoId: string;
  startTime?: string | null;
  durationSec?: number | null;
  onStored?: () => void;
  overwrite?: boolean;
  compact?: boolean;
};

export default function VideoGpxUploader({
  videoId,
  startTime,
  durationSec,
  onStored,
  overwrite = false,
  compact = false,
}: Readonly<Props>) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const currentVideoId = useRef(videoId);

  useEffect(() => {
    currentVideoId.current = videoId;
    setError(null);
    setSuccess(false);
  }, [videoId]);

  const endTime =
    startTime && Number.isFinite(durationSec ?? Number.NaN)
      ? new Date(
          new Date(startTime).getTime() + (durationSec || 0) * 1000,
        ).toISOString()
      : null;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    setError(null);
    setSuccess(false);
    if (!file) return;

    if (!startTime || !endTime) {
      setError("Video timing unavailable.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const gpxText = await file.text();
      const points = parseGpxTrackPoints(gpxText);
      const cropped = cropGpxTrack(points, startTime, endTime);

      if (cropped.length === 0) {
        throw new Error("No GPS points fell within video window.");
      }

      const output = buildGpxDocument(
        cropped,
        `${videoId} GPS`,
        `Auto-cropped to video window from ${file.name}`,
      );

      await storeRecordedGpx(videoId, output);
      if (currentVideoId.current === videoId) {
        await onStored?.();
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to crop GPX file");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        ...(compact
          ? {}
          : {
              p: 2,
              borderRadius: "md",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.surface",
              boxShadow: "sm",
            }),
      }}>
      {!compact && (
        <>
          <Typography level="title-sm">
            {overwrite ? "Replace GPS data" : "No GPS in video"}
          </Typography>
          <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
            Select a day or multi-day GPX file. It is cropped to the video time
            span and uploaded immediately.
          </Typography>
        </>
      )}

      <Button
        component="label"
        variant={overwrite ? "solid" : "soft"}
        color={overwrite ? "warning" : "primary"}
        size="sm"
        loading={processing}
        disabled={processing || !startTime || !endTime}
        startDecorator={<UploadFileIcon />}
        sx={{ alignSelf: "flex-start" }}>
        {overwrite ? "Overwrite GPS with GPX" : "Choose GPX file"}
        <input
          hidden
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          onChange={handleFileChange}
        />
      </Button>

      {error && <Alert color="danger">{error}</Alert>}
      {success && overwrite && <Alert color="success">GPS overwritten.</Alert>}
    </Box>
  );
}

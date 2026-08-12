import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Typography from "@mui/joy/Typography";
import Alert from "@mui/joy/Alert";
import Autocomplete from "@mui/joy/Autocomplete";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { storeRecordedGpx, type VideoPair } from "../api";

type Props = {
  videoId: string;
  startTime?: string | null;
  durationSec?: number | null;
  dashcamTimeZone: string;
  onStored?: (updatedPair: VideoPair) => void;
  overwrite?: boolean;
  compact?: boolean;
};

export default function VideoGpxUploader({
  videoId,
  startTime,
  durationSec,
  dashcamTimeZone,
  onStored,
  overwrite = false,
  compact = false,
}: Readonly<Props>) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [timeZone, setTimeZone] = useState(dashcamTimeZone);
  const currentVideoId = useRef(videoId);

  const timeZoneOptions = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [];
    return [...new Set([dashcamTimeZone, "UTC", "Etc/GMT-2", ...supported])];
  }, [dashcamTimeZone]);

  useEffect(() => {
    currentVideoId.current = videoId;
    setError(null);
    setSuccess(false);
    setTimeZone(dashcamTimeZone);
  }, [dashcamTimeZone, videoId]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    setError(null);
    setSuccess(false);
    if (!file) return;

    if (!startTime || !Number.isFinite(durationSec ?? Number.NaN)) {
      setError("Video timing unavailable.");
      return;
    }
    if (!timeZone.trim()) {
      setError("Select a dashcam time zone.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const gpxText = await file.text();
      const result = await storeRecordedGpx(videoId, gpxText, timeZone);
      if (currentVideoId.current === videoId) {
        onStored?.(result.pair);
        setSuccess(true);
      }
    } catch (err: any) {
      setError(
        err?.response?.data?.error || err?.message || "Failed to crop GPX file",
      );
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

      <FormControl size="sm" sx={{ width: compact ? 220 : "100%" }}>
        <FormLabel>Dashcam time zone</FormLabel>
        <Autocomplete
          freeSolo
          size="sm"
          options={timeZoneOptions}
          value={timeZone}
          onChange={(_event, value) => setTimeZone(value || "")}
          onInputChange={(_event, value) => setTimeZone(value)}
          slotProps={{
            input: {
              "aria-label": "Dashcam time zone",
            },
          }}
        />
      </FormControl>

      <Button
        component="label"
        variant={overwrite ? "solid" : "soft"}
        color={overwrite ? "warning" : "primary"}
        size="sm"
        loading={processing}
        disabled={
          processing ||
          !startTime ||
          !Number.isFinite(durationSec ?? Number.NaN) ||
          !timeZone.trim()
        }
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

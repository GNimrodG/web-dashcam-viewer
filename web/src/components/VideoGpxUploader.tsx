import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Typography from "@mui/joy/Typography";
import Alert from "@mui/joy/Alert";
import Autocomplete from "@mui/joy/Autocomplete";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import Input from "@mui/joy/Input";
import Checkbox from "@mui/joy/Checkbox";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import DialogTitle from "@mui/joy/DialogTitle";
import DialogContent from "@mui/joy/DialogContent";
import DialogActions from "@mui/joy/DialogActions";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { storeRecordedGpx, type VideoPair } from "../api";

function formatBrowserLocalDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number: number) => number.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseBrowserLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "browser time";
}

type Props = {
  videoId: string;
  startTime?: string | null;
  durationSec?: number | null;
  dashcamTimeZone: string;
  recordingStartTimeOverride?: string | null;
  onStored?: (updatedPair: VideoPair) => void;
  overwrite?: boolean;
  compact?: boolean;
};

export default function VideoGpxUploader({
  videoId,
  startTime,
  durationSec,
  dashcamTimeZone,
  recordingStartTimeOverride,
  onStored,
  overwrite = false,
  compact = false,
}: Readonly<Props>) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [timeZone, setTimeZone] = useState(dashcamTimeZone);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [useExplicitStartTime, setUseExplicitStartTime] = useState(
    !!recordingStartTimeOverride,
  );
  const [recordingStartLocal, setRecordingStartLocal] = useState(
    formatBrowserLocalDateTime(recordingStartTimeOverride || startTime),
  );
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
    setUseExplicitStartTime(!!recordingStartTimeOverride);
    setRecordingStartLocal(
      formatBrowserLocalDateTime(recordingStartTimeOverride || startTime),
    );
    setProcessing(false);
    setUploadMenuOpen(false);
  }, [dashcamTimeZone, recordingStartTimeOverride, startTime, videoId]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    setError(null);
    setSuccess(false);
    if (!file) return;

    if (
      (!startTime && !useExplicitStartTime) ||
      !Number.isFinite(durationSec ?? Number.NaN)
    ) {
      setError("Video timing unavailable.");
      return;
    }
    if (!timeZone.trim()) {
      setError("Select a dashcam time zone.");
      return;
    }

    const explicitStartTime = useExplicitStartTime
      ? parseBrowserLocalDateTime(recordingStartLocal)
      : null;
    if (useExplicitStartTime && !explicitStartTime) {
      setError("Enter a valid recording start time.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const gpxText = await file.text();
      const result = await storeRecordedGpx(
        videoId,
        gpxText,
        timeZone,
        explicitStartTime,
      );
      if (currentVideoId.current === videoId) {
        onStored?.(result.pair);
        setSuccess(true);
        setUploadMenuOpen(false);
      }
    } catch (err: any) {
      if (currentVideoId.current === videoId) {
        setError(
          err?.response?.data?.error ||
            err?.message ||
            "Failed to crop GPX file",
        );
      }
    } finally {
      if (currentVideoId.current === videoId) setProcessing(false);
    }
  };

  const handleOpenUploadMenu = () => {
    setError(null);
    setSuccess(false);
    setUploadMenuOpen(true);
  };

  const handleCloseUploadMenu = () => {
    if (processing) return;
    setError(null);
    setUploadMenuOpen(false);
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
        variant={overwrite ? "solid" : "soft"}
        color={overwrite ? "warning" : "primary"}
        size="sm"
        loading={processing}
        disabled={processing || !Number.isFinite(durationSec ?? Number.NaN)}
        startDecorator={<UploadFileIcon />}
        onClick={handleOpenUploadMenu}
        sx={{ alignSelf: "flex-start" }}>
        {overwrite ? "Overwrite GPS with GPX" : "Upload GPX file"}
      </Button>

      {success && overwrite && <Alert color="success">GPS overwritten.</Alert>}

      <Modal open={uploadMenuOpen} onClose={handleCloseUploadMenu}>
        <ModalDialog
          sx={{
            boxSizing: "border-box",
            width: 440,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100dvh - 32px)",
            minWidth: 0,
            overflow: "hidden",
          }}>
          <DialogTitle>
            {overwrite ? "Overwrite GPS data" : "Upload GPX data"}
          </DialogTitle>
          <DialogContent
            sx={{
              minWidth: 0,
              overflowX: "hidden",
              overflowY: "auto",
              height: "100%",
              py: 1,
            }}>
            <Typography level="body-sm" sx={{ mb: 2 }}>
              Use the dashcam time zone to derive the start from the filename,
              or enter the recording start explicitly. Upload begins immediately
              after selecting a GPX file.
            </Typography>
            <FormControl size="sm" sx={{ minWidth: 0, width: "100%" }}>
              <FormLabel>Dashcam time zone (filename-based start)</FormLabel>
              <Autocomplete
                freeSolo
                size="sm"
                sx={{ minWidth: 0, width: "100%" }}
                options={timeZoneOptions}
                value={timeZone}
                disabled={processing || useExplicitStartTime}
                onChange={(_event, value) => setTimeZone(value || "")}
                onInputChange={(_event, value) => setTimeZone(value)}
                slotProps={{
                  input: {
                    "aria-label": "Dashcam time zone",
                  },
                }}
              />
            </FormControl>
            <Checkbox
              checked={useExplicitStartTime}
              disabled={processing}
              label="Set recording start time explicitly"
              sx={{ mt: 2 }}
              onChange={(event) => {
                const checked = event.target.checked;
                setUseExplicitStartTime(checked);
                if (checked && !recordingStartLocal) {
                  setRecordingStartLocal(formatBrowserLocalDateTime(startTime));
                }
              }}
            />
            {useExplicitStartTime && (
              <FormControl
                size="sm"
                sx={{ mt: 1.5, minWidth: 0, width: "100%" }}>
                <FormLabel>Recording starts (browser local time)</FormLabel>
                <Input
                  type="datetime-local"
                  value={recordingStartLocal}
                  disabled={processing}
                  sx={{ minWidth: 0, width: "100%" }}
                  slotProps={{ input: { step: 1 } }}
                  onChange={(event) =>
                    setRecordingStartLocal(event.target.value)
                  }
                />
                <Typography level="body-xs" sx={{ mt: 0.5 }}>
                  Interpreted in {getBrowserTimeZone()}.
                </Typography>
              </FormControl>
            )}
            {error && (
              <Alert color="danger" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions sx={{ minWidth: 0, flexWrap: "wrap" }}>
            <Button
              variant="plain"
              color="neutral"
              disabled={processing}
              onClick={handleCloseUploadMenu}>
              Cancel
            </Button>
            <Button
              component="label"
              variant="solid"
              color={overwrite ? "warning" : "primary"}
              loading={processing}
              disabled={
                processing ||
                (!startTime && !useExplicitStartTime) ||
                !Number.isFinite(durationSec ?? Number.NaN) ||
                !timeZone.trim() ||
                (useExplicitStartTime &&
                  !parseBrowserLocalDateTime(recordingStartLocal))
              }
              startDecorator={<UploadFileIcon />}>
              Choose GPX file
              <input
                hidden
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml"
                onChange={handleFileChange}
              />
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

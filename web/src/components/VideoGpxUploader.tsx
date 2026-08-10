import { useState, type ChangeEvent } from "react";
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
};

export default function VideoGpxUploader({
  videoId,
  startTime,
  durationSec,
  onStored,
}: Readonly<Props>) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endTime =
    startTime && Number.isFinite(durationSec ?? Number.NaN)
      ? new Date(
          new Date(startTime).getTime() + (durationSec || 0) * 1000,
        ).toISOString()
      : null;

  const canCrop = !!selectedFile && !!startTime && !!endTime;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setError(null);
  };

  const handleCrop = async () => {
    if (!selectedFile) {
      setError("Choose GPX file first.");
      return;
    }

    if (!startTime || !endTime) {
      setError("Video timing unavailable.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const gpxText = await selectedFile.text();
      const points = parseGpxTrackPoints(gpxText);
      const cropped = cropGpxTrack(points, startTime, endTime);

      if (cropped.length === 0) {
        throw new Error("No GPS points fell within video window.");
      }

      const output = buildGpxDocument(
        cropped,
        `${videoId} GPS`,
        `Auto-cropped to video window from ${selectedFile.name}`,
      );

      await storeRecordedGpx(videoId, output);
      onStored?.();
      setSelectedFile(null);
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
        p: 2,
        borderRadius: "md",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.surface",
        boxShadow: "sm",
      }}>
      <Typography level="title-sm">No GPS in video</Typography>
      <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
        Upload day GPX. App crops it to video time span automatically.
      </Typography>

      <Button
        component="label"
        variant="soft"
        size="sm"
        startDecorator={<UploadFileIcon />}
        sx={{ alignSelf: "flex-start" }}>
        {selectedFile ? selectedFile.name : "Upload GPX file"}
        <input
          hidden
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          onChange={handleFileChange}
        />
      </Button>

      <Button
        size="sm"
        variant="solid"
        startDecorator={<UploadFileIcon />}
        onClick={handleCrop}
        loading={processing}
        disabled={!canCrop}>
        Upload GPX
      </Button>

      {error && <Alert color="danger">{error}</Alert>}
    </Box>
  );
}

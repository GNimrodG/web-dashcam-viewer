import { useState, type ChangeEvent } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Typography from "@mui/joy/Typography";
import Alert from "@mui/joy/Alert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import {
  buildGpxDocument,
  cropGpxTrack,
  downloadTextFile,
  parseGpxTrackPoints,
} from "../utils/gpx";

type Props = {
  clipLabel: string;
  clipStartAt?: string | null;
  clipEndAt?: string | null;
};

function makeOutputName(label: string): string {
  const base = label.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_");
  return `${base || "clip"}_cropped.gpx`;
}

export default function GpxCropper({
  clipLabel,
  clipStartAt,
  clipEndAt,
}: Readonly<Props>) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCrop = !!selectedFile && !!clipStartAt && !!clipEndAt;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setError(null);
  };

  const handleCrop = async () => {
    if (!selectedFile) {
      setError("Choose a GPX file first.");
      return;
    }

    if (!clipStartAt || !clipEndAt) {
      setError("This clip does not have timing metadata yet.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const gpxText = await selectedFile.text();
      const points = parseGpxTrackPoints(gpxText);
      const cropped = cropGpxTrack(points, clipStartAt, clipEndAt);

      if (cropped.length === 0) {
        throw new Error("No GPS points fell within the clip window.");
      }

      const output = buildGpxDocument(
        cropped,
        `${clipLabel} cropped`,
        `Cropped from ${selectedFile.name}`,
      );

      downloadTextFile(makeOutputName(clipLabel), output);
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
        mt: 1.5,
        p: 1.5,
        borderRadius: "sm",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.surface",
      }}>
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        Upload a full-day GPX log and crop it to this clip window.
      </Typography>

      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        {clipStartAt && clipEndAt
          ? `${new Date(clipStartAt).toLocaleString()} - ${new Date(clipEndAt).toLocaleString()}`
          : "Clip timing metadata unavailable"}
      </Typography>

      <Button
        component="label"
        variant="soft"
        size="sm"
        startDecorator={<UploadFileIcon />}
        sx={{ alignSelf: "flex-start" }}>
        {selectedFile ? selectedFile.name : "Choose GPX file"}
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
        startDecorator={<DownloadIcon />}
        onClick={handleCrop}
        loading={processing}
        disabled={!canCrop}>
        Crop & Download GPX
      </Button>

      {error && <Alert color="danger">{error}</Alert>}
    </Box>
  );
}

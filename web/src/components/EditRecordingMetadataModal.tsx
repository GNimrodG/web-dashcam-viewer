import { useEffect, useState } from "react";
import Button from "@mui/joy/Button";
import DialogActions from "@mui/joy/DialogActions";
import DialogContent from "@mui/joy/DialogContent";
import DialogTitle from "@mui/joy/DialogTitle";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import Input from "@mui/joy/Input";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import Stack from "@mui/joy/Stack";
import Typography from "@mui/joy/Typography";
import { type VideoPair, updatePairOverlayMetadata } from "../api";

interface EditRecordingMetadataModalProps {
  open: boolean;
  pair: VideoPair;
  onClose: () => void;
  onUpdated: (pair: VideoPair) => void;
}

function getErrorMessage(error: unknown): string {
  const responseError = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return (
    responseError.response?.data?.error ||
    responseError.message ||
    "Failed to save recording details"
  );
}

export default function EditRecordingMetadataModal({
  open,
  pair,
  onClose,
  onUpdated,
}: Readonly<EditRecordingMetadataModalProps>) {
  const [cameraType, setCameraType] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCameraType(pair.cameraType || "");
    setLicensePlate(pair.licensePlate || "");
    setError(null);
  }, [open, pair.id, pair.cameraType, pair.licensePlate]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updatedPair = await updatePairOverlayMetadata(pair.id, {
        cameraType,
        licensePlate,
      });
      onUpdated(updatedPair);
      globalThis.dispatchEvent(
        new CustomEvent("recording-overlay-metadata-updated", {
          detail: { pairId: pair.id },
        }),
      );
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={saving ? undefined : onClose}>
      <ModalDialog
        sx={{ width: "min(480px, calc(100vw - 32px))" }}
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}>
        <DialogTitle>Edit recording details</DialogTitle>
        <DialogContent>
          These values replace the OCR result and remain in use if the recording
          is reindexed or scanned again.
        </DialogContent>
        <Stack spacing={2}>
          <FormControl>
            <FormLabel>Camera type</FormLabel>
            <Input
              autoFocus
              value={cameraType}
              placeholder={pair.cameraType || "VIOFO A139 PRO"}
              slotProps={{ input: { maxLength: 100 } }}
              onChange={(event) => setCameraType(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Vehicle license plate</FormLabel>
            <Input
              value={licensePlate}
              placeholder={pair.licensePlate || "ABC123"}
              slotProps={{ input: { maxLength: 40 } }}
              onChange={(event) => setLicensePlate(event.target.value)}
            />
          </FormControl>
          <Typography level="body-xs" color="neutral">
            Leave a field empty to remove the incorrect value.
          </Typography>
          {error && (
            <Typography level="body-sm" color="danger">
              {error}
            </Typography>
          )}
        </Stack>
        <DialogActions>
          <Button
            variant="plain"
            color="neutral"
            disabled={saving}
            onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} type="submit">
            Save corrections
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}

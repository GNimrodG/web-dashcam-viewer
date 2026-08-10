import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import ModalClose from "@mui/joy/ModalClose";
import Typography from "@mui/joy/Typography";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Autocomplete from "@mui/joy/Autocomplete";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import Stack from "@mui/joy/Stack";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import RestoreIcon from "@mui/icons-material/Restore";
import { useState, useEffect, type FunctionComponent } from "react";
import { getUniqueLocations, updatePairLocation, type VideoPair } from "../api";
import { formatPairTime } from "../utils/recording-time";

interface SetLocationModalProps {
  open: boolean;
  onClose: () => void;
  pair: VideoPair | null;
  onUpdate: (updatedPair: VideoPair) => void;
}

const SetLocationModal: FunctionComponent<SetLocationModalProps> = ({
  open,
  onClose,
  pair,
  onUpdate,
}) => {
  const [startCity, setStartCity] = useState("");
  const [startCountry, setStartCountry] = useState("");
  const [endCity, setEndCity] = useState("");
  const [endCountry, setEndCountry] = useState("");
  const [originalStartCity, setOriginalStartCity] = useState("");
  const [originalStartCountry, setOriginalStartCountry] = useState("");
  const [originalEndCity, setOriginalEndCity] = useState("");
  const [originalEndCountry, setOriginalEndCountry] = useState("");
  const [cities, setCities] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && pair) {
      // Set current values
      const sCty = pair.startCity || "";
      const sCtr = pair.startCountry || "";
      const eCty = pair.endCity || "";
      const eCtr = pair.endCountry || "";

      setStartCity(sCty);
      setStartCountry(sCtr);
      setEndCity(eCty);
      setEndCountry(eCtr);

      // Store original values for reset
      setOriginalStartCity(sCty);
      setOriginalStartCountry(sCtr);
      setOriginalEndCity(eCty);
      setOriginalEndCountry(eCtr);

      // Load autocomplete options
      getUniqueLocations().then((locations) => {
        setCities(locations.cities);
        setCountries(locations.countries);
      });
    }
  }, [open, pair]);

  const handleCopyToEnd = () => {
    setEndCity(startCity);
    setEndCountry(startCountry);
  };

  const handleCopyToStart = () => {
    setStartCity(endCity);
    setStartCountry(endCountry);
  };

  const handleResetToOriginal = () => {
    setStartCity(originalStartCity);
    setStartCountry(originalStartCountry);
    setEndCity(originalEndCity);
    setEndCountry(originalEndCountry);
  };

  const handleSave = async () => {
    if (!pair) return;

    setLoading(true);
    try {
      const updatedPair = await updatePairLocation(pair.id, {
        startCity: startCity || undefined,
        startCountry: startCountry || undefined,
        endCity: endCity || undefined,
        endCountry: endCountry || undefined,
      });
      onUpdate(updatedPair);
      onClose();
    } catch (err) {
      console.error("Failed to update location:", err);
      alert("Failed to update location. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  if (!pair) return null;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          minWidth: { xs: "90vw", md: "500px" },
          maxWidth: "600px",
        }}>
        <ModalClose />
        <Typography level="h4" sx={{ mb: 1 }}>
          Set Location
        </Typography>
        <Typography level="body-sm" sx={{ mb: 3 }}>
          {formatPairTime(pair)}
        </Typography>

        <Stack spacing={3}>
          <Box>
            <Typography level="title-md" sx={{ mb: 2 }}>
              Start Location
            </Typography>
            <Stack spacing={2}>
              <FormControl>
                <FormLabel>City</FormLabel>
                <Autocomplete
                  freeSolo
                  options={cities}
                  value={startCity}
                  onInputChange={(_, value) => setStartCity(value || "")}
                  placeholder="Enter city name"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Country</FormLabel>
                <Autocomplete
                  freeSolo
                  options={countries}
                  value={startCountry}
                  onInputChange={(_, value) => setStartCountry(value || "")}
                  placeholder="Enter country name"
                />
              </FormControl>
            </Stack>
          </Box>

          <Box sx={{ display: "flex", gap: 2, justifyContent: "center" }}>
            <Button
              variant="outlined"
              size="sm"
              startDecorator={<ContentCopyIcon />}
              endDecorator={<ArrowDownwardIcon />}
              onClick={handleCopyToEnd}>
              Copy to End
            </Button>
            <Button
              variant="outlined"
              size="sm"
              startDecorator={<ContentCopyIcon />}
              endDecorator={<ArrowUpwardIcon />}
              onClick={handleCopyToStart}>
              Copy to Start
            </Button>
            <Button
              variant="outlined"
              size="sm"
              color="neutral"
              startDecorator={<RestoreIcon />}
              disabled={
                (!originalStartCity &&
                  !originalStartCountry &&
                  !originalEndCity &&
                  !originalEndCountry) ||
                (startCity === originalStartCity &&
                  startCountry === originalStartCountry &&
                  endCity === originalEndCity &&
                  endCountry === originalEndCountry)
              }
              onClick={handleResetToOriginal}>
              Reset
            </Button>
          </Box>

          <Box>
            <Typography level="title-md" sx={{ mb: 2 }}>
              End Location
            </Typography>
            <Stack spacing={2}>
              <FormControl>
                <FormLabel>City</FormLabel>
                <Autocomplete
                  freeSolo
                  options={cities}
                  value={endCity}
                  onInputChange={(_, value) => setEndCity(value || "")}
                  placeholder="Enter city name"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Country</FormLabel>
                <Autocomplete
                  freeSolo
                  options={countries}
                  value={endCountry}
                  onInputChange={(_, value) => setEndCountry(value || "")}
                  placeholder="Enter country name"
                />
              </FormControl>
            </Stack>
          </Box>

          <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
            <Button variant="plain" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={loading}>
              Save Location
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
};

export default SetLocationModal;

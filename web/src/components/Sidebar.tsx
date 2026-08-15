import Box from "@mui/joy/Box";
import GlobalStyles from "@mui/joy/GlobalStyles";
import IconButton from "@mui/joy/IconButton";
import Sheet from "@mui/joy/Sheet";
import Dropdown from "@mui/joy/Dropdown";
import Menu from "@mui/joy/Menu";
import MenuButton from "@mui/joy/MenuButton";
import MenuItem from "@mui/joy/MenuItem";
import {
  useMemo,
  useState,
  useEffect,
  useRef,
  Fragment,
  type FunctionComponent,
  type ChangeEvent,
} from "react";
import Typography from "@mui/joy/Typography";
import { closeSidebar } from "../utils";
import ColorSchemeToggle from "./ColorSchemeToggle";
import Input from "@mui/joy/Input";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import List from "@mui/joy/List";
import ListItem from "@mui/joy/ListItem";
import ListItemButton, { listItemButtonClasses } from "@mui/joy/ListItemButton";
import ListItemContent from "@mui/joy/ListItemContent";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import { useVideoPairs } from "../hooks/useVideoPairs";
import CircularProgress from "@mui/joy/CircularProgress";
import ListItemDecorator from "@mui/joy/ListItemDecorator";
import WarningIcon from "@mui/icons-material/Warning";
import RefreshIcon from "@mui/icons-material/Refresh";
import VideocamIcon from "@mui/icons-material/Videocam";
import EmergencyRecordingIcon from "@mui/icons-material/EmergencyRecording";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import VolumeMuteIcon from "@mui/icons-material/VolumeMute";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import moment from "moment";
import PairLocation from "./PairLocation";
import GpsOffIcon from "@mui/icons-material/GpsOff";
import Chip from "@mui/joy/Chip";
import BackgroundTasksModal from "./BackgroundTasksModal";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import SetLocationModal from "./SetLocationModal";
import EditLocationIcon from "@mui/icons-material/EditLocation";
import {
  VideoPair,
  triggerReindex,
  getAuthStatus,
  loginUrl,
  logout,
  backfillLocations,
  type User,
  fetchPair,
  bulkReplaceRecordedGpx,
} from "../api";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import Button from "@mui/joy/Button";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import { Link, useNavigate } from "react-router-dom";
import UserIcon from "@mui/icons-material/Person";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/joy/Alert";
import MapIcon from "@mui/icons-material/Map";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import LinearProgress from "@mui/joy/LinearProgress";
import Checkbox from "@mui/joy/Checkbox";
import {
  formatPairTime,
  getPairDisplayDate,
  getPairStartTime,
} from "../utils/recording-time";
import { getOcrStatusInfo } from "../utils/ocr-status";

/**
 * Check if a pair is important (has at least one important channel)
 * @param pair Video pair to check
 * @returns True if any channel is marked important
 */
function isImportant(pair: VideoPair): boolean {
  return Object.values(pair.channels).some((ch) => ch?.important);
}

function hasNoPois(pair: VideoPair): boolean {
  return (pair.poiCount ?? 0) === 0;
}

function PairOcrStatus({ pair }: Readonly<{ pair: VideoPair }>) {
  const status = getOcrStatusInfo(pair);
  const scannedAt = pair.overlayMetadataScannedAt
    ? ` Last OCR run: ${moment(pair.overlayMetadataScannedAt).format("LLL")}.`
    : "";

  return (
    <Typography
      level="body-xs"
      color={status.color}
      noWrap
      title={`${status.description}${scannedAt}`}>
      {status.label}
    </Typography>
  );
}

function PairAudioStatusIcon({ pair }: Readonly<{ pair: VideoPair }>) {
  if (pair.audioStatus !== "no-audio" && pair.audioStatus !== "silent") {
    return null;
  }

  const noAudioTrack = pair.audioStatus === "no-audio";
  const label = noAudioTrack
    ? "Recording has no audio track"
    : "Recording audio track contains only silence";
  const Icon = noAudioTrack ? VolumeOffIcon : VolumeMuteIcon;
  return (
    <Box
      component="span"
      aria-label={label}
      title={label}
      sx={{ display: "inline-flex", color: "warning.500" }}>
      <Icon sx={{ fontSize: "1.1rem" }} />
    </Box>
  );
}

interface SidebarProps {
  selectedPairId?: string;
  onSelectPair?: (pair: VideoPair | null) => void;
}

const Sidebar: FunctionComponent<SidebarProps> = ({
  onSelectPair,
  selectedPairId,
}) => {
  const { pairs, loading, error, refresh, updatePair } = useVideoPairs();
  const [search, setSearch] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [withoutPoisOnly, setWithoutPoisOnly] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isBulkGpxUploading, setIsBulkGpxUploading] = useState(false);
  const [bulkGpxProgress, setBulkGpxProgress] = useState<{
    fileName: string;
    phase: "reading" | "uploading" | "processing";
    percent?: number;
  } | null>(null);
  const [bulkGpxStatus, setBulkGpxStatus] = useState<{
    color: "success" | "danger";
    message: string;
  } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [backgroundTasksModalOpen, setBackgroundTasksModalOpen] =
    useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [selectedPairForLocation, setSelectedPairForLocation] =
    useState<VideoPair | null>(null);
  const navigate = useNavigate();
  const selectedItemRef = useRef<HTMLLIElement | null>(null);
  const lastAutoScrolledPairIdRef = useRef<string | undefined>(undefined);
  const bulkGpxInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getAuthStatus().then((status) => {
      setUser(status.user);
      setAuthEnabled(status.authEnabled);
    });
  }, []);

  // Scroll to selected item when sidebar loads or selection changes
  useEffect(() => {
    if (!selectedPairId) {
      lastAutoScrolledPairIdRef.current = undefined;
      return;
    }

    if (
      lastAutoScrolledPairIdRef.current === selectedPairId ||
      !selectedItemRef.current
    ) {
      return;
    }

    selectedItemRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    lastAutoScrolledPairIdRef.current = selectedPairId;
  }, [selectedPairId, pairs]);

  // Listen for GPS data updates to refresh affected pairs
  useEffect(() => {
    const handleGpsUpdated = async (e: Event) => {
      const customEvent = e as CustomEvent<{ pairId: string }>;
      console.log("GPS data updated for pair:", customEvent.detail.pairId);
      // Delay to let server finish updating the index, then fetch updated pair
      setTimeout(async () => {
        try {
          const updatedPair = await fetchPair(customEvent.detail.pairId);
          if (updatedPair) {
            updatePair(updatedPair);
          }
        } catch (err) {
          console.error("Failed to update pair:", err);
        }
      }, 500);
    };

    globalThis.addEventListener("gps-data-updated", handleGpsUpdated);
    return () =>
      globalThis.removeEventListener("gps-data-updated", handleGpsUpdated);
  }, [updatePair]);

  useEffect(() => {
    const handlePoisUpdated = async (event: Event) => {
      const { videoId } = (event as CustomEvent<{ videoId: string }>).detail;
      try {
        const updatedPair = await fetchPair(videoId);
        if (updatedPair) updatePair(updatedPair);
      } catch (err) {
        console.error("Failed to update recording POI indicator:", err);
      }
    };

    globalThis.addEventListener("video-pois-updated", handlePoisUpdated);
    return () =>
      globalThis.removeEventListener("video-pois-updated", handlePoisUpdated);
  }, [updatePair]);

  useEffect(() => {
    const handleMetadataUpdated = async (event: Event) => {
      const { pairId } = (event as CustomEvent<{ pairId: string }>).detail;
      try {
        const updatedPair = await fetchPair(pairId);
        if (updatedPair) updatePair(updatedPair);
      } catch (err) {
        console.error("Failed to update recording metadata:", err);
      }
    };

    globalThis.addEventListener(
      "recording-overlay-metadata-updated",
      handleMetadataUpdated,
    );
    return () =>
      globalThis.removeEventListener(
        "recording-overlay-metadata-updated",
        handleMetadataUpdated,
      );
  }, [updatePair]);

  const handleReindex = async () => {
    setIsReindexing(true);
    try {
      await triggerReindex();
      refresh(); // Refresh the list after reindexing
    } catch (err) {
      console.error("Reindex failed:", err);
      alert("Failed to reindex. Check console for details.");
    } finally {
      setIsReindexing(false);
    }
  };

  const handleGeocodeBackfill = async () => {
    setIsGeocoding(true);
    try {
      const result = await backfillLocations(-1); // unlimited
      console.log(`Geocoded ${result.processed} locations`);
      refresh(); // Refresh the list after geocoding
    } catch (err) {
      console.error("Geocoding backfill failed:", err);
      alert("Failed to geocode locations. Check console for details.");
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleBulkGpxFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !globalThis.confirm(
        `Overwrite GPS for every recording covered by ${file.name}?`,
      )
    ) {
      return;
    }

    setIsBulkGpxUploading(true);
    setBulkGpxProgress({ fileName: file.name, phase: "reading" });
    setBulkGpxStatus(null);
    try {
      const gpxXml = await file.text();
      setBulkGpxProgress({
        fileName: file.name,
        phase: "uploading",
        percent: 0,
      });
      const result = await bulkReplaceRecordedGpx(gpxXml, (percent) => {
        setBulkGpxProgress({
          fileName: file.name,
          phase: percent === 100 ? "processing" : "uploading",
          ...(percent === null ? {} : { percent }),
        });
      });
      setBulkGpxStatus({
        color: result.failed ? "danger" : "success",
        message: `Updated ${result.updated} of ${result.totalRecordings} recordings. Skipped ${result.skipped}; failed ${result.failed}.`,
      });
      refresh();
      globalThis.dispatchEvent(
        new CustomEvent("bulk-gps-updated", {
          detail: { updatedIds: result.updatedIds },
        }),
      );
    } catch (error: any) {
      setBulkGpxStatus({
        color: "danger",
        message:
          error?.response?.data?.error ||
          error?.message ||
          "Bulk GPX upload failed.",
      });
    } finally {
      setIsBulkGpxUploading(false);
      setBulkGpxProgress(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  const handleSetLocation = (pair: VideoPair) => {
    setSelectedPairForLocation(pair);
    setLocationModalOpen(true);
  };

  const handleLocationUpdate = (updatedPair: VideoPair) => {
    updatePair(updatedPair);
  };

  // Filtered list of video pairs based on search query
  const filteredPairs = useMemo(() => {
    const idSearch = search.trim().replaceAll(/\D/g, "").toLowerCase();
    const placeSearch = search.trim().toLowerCase();
    let candidates = importantOnly ? pairs.filter(isImportant) : pairs;
    if (withoutPoisOnly) candidates = candidates.filter(hasNoPois);

    if (!idSearch && !placeSearch) return candidates;

    return candidates.filter(
      (p) =>
        (idSearch && p.id.toLowerCase().includes(idSearch)) ||
        (idSearch &&
          formatPairTime(p).replaceAll(/\D/g, "").includes(idSearch)) ||
        (placeSearch &&
          p.startLocationName?.toLowerCase().includes(placeSearch)) ||
        (placeSearch &&
          p.endLocationName?.toLowerCase().includes(placeSearch)) ||
        (placeSearch && p.cameraType?.toLowerCase().includes(placeSearch)) ||
        (placeSearch && p.licensePlate?.toLowerCase().includes(placeSearch)),
    );
  }, [importantOnly, pairs, search, withoutPoisOnly]);

  const importantPairCount = useMemo(
    () => pairs.filter(isImportant).length,
    [pairs],
  );
  const withoutPoisPairCount = useMemo(
    () => pairs.filter(hasNoPois).length,
    [pairs],
  );

  // Group filtered pairs by Year -> Month -> Day
  const grouped = useMemo(() => {
    type Grouped = Record<string, Record<string, Record<string, typeof pairs>>>;
    const g: Grouped = {};
    for (const p of filteredPairs) {
      const displayDate = getPairDisplayDate(p);
      if (!displayDate) {
        g.Unknown ||= {};
        g.Unknown.Unknown ||= {};
        g.Unknown.Unknown.Unknown ||= [];
        g.Unknown.Unknown.Unknown.push(p);
        continue;
      }
      const [year, month, day] = displayDate.split("-");
      g[year] ||= {};
      g[year][month] ||= {};
      g[year][month][day] ||= [];
      g[year][month][day].push(p);
    }
    return g;
  }, [filteredPairs]);

  const sortedYears = useMemo(
    () => Object.keys(grouped).sort((a, b) => (a < b ? 1 : -1)),
    [grouped],
  );

  const [activeYearForMonths, setActiveYearForMonths] = useState<string | null>(
    null,
  );

  const scrollToId = (id: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /**
   * Detect consecutive important recordings (pairs within ~5min that are both important)
   * @param pairs List of all video pairs
   * @returns Map of pair ID -> consecutive group info
   */
  const consecutiveGroups = useMemo(() => {
    const result = new Map<
      string,
      { position: "start" | "end" | "middle"; groupSize: number }
    >();

    // Sort pairs by ID (timestamp)
    const sorted = [...filteredPairs].sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (!isImportant(current)) continue;

      const currentTimestampMs = getPairStartTime(current);
      const currentTimestamp =
        currentTimestampMs === null ? null : currentTimestampMs / 1000;
      if (currentTimestamp === null) continue;

      // Check if next pair is consecutive and important
      const next = sorted[i + 1];
      const isNextConsecutive =
        next &&
        isImportant(next) &&
        (() => {
          const nextTimestampMs = getPairStartTime(next);
          const nextTimestamp =
            nextTimestampMs === null ? null : nextTimestampMs / 1000;
          if (nextTimestamp === null) return false;
          const diff = Math.abs(nextTimestamp - currentTimestamp);
          // Allow 4-6 minutes (240-360 seconds) for typical 5-min recordings
          return diff >= 240 && diff <= 360;
        })();

      // Check if previous pair is consecutive and important
      const prev = sorted[i - 1];
      const isPrevConsecutive =
        prev &&
        isImportant(prev) &&
        (() => {
          const prevTimestampMs = getPairStartTime(prev);
          const prevTimestamp =
            prevTimestampMs === null ? null : prevTimestampMs / 1000;
          if (prevTimestamp === null) return false;
          const diff = Math.abs(currentTimestamp - prevTimestamp);
          return diff >= 240 && diff <= 360;
        })();

      // Determine position in group
      if (isNextConsecutive || isPrevConsecutive) {
        let position: "start" | "end" | "middle" = "middle";
        if (!isPrevConsecutive) position = "start";
        else if (!isNextConsecutive) position = "end";

        // Calculate group size
        let groupSize = 1;
        if (isPrevConsecutive) groupSize++;
        if (isNextConsecutive) groupSize++;

        result.set(current.id, { position, groupSize });
      }
    }

    return result;
  }, [filteredPairs]);

  const managementMenu = (
    <Dropdown>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{ root: { variant: "outlined", color: "neutral" } }}>
        <MoreVertIcon />
      </MenuButton>
      <Menu placement="top-start" size="sm" sx={{ zIndex: 10001 }}>
        <MenuItem onClick={handleReindex} disabled={isReindexing}>
          <FolderOpenIcon sx={{ mr: 1 }} />
          {isReindexing ? "Re-indexing..." : "Scan for new files"}
        </MenuItem>
        <MenuItem onClick={handleGeocodeBackfill} disabled={isGeocoding}>
          <SearchRoundedIcon sx={{ mr: 1 }} />
          {isGeocoding ? "Geocoding..." : "Backfill locations"}
        </MenuItem>
        <MenuItem
          onClick={() => bulkGpxInputRef.current?.click()}
          disabled={isBulkGpxUploading}>
          <UploadFileIcon sx={{ mr: 1 }} />
          {isBulkGpxUploading ? "Applying GPX..." : "Apply GPX to recordings"}
        </MenuItem>
        <MenuItem onClick={() => setBackgroundTasksModalOpen(true)}>
          <PendingActionsIcon sx={{ mr: 1 }} />
          Post-processing jobs
        </MenuItem>
        <MenuItem onClick={refresh} disabled={loading}>
          <RefreshIcon sx={{ mr: 1 }} />
          {loading ? "Refreshing..." : "Refresh list"}
        </MenuItem>
      </Menu>
    </Dropdown>
  );

  return (
    <Sheet
      className="Sidebar"
      sx={{
        position: { xs: "fixed", md: "sticky" },
        transform: {
          xs: "translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1)))",
          md: "none",
        },
        transition: "transform 0.4s, width 0.4s",
        zIndex: 10000,
        height: "100dvh",
        width: "var(--Sidebar-width)",
        top: 0,
        p: 2,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        borderRight: "1px solid",
        borderColor: "divider",
      }}>
      <GlobalStyles
        styles={(theme) => ({
          ":root": {
            "--Sidebar-width": "280px",
            [theme.breakpoints.up("lg")]: {
              "--Sidebar-width": "300px",
            },
          },
        })}
      />
      <Box
        className="Sidebar-overlay"
        sx={{
          position: "fixed",
          zIndex: 9998,
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          opacity: "var(--SideNavigation-slideIn)",
          backgroundColor: "var(--joy-palette-background-backdrop)",
          transition: "opacity 0.4s",
          transform: {
            xs: "translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--Sidebar-width, 0px)))",
            lg: "translateX(-100%)",
          },
        }}
        onClick={() => closeSidebar()}
      />

      {/* Header */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <IconButton variant="soft" color="primary" size="sm">
          <DirectionsCarIcon />
        </IconButton>
        <Typography level="title-lg">Dashcam viewer</Typography>
        <ColorSchemeToggle sx={{ ml: "auto" }} />
      </Box>

      {/* Auth Section */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          alignItems: "center",
          justifyContent: "space-between",
        }}>
        {user ? (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flex: 1 }}>
            <UserIcon />
            <Typography
              level="body-md"
              sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.preferred_username || user.name || user.email}
            </Typography>
            {managementMenu}
            <IconButton
              size="sm"
              variant="plain"
              onClick={handleLogout}
              title="Logout">
              <LogoutIcon />
            </IconButton>
          </Box>
        ) : authEnabled ? (
          <Button
            size="sm"
            variant="outlined"
            fullWidth
            startDecorator={<LoginIcon />}
            component="a"
            href={loginUrl()}>
            Login
          </Button>
        ) : (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flex: 1 }}>
            <Typography level="body-sm" sx={{ flex: 1 }}>
              Public mode
            </Typography>
            {managementMenu}
          </Box>
        )}
      </Box>

      <input
        ref={bulkGpxInputRef}
        hidden
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        onChange={handleBulkGpxFile}
      />

      {bulkGpxStatus && (
        <Alert
          color={bulkGpxStatus.color}
          size="sm"
          endDecorator={
            <IconButton
              size="sm"
              variant="plain"
              color={bulkGpxStatus.color}
              onClick={() => setBulkGpxStatus(null)}>
              <CloseIcon />
            </IconButton>
          }>
          {bulkGpxStatus.message}
        </Alert>
      )}

      <Modal open={isBulkGpxUploading}>
        <ModalDialog
          aria-labelledby="bulk-gpx-progress-title"
          sx={{ width: "min(420px, calc(100vw - 32px))" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <CircularProgress size="md" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography id="bulk-gpx-progress-title" level="title-md">
                Applying GPX to recordings
              </Typography>
              <Typography
                level="body-sm"
                noWrap
                title={bulkGpxProgress?.fileName}>
                {bulkGpxProgress?.fileName}
              </Typography>
            </Box>
          </Box>
          <LinearProgress
            determinate={
              bulkGpxProgress?.phase === "uploading" &&
              bulkGpxProgress.percent !== undefined
            }
            value={bulkGpxProgress?.percent || 0}
            sx={{ mt: 1 }}
          />
          <Typography level="body-sm">
            {bulkGpxProgress?.phase === "reading" && "Reading GPX file…"}
            {bulkGpxProgress?.phase === "uploading" &&
              `Uploading… ${bulkGpxProgress.percent ?? 0}%`}
            {bulkGpxProgress?.phase === "processing" &&
              "Matching GPS points and updating recordings…"}
          </Typography>
          <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
            Keep this page open until the import finishes.
          </Typography>
        </ModalDialog>
      </Modal>

      {/* Navigation Links */}
      <List size="sm" sx={{ flexGrow: 0 }}>
        <ListItem sx={{ borderRadius: 2 }}>
          <ListItemButton
            component={Link}
            to="/recordings-map"
            onClick={() => onSelectPair?.(null)}>
            <ListItemDecorator>
              <MapIcon />
            </ListItemDecorator>
            <ListItemContent>Recording Map</ListItemContent>
          </ListItemButton>
        </ListItem>
        <ListItem sx={{ borderRadius: 2 }}>
          <ListItemButton
            component={Link}
            to="/clips"
            onClick={() => onSelectPair?.(null)}>
            <ListItemDecorator>
              <ContentCutIcon />
            </ListItemDecorator>
            <ListItemContent>Video Clips</ListItemContent>
          </ListItemButton>
        </ListItem>
      </List>

      {/* Search */}
      <Input
        size="sm"
        startDecorator={<SearchRoundedIcon />}
        placeholder="Search (date or location)"
        disabled={!pairs?.length}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => {
          setSearch("");
        }}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Checkbox
          size="sm"
          checked={importantOnly}
          disabled={importantPairCount === 0}
          onChange={(event) => setImportantOnly(event.target.checked)}
          label="Important recordings only"
          sx={{ flex: 1 }}
        />
        <Chip size="sm" color="danger" variant="soft">
          {importantPairCount}
        </Chip>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Checkbox
          size="sm"
          checked={withoutPoisOnly}
          disabled={withoutPoisPairCount === 0 && !withoutPoisOnly}
          onChange={(event) => setWithoutPoisOnly(event.target.checked)}
          label="Recordings without POIs only"
          sx={{ flex: 1 }}
        />
        <Chip size="sm" color="neutral" variant="soft">
          {withoutPoisPairCount}
        </Chip>
      </Box>

      {/* Year / Month Bookmarks */}
      {sortedYears.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 0.5,
              justifyContent: "space-around",
            }}>
            {sortedYears.map((y) => (
              <Chip
                key={y + "-year-chip"}
                variant={activeYearForMonths === y ? "solid" : "soft"}
                color="primary"
                onClick={() => {
                  scrollToId(`year-${y}`);
                  setActiveYearForMonths((prev) => (prev === y ? null : y));
                }}>
                {y}
              </Chip>
            ))}
          </Box>

          {/* Months for the active year */}
          {activeYearForMonths && grouped[activeYearForMonths] && (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.5,
                justifyContent: "space-around",
              }}>
              {Object.keys(grouped[activeYearForMonths])
                .sort((a, b) => (a < b ? 1 : -1))
                .map((m) => (
                  <Chip
                    key={m + "-month-chip"}
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    onClick={() =>
                      scrollToId(`year-${activeYearForMonths}-month-${m}`)
                    }>
                    {activeYearForMonths}-{m}
                  </Chip>
                ))}
            </Box>
          )}
        </Box>
      )}

      {/* List */}
      <Box
        sx={{
          minHeight: 0,
          overflow: "hidden",
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          [`& .${listItemButtonClasses.root}`]: {
            gap: 1.5,
          },
        }}>
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "16px",
            background:
              "linear-gradient(to bottom, var(--joy-palette-background-surface) 0%, transparent 100%)",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "16px",
            background:
              "linear-gradient(to top, var(--joy-palette-background-surface) 0%, transparent 100%)",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
        <List
          size="sm"
          sx={{
            gap: 1,
            "--ListItem-radius": (theme) => theme.vars.radius.sm,
            maxHeight: "100%",
            flexGrow: 1,
            overflow: "hidden auto",
          }}>
          {loading && (
            <ListItem
              sx={{
                m: "auto",
                fontSize: "lg",
              }}>
              <ListItemButton disabled>
                <ListItemDecorator>
                  <CircularProgress size="sm" />
                </ListItemDecorator>
                <ListItemContent>Loading...</ListItemContent>
              </ListItemButton>
            </ListItem>
          )}
          {!loading && !!error && (
            <ListItem
              sx={{
                m: "auto",
                fontSize: "lg",
              }}>
              <ListItemButton disabled>
                <ListItemDecorator>
                  <WarningIcon color="danger" size="lg" />
                </ListItemDecorator>
                <ListItemContent sx={{ color: "danger.softColor" }}>
                  Error loading video pairs!
                </ListItemContent>
              </ListItemButton>
            </ListItem>
          )}

          {!loading && !error && pairs?.length === 0 && (
            <ListItem>
              <ListItemButton disabled>
                <ListItemDecorator>
                  <WarningIcon color="warning" />
                </ListItemDecorator>
                <ListItemContent sx={{ color: "warning.softColor" }}>
                  No videos found
                </ListItemContent>
              </ListItemButton>
            </ListItem>
          )}

          {!loading &&
            !error &&
            pairs.length > 0 &&
            filteredPairs.length === 0 && (
              <ListItem>
                <ListItemButton disabled>
                  <ListItemDecorator>
                    <WarningIcon color="warning" />
                  </ListItemDecorator>
                  <ListItemContent>No matching recordings</ListItemContent>
                </ListItemButton>
              </ListItem>
            )}

          {/* Video list */}
          {!loading &&
            sortedYears.map((year) => {
              const months = Object.keys(grouped[year]).sort((a, b) =>
                a < b ? 1 : -1,
              );
              return (
                <Fragment key={year}>
                  <ListItem
                    id={`year-${year}`}
                    key={year + "-hdr"}
                    sx={{ mt: 1, mb: 0 }}>
                    <Typography level="title-sm" sx={{ fontWeight: 700 }}>
                      {year}
                    </Typography>
                  </ListItem>
                  {months.map((month) => {
                    const days = Object.keys(grouped[year][month]).sort(
                      (a, b) => (a < b ? 1 : -1),
                    );
                    return (
                      <Fragment key={`${year}-${month}`}>
                        <ListItem
                          id={`year-${year}-month-${month}`}
                          key={`${year}-${month}-hdr`}
                          sx={{ mt: 0.5, mb: 0 }}>
                          <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                            {year}-{month}
                          </Typography>
                        </ListItem>
                        {days.map((day) => (
                          <Fragment key={`${year}-${month}-${day}`}>
                            <ListItem
                              key={`${year}-${month}-${day}-hdr`}
                              sx={{ py: 0.25 }}>
                              <Typography
                                level="body-xs"
                                sx={{ fontWeight: 500, opacity: 0.8 }}>
                                {year}-{month}-{day}
                              </Typography>
                            </ListItem>
                            {grouped[year][month][day]
                              .sort((a, b) => (a.id < b.id ? 1 : -1))
                              .map((p) => {
                                const consecutiveInfo = consecutiveGroups.get(
                                  p.id,
                                );
                                return (
                                  <ListItem
                                    key={p.id + "-pair"}
                                    ref={
                                      p.id === selectedPairId
                                        ? selectedItemRef
                                        : null
                                    }
                                    sx={{
                                      position: "relative",
                                      ...(consecutiveInfo && {
                                        marginBottom:
                                          consecutiveInfo.position === "end" ||
                                          consecutiveInfo.position === "middle"
                                            ? "-4px"
                                            : 0,
                                        marginTop:
                                          consecutiveInfo.position ===
                                            "start" ||
                                          consecutiveInfo.position === "middle"
                                            ? "-4px"
                                            : 0,
                                      }),
                                    }}>
                                    <ListItemButton
                                      selected={p.id === selectedPairId}
                                      onClick={() => {
                                        closeSidebar();
                                        if (onSelectPair) {
                                          onSelectPair(p);
                                        } else {
                                          navigate("/");
                                        }
                                      }}
                                      sx={
                                        consecutiveInfo
                                          ? {
                                              borderTop:
                                                consecutiveInfo.position ===
                                                "end"
                                                  ? "1px solid"
                                                  : "none",
                                              borderBottom:
                                                consecutiveInfo.position ===
                                                "start"
                                                  ? "1px solid"
                                                  : "none",
                                              borderLeft: "1px solid",
                                              borderRight: "1px solid",
                                              borderColor: "danger.500",

                                              borderBottomLeftRadius:
                                                consecutiveInfo.position ===
                                                  "end" ||
                                                consecutiveInfo.position ===
                                                  "middle"
                                                  ? 0
                                                  : undefined,
                                              borderBottomRightRadius:
                                                consecutiveInfo.position ===
                                                  "end" ||
                                                consecutiveInfo.position ===
                                                  "middle"
                                                  ? 0
                                                  : undefined,

                                              borderTopLeftRadius:
                                                consecutiveInfo.position ===
                                                  "start" ||
                                                consecutiveInfo.position ===
                                                  "middle"
                                                  ? 0
                                                  : undefined,
                                              borderTopRightRadius:
                                                consecutiveInfo.position ===
                                                  "start" ||
                                                consecutiveInfo.position ===
                                                  "middle"
                                                  ? 0
                                                  : undefined,
                                            }
                                          : undefined
                                      }>
                                      {p.channels.front?.important ||
                                      p.channels.rear?.important ? (
                                        <EmergencyRecordingIcon color="danger" />
                                      ) : (
                                        <VideocamIcon />
                                      )}
                                      <ListItemContent>
                                        <Box
                                          sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.5,
                                          }}>
                                          <Typography level="title-sm">
                                            {formatPairTime(p)}
                                          </Typography>
                                          <PairAudioStatusIcon pair={p} />
                                          {!!p.manualPoiCount && (
                                            <Chip
                                              size="sm"
                                              color="warning"
                                              variant="soft"
                                              startDecorator={
                                                <LocationOnIcon
                                                  sx={{ fontSize: "0.9rem" }}
                                                />
                                              }
                                              aria-label={`${p.manualPoiCount} manually marked point${p.manualPoiCount === 1 ? "" : "s"} of interest`}
                                              title={`${p.manualPoiCount} manually marked point${p.manualPoiCount === 1 ? "" : "s"} of interest`}
                                              sx={{ minHeight: 20 }}>
                                              {p.manualPoiCount}
                                            </Chip>
                                          )}
                                          {!!p.cameraSavePoiCount && (
                                            <Chip
                                              size="sm"
                                              color="danger"
                                              variant="soft"
                                              startDecorator={
                                                <NotificationsActiveIcon
                                                  sx={{ fontSize: "0.9rem" }}
                                                />
                                              }
                                              aria-label={`${p.cameraSavePoiCount} detected camera saving beep event${p.cameraSavePoiCount === 1 ? "" : "s"}`}
                                              title={`${p.cameraSavePoiCount} detected camera saving beep event${p.cameraSavePoiCount === 1 ? "" : "s"}`}
                                              sx={{ minHeight: 20 }}>
                                              {p.cameraSavePoiCount}
                                            </Chip>
                                          )}
                                          {(!p.channels.front ||
                                            p.channels.front?.noGps) &&
                                            (!p.channels.rear ||
                                              p.channels.rear?.noGps) && (
                                              <>
                                                <GpsOffIcon color="warning" />
                                                <IconButton
                                                  size="sm"
                                                  variant="plain"
                                                  color="neutral"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSetLocation(p);
                                                  }}
                                                  sx={{
                                                    minHeight: 0,
                                                    minWidth: 0,
                                                    p: 0.25,
                                                  }}>
                                                  <EditLocationIcon
                                                    sx={{ fontSize: "1rem" }}
                                                  />
                                                </IconButton>
                                              </>
                                            )}
                                        </Box>
                                        <Typography level="body-sm" noWrap>
                                          {moment
                                            .duration(p.durationSec, "seconds")
                                            .humanize()}{" "}
                                          (
                                          {Object.keys(p.channels)
                                            .toSorted((a, b) =>
                                              a.localeCompare(b),
                                            )
                                            .join(", ")}
                                          )
                                        </Typography>
                                        {p.cameraType || p.licensePlate ? (
                                          <Typography
                                            level="body-xs"
                                            color="neutral"
                                            noWrap
                                            title={[
                                              p.cameraType,
                                              p.licensePlate,
                                            ]
                                              .filter(Boolean)
                                              .join(" · ")}>
                                            {[p.cameraType, p.licensePlate]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </Typography>
                                        ) : (
                                          <PairOcrStatus pair={p} />
                                        )}
                                        <PairLocation pair={p} />
                                      </ListItemContent>
                                    </ListItemButton>
                                  </ListItem>
                                );
                              })}
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
        </List>
      </Box>

      <BackgroundTasksModal
        open={backgroundTasksModalOpen}
        onClose={() => setBackgroundTasksModalOpen(false)}
        onRefreshRecordings={() => void refresh()}
      />

      <SetLocationModal
        open={locationModalOpen}
        onClose={() => setLocationModalOpen(false)}
        pair={selectedPairForLocation}
        onUpdate={handleLocationUpdate}
      />
    </Sheet>
  );
};

export default Sidebar;

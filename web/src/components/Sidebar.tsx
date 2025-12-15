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
import MoreVertIcon from "@mui/icons-material/MoreVert";
import moment from "moment";
import PairLocation from "./PairLocation";
import GpsOffIcon from "@mui/icons-material/GpsOff";
import Chip from "@mui/joy/Chip";
import GpsQueueModal from "./GpsQueueModal";
import SetLocationModal from "./SetLocationModal";
import EditLocationIcon from "@mui/icons-material/EditLocation";
import {
  VideoPair,
  triggerReindex,
  getCurrentUser,
  loginUrl,
  logout,
  backfillLocations,
  type User,
  fetchPair,
} from "../api";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import Button from "@mui/joy/Button";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import { Link, useNavigate } from "react-router-dom";
import UserIcon from "@mui/icons-material/Person";

/**
 * Parse a pair ID to get timestamp in seconds since epoch
 * @param id Video pair ID in yyyymmdd_hhmmss format
 * @returns Timestamp in seconds, or null if parsing fails
 */
function parseTimestamp(id: string): number | null {
  const [datePart, timePart] = id.split("_");
  if (!datePart || !timePart || datePart.length !== 8 || timePart.length < 6)
    return null;
  const yyyy = Number.parseInt(datePart.slice(0, 4), 10);
  const mm = Number.parseInt(datePart.slice(4, 6), 10);
  const dd = Number.parseInt(datePart.slice(6, 8), 10);
  const hh = Number.parseInt(timePart.slice(0, 2), 10);
  const mi = Number.parseInt(timePart.slice(2, 4), 10);
  const ss = Number.parseInt(timePart.slice(4, 6), 10);
  return Math.floor(new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime() / 1000);
}

/**
 * Check if a pair is important (has at least one important channel)
 * @param pair Video pair to check
 * @returns True if any channel is marked important
 */
function isImportant(pair: VideoPair): boolean {
  return Object.values(pair.channels).some((ch) => ch?.important);
}

/**
 * Format a video pair ID from yyyymmdd_hhmmss to a more readable format.
 * @param id Video pair ID in yyyymmdd_hhmmss format
 * @returns Formatted video pair ID (YYYY-MM-DD HH:MM:SS)
 */
function formatPairId(id: string): string {
  // Expect yyyymmdd_hhmmss
  const [datePart, timePart] = id.split("_");
  if (!datePart || !timePart || datePart.length !== 8 || timePart.length < 6)
    return id;
  const yyyy = datePart.slice(0, 4);
  const mm = datePart.slice(4, 6);
  const dd = datePart.slice(6, 8);
  const hh = timePart.slice(0, 2);
  const mi = timePart.slice(2, 4);
  const ss = timePart.slice(4, 6);
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
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
  const [isReindexing, setIsReindexing] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [gpsQueueModalOpen, setGpsQueueModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [selectedPairForLocation, setSelectedPairForLocation] =
    useState<VideoPair | null>(null);
  const navigate = useNavigate();
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  // Scroll to selected item when sidebar loads or selection changes
  useEffect(() => {
    if (selectedPairId && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [selectedPairId, pairs]);

  // Listen for GPS data updates to refresh affected pairs
  useEffect(() => {
    const handleGpsUpdated = async (e: Event) => {
      const customEvent = e as CustomEvent<{ pairId: string }>;
      console.log(
        "GPS data empty detected for pair:",
        customEvent.detail.pairId,
        "- updating pair data",
      );
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

    if (!idSearch && !placeSearch) return pairs;

    return pairs.filter(
      (p) =>
        (idSearch && p.id.toLowerCase().includes(idSearch)) ||
        (placeSearch &&
          p.startLocationName?.toLowerCase().includes(placeSearch)) ||
        (placeSearch && p.endLocationName?.toLowerCase().includes(placeSearch)),
    );
  }, [pairs, search]);

  // Group filtered pairs by Year -> Month -> Day
  const grouped = useMemo(() => {
    type Grouped = Record<string, Record<string, Record<string, typeof pairs>>>;
    const g: Grouped = {};
    for (const p of filteredPairs) {
      const datePart = p.id.split("_")[0] || ""; // yyyymmdd
      if (datePart.length !== 8) {
        g.Unknown ||= {};
        g.Unknown.Unknown ||= {};
        g.Unknown.Unknown.Unknown ||= [];
        g.Unknown.Unknown.Unknown.push(p);
        continue;
      }
      const year = datePart.slice(0, 4);
      const month = datePart.slice(4, 6);
      const day = datePart.slice(6, 8);
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

      const currentTimestamp = parseTimestamp(current.id);
      if (currentTimestamp === null) continue;

      // Check if next pair is consecutive and important
      const next = sorted[i + 1];
      const isNextConsecutive =
        next &&
        isImportant(next) &&
        (() => {
          const nextTimestamp = parseTimestamp(next.id);
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
          const prevTimestamp = parseTimestamp(prev.id);
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
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    variant: "outlined",
                    color: "neutral",
                  },
                }}>
                <MoreVertIcon />
              </MenuButton>
              <Menu placement="top-start" size="sm" sx={{ zIndex: 10001 }}>
                <MenuItem onClick={handleReindex} disabled={isReindexing}>
                  <FolderOpenIcon sx={{ mr: 1 }} />
                  {isReindexing ? "Re-indexing..." : "Scan for new files"}
                </MenuItem>
                <MenuItem
                  onClick={handleGeocodeBackfill}
                  disabled={isGeocoding}>
                  <SearchRoundedIcon sx={{ mr: 1 }} />
                  {isGeocoding ? "Geocoding..." : "Backfill locations"}
                </MenuItem>
                <MenuItem onClick={() => setGpsQueueModalOpen(true)}>
                  <GpsOffIcon sx={{ mr: 1 }} />
                  GPS Extraction Queue
                </MenuItem>
                <MenuItem onClick={refresh} disabled={loading}>
                  <RefreshIcon sx={{ mr: 1 }} />
                  {loading ? "Refreshing..." : "Refresh list"}
                </MenuItem>
              </Menu>
            </Dropdown>
            <IconButton
              size="sm"
              variant="plain"
              onClick={handleLogout}
              title="Logout">
              <LogoutIcon />
            </IconButton>
          </Box>
        ) : (
          <Button
            size="sm"
            variant="outlined"
            fullWidth
            startDecorator={<LoginIcon />}
            component="a"
            href={loginUrl()}>
            Login
          </Button>
        )}
      </Box>

      {/* Navigation Links */}
      <List size="sm" sx={{ flexGrow: 0 }}>
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
                                    ref={p.id === selectedPairId ? selectedItemRef : null}
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
                                            {formatPairId(p.id)}
                                          </Typography>
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

      <GpsQueueModal
        open={gpsQueueModalOpen}
        onClose={() => setGpsQueueModalOpen(false)}
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

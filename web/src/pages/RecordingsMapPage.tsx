import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer } from "react-leaflet";
import Box from "@mui/joy/Box";
import Sheet from "@mui/joy/Sheet";
import Typography from "@mui/joy/Typography";
import CircularProgress from "@mui/joy/CircularProgress";
import Alert from "@mui/joy/Alert";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Checkbox from "@mui/joy/Checkbox";
import IconButton from "@mui/joy/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  fetchGpsMap,
  fetchPair,
  type GpsMapCatalog,
  type GpsMapTrack,
  type VideoPair,
} from "../api";
import {
  buildGpsOverlapLocations,
  spaceGpsOverlapLocations,
} from "../utils/gps-overlap";
import { formatPairTime } from "../utils/recording-time";
import { interpolateGpsPosition } from "../utils/gps-interpolation";
import { findClosestGpsTime } from "../utils/gps-click-seek";

function formatMapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

interface OutletContext {
  selectPair: (pair: VideoPair | null, initialTimeSec?: number) => void;
}

function routeColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 78% 46%)`;
}

function overlapColor(count: number): string {
  if (count >= 5) return "#d32f2f";
  if (count >= 3) return "#f57c00";
  return "#fbc02d";
}

function routeTooltip(track: GpsMapTrack): HTMLElement {
  const content = document.createElement("div");
  const time = document.createElement("strong");
  time.textContent = formatPairTime(track);
  content.append(time);
  const locationLabel = [track.startLocationName, track.endLocationName]
    .filter(Boolean)
    .join(" → ");
  if (locationLabel) {
    content.append(document.createElement("br"), locationLabel);
  }
  content.append(document.createElement("br"), "Click to open at this point");
  return content;
}

export default function RecordingsMapPage() {
  const { selectPair } = useOutletContext<OutletContext>();
  const mapRef = useRef<L.Map>(null);
  const [catalog, setCatalog] = useState<GpsMapCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverlaps, setShowOverlaps] = useState(true);
  const [overlapZoom, setOverlapZoom] = useState(8);
  const [selectedOverlapIds, setSelectedOverlapIds] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchGpsMap(controller.signal)
      .then(setCatalog)
      .catch((reason: any) => {
        if (reason?.name !== "CanceledError" && reason?.name !== "AbortError") {
          setError(
            reason?.response?.data?.error ||
              reason?.message ||
              "Failed to load recording GPS data",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const overlapLocations = useMemo(
    () => buildGpsOverlapLocations(catalog?.tracks || []),
    [catalog],
  );
  const tracksById = useMemo(
    () => new Map((catalog?.tracks || []).map((track) => [track.id, track])),
    [catalog],
  );

  const openRecording = useCallback(
    async (track: GpsMapTrack, initialTimeSec?: number) => {
      const pair = await fetchPair(track.id);
      if (!pair) return;
      selectPair(pair, initialTimeSec);
    },
    [selectPair],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateZoom = () => setOverlapZoom(map.getZoom());
    updateZoom();
    map.on("zoomend", updateZoom);
    return () => {
      map.off("zoomend", updateZoom);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !catalog) return;
    const layers = L.featureGroup().addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    const bounds = L.latLngBounds([]);

    for (const track of catalog.tracks) {
      if (!track.points.length) continue;
      const coordinates = track.points.map(
        (point) => [point.lat, point.lon] as [number, number],
      );
      bounds.extend(coordinates);
      L.polyline(coordinates, {
        color: routeColor(track.id),
        weight: 4,
        opacity: 0.72,
        renderer,
        bubblingMouseEvents: false,
      })
        .bindTooltip(routeTooltip(track), { sticky: true })
        .on("click", (event) => {
          const timeSec = findClosestGpsTime(
            track.points,
            { lat: event.latlng.lat, lon: event.latlng.lng },
            (lat, lon) => map.latLngToLayerPoint([lat, lon]),
          );
          void openRecording(track, timeSec);
        })
        .addTo(layers);

      for (const poi of track.pois || []) {
        if (
          poi.timeSec < track.points[0].tsSec ||
          poi.timeSec > track.points.at(-1)!.tsSec
        ) {
          continue;
        }
        const position = interpolateGpsPosition(track.points, poi.timeSec);
        if (!position) continue;
        const automatic = poi.kind === "camera-save";
        const marker = L.circleMarker([position.lat, position.lon], {
          radius: automatic ? 7 : 6,
          color: automatic ? "#7f1d1d" : "#7c2d12",
          weight: 2,
          fillColor: automatic ? "#dc2626" : "#f97316",
          fillOpacity: 1,
          bubblingMouseEvents: false,
        });
        const tooltip = document.createElement("span");
        tooltip.textContent = `${poi.label} · ${formatMapTime(poi.timeSec)} · ${formatPairTime(track)}`;
        marker
          .bindTooltip(tooltip, { direction: "top" })
          .on("click", () => void openRecording(track, poi.timeSec))
          .addTo(layers);
      }
    }

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
    return () => {
      map.removeLayer(layers);
      renderer.remove();
    };
  }, [catalog, openRecording]);

  // Keep overlap markers in an independent layer so toggling them does not
  // rebuild routes, reset map bounds, or interrupt the current viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showOverlaps) return;
    const layers = L.featureGroup().addTo(map);
    const renderer = L.svg({ padding: 0.5 });
    const minimumSpacing = Math.min(90, 42 + Math.max(0, 13 - overlapZoom) * 6);
    const spacedLocations = spaceGpsOverlapLocations(
      overlapLocations,
      (lat, lon) => map.project([lat, lon], overlapZoom),
      minimumSpacing,
    );

    for (const overlap of spacedLocations) {
      const count = overlap.recordingIds.length;
      const color = overlapColor(count);
      L.circleMarker([overlap.lat, overlap.lon], {
        radius: Math.min(13, 5 + count * 1.5),
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
        renderer,
      })
        .bindTooltip(`${count} recordings overlap here`, { sticky: true })
        .on("click", () => setSelectedOverlapIds(overlap.recordingIds))
        .addTo(layers);
    }

    return () => {
      map.removeLayer(layers);
      renderer.remove();
    };
  }, [overlapLocations, overlapZoom, showOverlaps]);

  return (
    <Box
      component="main"
      sx={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        height: "100dvh",
        pt: { xs: "var(--Header-height)", md: 0 },
      }}>
      <MapContainer
        ref={mapRef}
        scrollWheelZoom
        center={[47.49, 19.07]}
        zoom={8}
        style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
          className="defaultmap"
        />
      </MapContainer>

      <Sheet
        variant="outlined"
        sx={{
          position: "absolute",
          zIndex: 1000,
          top: { xs: "calc(var(--Header-height) + 12px)", md: 12 },
          left: 12,
          p: 1.5,
          borderRadius: "md",
          boxShadow: "md",
          maxWidth: "calc(100% - 24px)",
        }}>
        <Typography level="title-md">All recording routes</Typography>
        {catalog && (
          <Box sx={{ display: "flex", gap: 0.75, my: 1, flexWrap: "wrap" }}>
            <Chip size="sm" color="primary">
              {catalog.recordingsWithGps} with GPS
            </Chip>
            <Chip size="sm" variant="soft">
              {catalog.totalRecordings} total
            </Chip>
            <Chip size="sm" color="warning" variant="soft">
              {overlapLocations.length} overlap areas
            </Chip>
          </Box>
        )}
        <Checkbox
          size="sm"
          checked={showOverlaps}
          onChange={(event) => {
            setShowOverlaps(event.target.checked);
            if (!event.target.checked) setSelectedOverlapIds([]);
          }}
          label="Show overlapping locations"
        />
        <Typography level="body-xs" sx={{ mt: 0.75, maxWidth: 320 }}>
          Colored lines are recordings. Small orange circles mark manual POIs
          and small red circles mark detected recording saves. Larger yellow,
          orange, and red circles mark areas shared by multiple recordings.
        </Typography>
      </Sheet>

      {loading && (
        <Sheet
          sx={{
            position: "absolute",
            zIndex: 1001,
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 1.5,
            width: "fit-content",
            height: "fit-content",
            m: "auto",
            p: 3,
            borderRadius: "md",
            boxShadow: "lg",
          }}>
          <CircularProgress size="lg" />
          <Typography>Loading GPS tracks…</Typography>
          <Typography level="body-xs">
            The first load may extract GPS from recordings that were not opened
            yet.
          </Typography>
        </Sheet>
      )}

      {error && (
        <Alert
          color="danger"
          sx={{ position: "absolute", zIndex: 1002, top: 12, right: 12 }}>
          {error}
        </Alert>
      )}

      {!loading && catalog?.tracks.length === 0 && (
        <Alert
          color="neutral"
          sx={{
            position: "absolute",
            zIndex: 1000,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}>
          No recordings with GPS data were found.
        </Alert>
      )}

      {!!selectedOverlapIds.length && (
        <Sheet
          variant="outlined"
          sx={{
            position: "absolute",
            zIndex: 1000,
            right: 12,
            bottom: 28,
            width: { xs: "calc(100% - 24px)", sm: 360 },
            maxHeight: "45vh",
            overflow: "auto",
            p: 1.5,
            borderRadius: "md",
            boxShadow: "lg",
          }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <Typography level="title-sm" sx={{ flex: 1 }}>
              {selectedOverlapIds.length} overlapping recordings
            </Typography>
            <IconButton
              size="sm"
              variant="plain"
              aria-label="Close overlap details"
              onClick={() => setSelectedOverlapIds([])}>
              <CloseIcon />
            </IconButton>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {selectedOverlapIds.map((id) => {
              const track = tracksById.get(id);
              if (!track) return null;
              return (
                <Button
                  key={id}
                  size="sm"
                  variant="soft"
                  color="neutral"
                  endDecorator={<PlayArrowIcon />}
                  onClick={() => openRecording(track)}
                  sx={{ justifyContent: "space-between" }}>
                  {formatPairTime(track)}
                </Button>
              );
            })}
          </Box>
        </Sheet>
      )}
    </Box>
  );
}

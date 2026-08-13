import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  deleteRecordedGps,
  useEmbeddedGps,
  type VideoPair,
  type VideoPoi,
} from "../api";
import { MapContainer, TileLayer } from "react-leaflet";
import { useGpsData } from "../hooks/useGpsData";
import LinearProgress from "@mui/joy/LinearProgress";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import CircularProgress from "@mui/joy/CircularProgress";
import IconButton from "@mui/joy/IconButton";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Tooltip from "@mui/joy/Tooltip";
import Button from "@mui/joy/Button";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import DialogTitle from "@mui/joy/DialogTitle";
import DialogContent from "@mui/joy/DialogContent";
import DialogActions from "@mui/joy/DialogActions";
import VideoGpxUploader from "./VideoGpxUploader";
import {
  buildSpeedSegments,
  calculateSpeedAtTime,
  SPEED_COLOR_STOPS,
  speedColor,
} from "../utils/speed";
import { interpolateGpsPosition } from "../utils/gps-interpolation";

type Props = {
  pair: VideoPair | null;
  currentTimeSec?: number;
  onSeek?: (timeSec: number) => void;
  pois?: readonly VideoPoi[];
  onPairUpdated?: (pair: VideoPair) => void;
};
export default function MapView({
  pair,
  currentTimeSec,
  onSeek,
  pois = [],
  onPairUpdated,
}: Readonly<Props>) {
  const canUploadGpx = Number.isFinite(pair?.durationSec ?? Number.NaN);
  const markerRef = useRef<L.Layer | null>(null);
  const mapRef = useRef<L.Map>(null);
  const linePointsRef = useRef<
    Array<{ tsSec: number; lat: number; lon: number }>
  >([]);
  const currentPairIdRef = useRef(pair?.id);
  const deletingPairIdRef = useRef<string | null>(null);
  const [currentSpeedKph, setCurrentSpeedKph] = useState<number | null>(null);
  const [gpsRemovalMode, setGpsRemovalMode] = useState<
    "external" | "all" | null
  >(null);
  const [gpsDeleteDialogOpen, setGpsDeleteDialogOpen] = useState(false);
  const deletingGps = gpsRemovalMode !== null;
  const { gps, loading, error, refresh } = useGpsData(pair?.id || null);
  const hasGpsTrack = !!(gps?.front?.length || gps?.rear?.length);
  const hasFallbackLocation = !!(
    pair?.channels.front?.location || pair?.channels.rear?.location
  );
  const hasGpsData = hasGpsTrack || (!pair?.gpsDisabled && hasFallbackLocation);

  useEffect(() => {
    currentPairIdRef.current = pair?.id;
    setGpsRemovalMode(null);
    setGpsDeleteDialogOpen(false);
  }, [pair?.id]);

  const handleGpsRemoval = async (mode: "external" | "all") => {
    if (!pair || deletingGps) return;

    setGpsRemovalMode(mode);
    const deletingPairId = pair.id;
    deletingPairIdRef.current = deletingPairId;
    try {
      const result =
        mode === "external"
          ? await useEmbeddedGps(deletingPairId)
          : await deleteRecordedGps(deletingPairId);
      if (currentPairIdRef.current === deletingPairId) {
        onPairUpdated?.(result.pair);
        refresh();
        setGpsDeleteDialogOpen(false);
        if (mode === "external" && !result.hasGps) {
          globalThis.alert(
            "The external GPX was removed, but no embedded GPS data was found in this recording.",
          );
        }
      }
    } catch (deleteError: any) {
      if (currentPairIdRef.current === deletingPairId) {
        globalThis.alert(
          deleteError?.response?.data?.error ||
            deleteError?.message ||
            "Failed to update GPS data",
        );
      }
    } finally {
      if (deletingPairIdRef.current === deletingPairId) {
        deletingPairIdRef.current = null;
        setGpsRemovalMode(null);
      }
    }
  };

  useEffect(() => {
    if (loading || error || !pair) return;
    const map = mapRef.current!;
    let markers: L.Layer[] = [];

    if (gps && (gps.front?.length || gps.rear?.length)) {
      const points = (gps.front || gps.rear)!;
      linePointsRef.current = points.map((p) => ({
        tsSec: p.tsSec,
        lat: p.lat,
        lon: p.lon,
      }));
      const coords = points.map((p) => [p.lat, p.lon] as [number, number]);
      const routeLayer = L.featureGroup().addTo(map);
      for (const segment of buildSpeedSegments(linePointsRef.current)) {
        const segmentLayer = L.polyline(
          [
            [segment.from.lat, segment.from.lon],
            [segment.to.lat, segment.to.lon],
          ],
          {
            color: speedColor(segment.speedKph),
            weight: 7,
            opacity: 0.9,
            interactive: !!onSeek,
            bubblingMouseEvents: false,
          },
        )
          .bindTooltip(
            `${segment.speedKph.toFixed(0)} km/h${onSeek ? " · Click to seek" : ""}`,
            {
              sticky: true,
            },
          )
          .addTo(routeLayer);
        if (onSeek) {
          segmentLayer.on("click", (event) => {
            const start = map.latLngToLayerPoint([
              segment.from.lat,
              segment.from.lon,
            ]);
            const end = map.latLngToLayerPoint([
              segment.to.lat,
              segment.to.lon,
            ]);
            const clicked = map.latLngToLayerPoint(event.latlng);
            const deltaX = end.x - start.x;
            const deltaY = end.y - start.y;
            const lengthSquared = deltaX ** 2 + deltaY ** 2;
            const fraction =
              lengthSquared === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      1,
                      ((clicked.x - start.x) * deltaX +
                        (clicked.y - start.y) * deltaY) /
                        lengthSquared,
                    ),
                  );
            onSeek(
              segment.from.tsSec +
                (segment.to.tsSec - segment.from.tsSec) * fraction,
            );
          });
          const pathElement = segmentLayer.getElement();
          if (pathElement instanceof SVGElement) {
            const midpointTime =
              segment.from.tsSec + (segment.to.tsSec - segment.from.tsSec) / 2;
            pathElement.style.cursor = "pointer";
            pathElement.setAttribute("role", "button");
            pathElement.setAttribute("tabindex", "0");
            pathElement.setAttribute(
              "aria-label",
              `Seek video to ${midpointTime.toFixed(1)} seconds`,
            );
            pathElement.addEventListener("keydown", (keyboardEvent) => {
              const key = keyboardEvent.key;
              if (key === "Enter" || key === " ") {
                keyboardEvent.preventDefault();
                onSeek(midpointTime);
              }
            });
          }
        }
      }
      markers.push(routeLayer);
      markerRef.current = L.circleMarker(coords[0], {
        radius: 6,
        color: "#1976d2",
        fillColor: "#2196f3",
        fillOpacity: 0.9,
      }).addTo(map);
      markers.push(markerRef.current);
      const bounds = L.latLngBounds(coords);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    } else if (pair && !pair.gpsDisabled) {
      // Fallback single geotag if available
      const loc = pair.channels.front?.location || pair.channels.rear?.location;
      if (loc) {
        markerRef.current = L.marker([loc.lat, loc.lon]).addTo(map);
        markers.push(markerRef.current);
        map.setView([loc.lat, loc.lon], 14);
      }
    }

    return () => {
      for (const m of markers) {
        map.removeLayer(m);
      }
      linePointsRef.current = [];
      markerRef.current = null;
    };
  }, [gps, pair, loading, error, onSeek]);

  useEffect(() => {
    const map = mapRef.current;
    const points = linePointsRef.current;
    if (!map || loading || points.length === 0 || pois.length === 0) return;

    const poiLayer = L.featureGroup().addTo(map);
    const firstTime = points[0].tsSec;
    const lastTime = points.at(-1)!.tsSec;
    for (const poi of pois) {
      if (poi.timeSec < firstTime || poi.timeSec > lastTime) continue;
      const position = interpolateGpsPosition(points, poi.timeSec);
      if (!position) continue;

      const automatic = poi.kind === "camera-save";
      const marker = L.circleMarker([position.lat, position.lon], {
        radius: 8,
        color: automatic ? "#7f1d1d" : "#7c2d12",
        weight: 2,
        fillColor: automatic ? "#dc2626" : "#f97316",
        fillOpacity: 1,
        interactive: !!onSeek,
        bubblingMouseEvents: false,
      });
      const tooltipContent = document.createElement("span");
      tooltipContent.textContent = `${poi.label} · ${formatMapTime(poi.timeSec)}`;
      marker
        .bindTooltip(tooltipContent, {
          direction: "top",
        })
        .addTo(poiLayer);
      if (onSeek) {
        marker.on("click", () => onSeek(poi.timeSec));
        const markerElement = marker.getElement();
        if (markerElement instanceof SVGElement) {
          markerElement.style.cursor = "pointer";
          markerElement.setAttribute("role", "button");
          markerElement.setAttribute("tabindex", "0");
          markerElement.setAttribute(
            "aria-label",
            `Seek to ${poi.label} at ${formatMapTime(poi.timeSec)}`,
          );
          markerElement.addEventListener("keydown", (event) => {
            const key = event.key;
            if (key === "Enter" || key === " ") {
              event.preventDefault();
              onSeek(poi.timeSec);
            }
          });
        }
      }
    }

    return () => {
      map.removeLayer(poiLayer);
    };
  }, [gps, loading, onSeek, pois]);

  useEffect(() => {
    if (
      !mapRef.current ||
      !markerRef.current ||
      !linePointsRef.current?.length ||
      loading ||
      currentTimeSec == null
    ) {
      setCurrentSpeedKph(null);
      return;
    }

    const pts = linePointsRef.current;
    setCurrentSpeedKph(calculateSpeedAtTime(pts, currentTimeSec));
    const point = interpolateGpsPosition(pts, currentTimeSec);
    if (!point) return;

    const position = L.latLng(point.lat, point.lon);
    const layer = markerRef.current as L.CircleMarker | L.Marker;
    layer.setLatLng(position);
    mapRef.current.panTo(position, { animate: false });
  }, [currentTimeSec, gps, loading]);

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
      {!!loading && (
        <>
          <LinearProgress
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1001,
            }}
          />
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1002,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              bgcolor: "background.surface",
              p: 3,
              borderRadius: "md",
              boxShadow: "lg",
            }}>
            <CircularProgress size="lg" />
            <Typography level="body-md">Loading GPS data...</Typography>
          </Box>
        </>
      )}

      {!loading && !!error && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bgcolor: "error.100",
            color: "error.800",
            p: 1,
            textAlign: "center",
            zIndex: 1000,
          }}>
          Error loading GPS data ({(error as Error).message})
        </Box>
      )}

      {!loading &&
        !error &&
        pair &&
        !gps?.front?.length &&
        !gps?.rear?.length && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              p: 2,
            }}>
            <Box sx={{ pointerEvents: "auto", width: "100%", maxWidth: 520 }}>
              {canUploadGpx ? (
                <VideoGpxUploader
                  videoId={pair.id}
                  startTime={pair.startTime || null}
                  durationSec={pair.durationSec || null}
                  dashcamTimeZone={pair.dashcamTimeZone || "UTC"}
                  recordingStartTimeOverride={pair.recordingStartTimeOverride}
                  onStored={(updatedPair) => {
                    refresh();
                    onPairUpdated?.(updatedPair);
                  }}
                />
              ) : null}
            </Box>
          </Box>
        )}

      {!!pair && hasGpsData && (
        <Box
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
          }}>
          {canUploadGpx && (
            <VideoGpxUploader
              videoId={pair.id}
              startTime={pair.startTime || null}
              durationSec={pair.durationSec || null}
              dashcamTimeZone={pair.dashcamTimeZone || "UTC"}
              recordingStartTimeOverride={pair.recordingStartTimeOverride}
              onStored={(updatedPair) => {
                refresh();
                onPairUpdated?.(updatedPair);
              }}
              overwrite
              compact
            />
          )}
          {hasGpsTrack && (
            <Tooltip title="Download GPS track as GPX" placement="left">
              <IconButton
                variant="solid"
                color="primary"
                size="sm"
                onClick={() => {
                  window.open(`/api/videos/${pair.id}/gps/gpx`, "_blank");
                }}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Delete incorrect GPS data" placement="left">
            <IconButton
              variant="solid"
              color="danger"
              size="sm"
              disabled={deletingGps}
              aria-label="Delete GPS data"
              onClick={() => setGpsDeleteDialogOpen(true)}>
              {deletingGps ? (
                <CircularProgress size="sm" color="danger" />
              ) : (
                <DeleteOutlineIcon />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Modal
        open={gpsDeleteDialogOpen}
        onClose={() => {
          if (!deletingGps) setGpsDeleteDialogOpen(false);
        }}>
        <ModalDialog sx={{ width: "min(500px, calc(100vw - 32px))" }}>
          <DialogTitle>Manage GPS data</DialogTitle>
          <DialogContent>
            {pair?.hasExternalGps && (
              <Box
                sx={{
                  p: 1.5,
                  mb: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "sm",
                }}>
                <Typography level="title-sm">Use embedded GPS data</Typography>
                <Typography level="body-sm" sx={{ my: 1 }}>
                  Remove only the uploaded GPX override and extract GPS from the
                  recording again.
                </Typography>
                <Button
                  variant="soft"
                  color="primary"
                  loading={gpsRemovalMode === "external"}
                  disabled={deletingGps}
                  onClick={() => void handleGpsRemoval("external")}>
                  Remove external GPX
                </Button>
              </Box>
            )}
            <Typography level="title-sm">Delete all GPS data</Typography>
            <Typography level="body-sm" sx={{ mt: 1 }}>
              Remove uploaded and cached GPS data and keep embedded GPS hidden
              until a replacement GPX is uploaded.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              variant="plain"
              color="neutral"
              disabled={deletingGps}
              onClick={() => setGpsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              color="danger"
              loading={gpsRemovalMode === "all"}
              disabled={deletingGps}
              onClick={() => void handleGpsRemoval("all")}>
              Delete all GPS
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>

      {currentSpeedKph !== null && (
        <Box
          aria-label={`Current speed ${Math.round(currentSpeedKph)} kilometers per hour`}
          sx={{
            position: "absolute",
            top: 10,
            left: 55,
            zIndex: 1000,
            minWidth: 88,
            px: 1.25,
            py: 0.75,
            borderRadius: "md",
            border: `3px solid ${speedColor(currentSpeedKph)}`,
            bgcolor: "background.surface",
            boxShadow: "md",
            textAlign: "center",
            pointerEvents: "none",
          }}>
          <Typography level="h2" sx={{ lineHeight: 1 }}>
            {Math.round(currentSpeedKph)}
          </Typography>
          <Typography level="body-xs">km/h</Typography>
        </Box>
      )}

      {!!gps && (gps.front?.length || gps.rear?.length || 0) > 1 && (
        <Box
          sx={{
            position: "absolute",
            left: 10,
            bottom: 28,
            zIndex: 1000,
            p: 1,
            borderRadius: "sm",
            bgcolor: "background.surface",
            boxShadow: "sm",
            pointerEvents: "none",
          }}>
          <Typography level="body-xs" sx={{ fontWeight: "lg", mb: 0.5 }}>
            Speed (km/h)
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {SPEED_COLOR_STOPS.map((stop) => (
              <Box
                key={stop.speedKph}
                sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                <Box
                  sx={{
                    width: 14,
                    height: 4,
                    borderRadius: 2,
                    bgcolor: stop.color,
                  }}
                />
                <Typography level="body-xs">{stop.speedKph}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

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
    </Box>
  );
}

function formatMapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VideoPair } from "../api";
import { MapContainer, TileLayer } from "react-leaflet";
import { useGpsData } from "../hooks/useGpsData";
import LinearProgress from "@mui/joy/LinearProgress";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import CircularProgress from "@mui/joy/CircularProgress";
import IconButton from "@mui/joy/IconButton";
import DownloadIcon from "@mui/icons-material/Download";
import Tooltip from "@mui/joy/Tooltip";
import VideoGpxUploader from "./VideoGpxUploader";
import {
  buildSpeedSegments,
  SPEED_COLOR_STOPS,
  speedColor,
} from "../utils/speed";

type Props = {
  pair: VideoPair | null;
  currentTimeSec?: number;
  onSeek?: (timeSec: number) => void;
};
export default function MapView({
  pair,
  currentTimeSec,
  onSeek,
}: Readonly<Props>) {
  const canAutoCrop =
    !!pair?.startTime && Number.isFinite(pair?.durationSec ?? Number.NaN);
  const markerRef = useRef<L.Layer | null>(null);
  const mapRef = useRef<L.Map>(null);
  const linePointsRef = useRef<
    Array<{ tsSec: number; lat: number; lon: number }>
  >([]);
  const { gps, loading, error, refresh } = useGpsData(pair?.id || null);

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
          if (pathElement) {
            const midpointTime =
              segment.from.tsSec +
              (segment.to.tsSec - segment.from.tsSec) / 2;
            pathElement.style.cursor = "pointer";
            pathElement.setAttribute("role", "button");
            pathElement.setAttribute("tabindex", "0");
            pathElement.setAttribute(
              "aria-label",
              `Seek video to ${midpointTime.toFixed(1)} seconds`,
            );
            pathElement.addEventListener("keydown", (keyboardEvent) => {
              if (
                keyboardEvent.key === "Enter" ||
                keyboardEvent.key === " "
              ) {
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
    } else if (pair) {
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

  // Update moving marker when time changes
  useEffect(() => {
    if (
      !mapRef.current ||
      !markerRef.current ||
      !linePointsRef.current?.length ||
      loading ||
      currentTimeSec == null
    )
      return;

    const pts = linePointsRef.current;

    // Find the closest GPS point to the current time (within 1 second tolerance)
    let closestIdx = -1;
    let minDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].tsSec - currentTimeSec);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    // Only update if we found a point within 1 second
    if (closestIdx === -1 || minDiff > 1) return;

    const point = pts[closestIdx];
    const layer = markerRef.current as any;
    if (layer.setLatLng) {
      layer.setLatLng([point.lat, point.lon]);
      mapRef.current?.panTo([point.lat, point.lon], { animate: true });
    }
  }, [currentTimeSec]);

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
            <Typography level="body-md">Extracting GPS data...</Typography>
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
              {canAutoCrop ? (
                <VideoGpxUploader
                  videoId={pair.id}
                  startTime={pair.startTime || null}
                  durationSec={pair.durationSec || null}
                  onStored={refresh}
                />
              ) : null}
            </Box>
          </Box>
        )}

      {/* Download GPX Button */}
      {!!pair && !!gps && !!(gps.front?.length || gps.rear?.length) && (
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
          {canAutoCrop && (
            <VideoGpxUploader
              videoId={pair.id}
              startTime={pair.startTime || null}
              durationSec={pair.durationSec || null}
              onStored={refresh}
              overwrite
              compact
            />
          )}
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

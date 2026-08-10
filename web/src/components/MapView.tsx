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

type Props = {
  pair: VideoPair | null;
  currentTimeSec?: number;
};
export default function MapView({ pair, currentTimeSec }: Readonly<Props>) {
  const canAutoCrop =
    !!pair?.startTime && Number.isFinite(pair?.durationSec ?? Number.NaN);
  const markerRef = useRef<L.Layer | null>(null);
  const mapRef = useRef<L.Map>(null);
  const linePointsRef = useRef<
    Array<{ tsSec: number; lat: number; lon: number }>
  >([]);
  const { gps, loading, error, refresh } = useGpsData(pair?.id || null);

  useEffect(() => {
    if (
      loading ||
      error ||
      !pair ||
      (!gps?.front?.length && !gps?.rear?.length)
    )
      return;
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
      let layer = L.polyline(coords, { color: "red" }).addTo(map);
      markers.push(layer);
      markerRef.current = L.circleMarker(coords[0], {
        radius: 6,
        color: "#1976d2",
        fillColor: "#2196f3",
        fillOpacity: 0.9,
      }).addTo(map);
      markers.push(markerRef.current);
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
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
  }, [gps, pair]);

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
        <Tooltip title="Download GPS track as GPX" placement="left">
          <IconButton
            variant="solid"
            color="primary"
            size="sm"
            sx={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 1000,
            }}
            onClick={() => {
              window.open(`/api/videos/${pair.id}/gps/gpx`, "_blank");
            }}>
            <DownloadIcon />
          </IconButton>
        </Tooltip>
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

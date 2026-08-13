import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true, // Enable cookies for session
});

// Add response interceptor to handle 401 unauthorized responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login page on unauthorized
      globalThis.location.href = "/api/auth/login";
    }
    return Promise.reject(error);
  },
);

export interface VideoFile {
  path: string;
  filename: string;
  size: number;
  createdAt?: string;
  durationSec?: number;
  location?: { lat: number; lon: number; alt?: number };
  channel?: "front" | "rear";
  important?: boolean; // user-marked important
  noGps?: boolean; // true if we know there's no GPS data at all
}

export interface ClipFile {
  filename: string;
  url: string;
  thumbnailUrl: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
  videoId?: string;
  clipStartTime?: number;
  clipEndTime?: number;
  clipChannels?: string;
  clipStartAt?: string | null;
  clipEndAt?: string | null;
}

export interface VideoPair {
  id: string;
  startTime?: string;
  durationSec?: number;
  channels: Partial<Record<"front" | "rear", VideoFile>>;
  startLocationName?: string;
  endLocationName?: string;
  startCountry?: string;
  startState?: string;
  startCity?: string;
  endCountry?: string;
  endState?: string;
  endCity?: string;
  poiCount?: number;
  dashcamTimeZone?: string;
  gpsDisabled?: boolean;
  hasExternalGps?: boolean;
  recordingStartTimeOverride?: string;
  cameraType?: string;
  licensePlate?: string;
  overlayMetadataStatus?: "pending" | "found" | "not-found" | "failed";
}

export interface GPSPoint {
  tsSec: number;
  lat: number;
  lon: number;
  alt?: number;
  speedKph?: number;
}

export interface GPSData {
  front?: GPSPoint[];
  rear?: GPSPoint[];
}

export interface VideoPoi {
  id: string;
  videoId: string;
  timeSec: number;
  label: string;
  createdAt: number;
  kind?: "manual" | "camera-save";
}

export interface GpsMapTrack {
  id: string;
  startTime?: string;
  durationSec?: number;
  startLocationName?: string;
  endLocationName?: string;
  points: Array<Pick<GPSPoint, "tsSec" | "lat" | "lon">>;
  pois: VideoPoi[];
}

export interface GpsMapCatalog {
  totalRecordings: number;
  recordingsWithGps: number;
  tracks: GpsMapTrack[];
}

export async function storeRecordedGpx(
  id: string,
  gpxXml: string,
  timeZone: string,
  recordingStartTime: string | null,
): Promise<{
  success: boolean;
  message: string;
  filePath: string;
  pair: VideoPair;
}> {
  const { data } = await api.post(`/videos/${id}/gps/gpx`, {
    gpxXml,
    timeZone,
    recordingStartTime,
  });
  return data;
}

export async function deleteRecordedGps(id: string): Promise<{
  success: boolean;
  message: string;
  pair: VideoPair;
}> {
  const { data } = await api.delete(`/videos/${id}/gps`);
  return data;
}

export async function useEmbeddedGps(id: string): Promise<{
  success: boolean;
  message: string;
  hasGps: boolean;
  pair: VideoPair;
}> {
  const { data } = await api.delete(`/videos/${id}/gps/gpx`);
  return data;
}

export interface BulkGpxResult {
  success: boolean;
  totalPoints: number;
  totalRecordings: number;
  updated: number;
  skipped: number;
  failed: number;
  updatedIds: string[];
  failures: Array<{ id: string; error: string }>;
}

export async function bulkReplaceRecordedGpx(
  gpxXml: string,
  onUploadProgress?: (percent: number | null) => void,
): Promise<BulkGpxResult> {
  const { data } = await api.post<BulkGpxResult>(
    "/videos/gps/gpx/bulk",
    gpxXml,
    {
      headers: { "Content-Type": "application/gpx+xml" },
      onUploadProgress: (event) => {
        onUploadProgress?.(
          event.total
            ? Math.min(100, Math.round((event.loaded / event.total) * 100))
            : null,
        );
      },
    },
  );
  return data;
}

export async function fetchPairs(): Promise<VideoPair[]> {
  const { data } = await api.get("/videos");
  return data;
}

export async function fetchGpsMap(
  signal?: AbortSignal,
): Promise<GpsMapCatalog> {
  const { data } = await api.get<GpsMapCatalog>("/videos/gps-map", { signal });
  return data;
}

export async function fetchPair(id: string): Promise<VideoPair | null> {
  const { data } = await api.get(`/videos/${id}`);
  return data;
}

export async function fetchVideoPois(
  id: string,
  signal?: AbortSignal,
): Promise<VideoPoi[]> {
  const { data } = await api.get<VideoPoi[]>(`/videos/${id}/pois`, { signal });
  return data;
}

export async function createVideoPoi(
  id: string,
  timeSec: number,
  label: string,
): Promise<VideoPoi> {
  const { data } = await api.post<VideoPoi>(`/videos/${id}/pois`, {
    timeSec,
    label,
  });
  return data;
}

export async function deleteVideoPoi(id: string, poiId: string): Promise<void> {
  await api.delete(`/videos/${id}/pois/${poiId}`);
}

export async function fetchGps(
  id: string,
  signal?: AbortSignal,
): Promise<GPSData | null> {
  const { data } = await api.get(`/videos/${id}/gps`, { signal });
  return data;
}

export async function triggerReindex(): Promise<{
  success: boolean;
  message: string;
  totalPairs: number;
}> {
  const { data } = await api.post("/videos/reindex");
  return data;
}

export async function backfillLocations(limit = 20): Promise<{
  processed: number;
  limit: number;
  remaining?: string;
}> {
  const { data } = await api.post("/videos/backfill/locations", { limit });
  return data;
}

export async function createClip(
  pairId: string,
  startTime: number,
  endTime: number,
  channels: "front" | "rear" | "both-stacked" | "both-side-by-side",
  audioVolume?: number,
): Promise<{ jobId: string; statusUrl: string }> {
  const { data } = await api.post(`/videos/${pairId}/clip`, {
    startTime,
    endTime,
    channels,
    audioVolume,
  });
  return data;
}

export interface ClipGenerationProgress {
  percent: number;
  processedSeconds: number;
  durationSeconds: number;
  fps?: number;
  speed?: number;
  phase: "encoding" | "finalizing" | "completed";
}

export interface ClipJobStatus {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
  progress: ClipGenerationProgress;
  result?: { filename: string; downloadUrl: string };
  error?: string;
}

export function watchClipJob(
  statusUrl: string,
  onStatus: (status: ClipJobStatus) => void,
): () => void {
  const eventSource = new EventSource(statusUrl);
  eventSource.onmessage = (event) => {
    const status = JSON.parse(event.data) as ClipJobStatus;
    onStatus(status);
    if (status.state === "completed" || status.state === "failed") {
      eventSource.close();
    }
  };
  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) return;
  };
  return () => eventSource.close();
}

export function videoSourceUrl(id: string, channel: "front" | "rear") {
  return `/api/videos/${encodeURIComponent(id)}/source/${channel}`;
}

// Authentication API
export interface User {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export interface AuthStatus {
  user: User | null;
  authEnabled: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const { data } = await api.get<AuthStatus>("/auth/me");
  return data;
}

export async function getCurrentUser(): Promise<User | null> {
  const { user } = await getAuthStatus();
  return user;
}

export function loginUrl(): string {
  // Preserve current location (including hash) for return after login
  const returnUrl =
    globalThis.location.pathname +
    globalThis.location.search +
    globalThis.location.hash;
  const encodedReturnUrl = encodeURIComponent(returnUrl);
  return `/api/auth/login?returnUrl=${encodedReturnUrl}`;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

// Share API
export interface ShareToken {
  tokenId: string;
  shareUrl: string;
  expiresAt: number | null;
}

export async function createShareToken(
  videoId: string,
  clipStartTime: number,
  clipEndTime: number,
  clipChannels: "front" | "rear" | "both-stacked" | "both-side-by-side",
  expiresInDays?: number,
): Promise<ShareToken> {
  const { data } = await api.post("/shares", {
    videoId,
    clipStartTime,
    clipEndTime,
    clipChannels,
    expiresInDays,
  });
  return data;
}

export async function createClipShareToken(
  filename: string,
  expiresInDays = 7,
): Promise<ShareToken> {
  const { data } = await api.post("/shares/clip", {
    filename,
    expiresInDays,
  });
  return data;
}

export async function getShareToken(tokenId: string): Promise<{
  videoId: string;
  clipStartTime: number;
  clipEndTime: number;
  clipChannels: string;
  clipStartAt: string | null;
  clipEndAt: string | null;
  createdAt: number;
  expiresAt: number | null;
  downloadUrl: string;
  filename: string;
}> {
  const { data } = await api.get(`/shares/${tokenId}`);
  return data;
}

export async function downloadSharedClip(tokenId: string): Promise<{
  downloadUrl: string;
  filename: string;
}> {
  const { data } = await api.get(`/shares/${tokenId}/download`);
  return data;
}

export interface GpsQueueStatus {
  limit: number;
  processing: string[];
  queued: Array<{ id: string; queuedAt: number }>;
}

export async function getGpsQueueStatus(): Promise<GpsQueueStatus> {
  const { data } = await api.get("/videos/gps-queue-status");
  return data;
}

export interface UniqueLocations {
  cities: string[];
  countries: string[];
}

export async function getUniqueLocations(): Promise<UniqueLocations> {
  const { data } = await api.get("/videos/locations");
  return data;
}

export async function updatePairLocation(
  id: string,
  location: {
    startCity?: string;
    startCountry?: string;
    endCity?: string;
    endCountry?: string;
  },
): Promise<VideoPair> {
  const { data } = await api.patch(`/videos/${id}/location`, location);
  return data;
}

export async function updatePairOverlayMetadata(
  id: string,
  metadata: { cameraType: string; licensePlate: string },
): Promise<VideoPair> {
  const { data } = await api.patch(`/videos/${id}/overlay-metadata`, metadata);
  return data;
}

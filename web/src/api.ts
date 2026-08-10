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

export async function storeRecordedGpx(
  id: string,
  gpxXml: string,
): Promise<{ success: boolean; message: string; filePath: string }> {
  const { data } = await api.post(`/videos/${id}/gps/gpx`, { gpxXml });
  return data;
}

export async function fetchPairs(): Promise<VideoPair[]> {
  const { data } = await api.get("/videos");
  return data;
}

export async function fetchPair(id: string): Promise<VideoPair | null> {
  const { data } = await api.get(`/videos/${id}`);
  return data;
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
): Promise<{
  success: boolean;
  message: string;
  filename: string;
  downloadUrl: string;
}> {
  const { data } = await api.post(`/videos/${pairId}/clip`, {
    startTime,
    endTime,
    channels,
    audioVolume,
  });
  return data;
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

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data } = await api.get("/auth/me");
    return data.user;
  } catch {
    // Not authenticated
    return null;
  }
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

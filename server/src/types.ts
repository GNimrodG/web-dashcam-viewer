export type Channel = "front" | "rear";

export interface VideoFile {
  path: string;
  filename: string;
  size: number;
  mtimeMs?: number; // file modification time for cache validation
  createdAt?: string; // ISO
  durationSec?: number;
  location?: {
    lat: number;
    lon: number;
    alt?: number;
  };
  channel?: Channel;
  important?: boolean; // user-marked important
  noGps?: boolean; // true if we know there's no GPS data at all
}

export interface VideoPair {
  id: string; // derived from timestamp key in filename
  startTime?: string; // ISO
  durationSec?: number; // max of channels
  channels: Partial<Record<Channel, VideoFile>>;
  startLocationName?: string; // human-readable start (reverse geocoded)
  endLocationName?: string; // human-readable end (reverse geocoded)
  startCountry?: string;
  startState?: string;
  startCity?: string;
  endCountry?: string;
  endState?: string;
  endCity?: string;
  poiCount?: number;
  dashcamTimeZone?: string;
}

export interface GpsPoint {
  tsSec: number; // seconds from start
  lat: number;
  lon: number;
  alt?: number;
  speedKph?: number;
}

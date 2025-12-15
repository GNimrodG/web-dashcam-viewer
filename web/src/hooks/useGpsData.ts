import { useEffect, useState } from "react";
import { fetchGps, GPSData } from "../api";

export interface UseGpsDataResult {
  gps: GPSData | null;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

export function useGpsData(pairId: string | null): UseGpsDataResult {
  const [gps, setGps] = useState<GPSData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    if (!pairId) {
      setGps(null);
      setLoading(false);
      setError(null);

      return;
    }

    setLoading(true);
    setError(null);

    fetchGps(pairId, abortController.signal)
      .then((data) => {
        if (!abortController.signal.aborted) {
          setGps(data);

          // Dispatch custom event that Sidebar can listen to
          globalThis.dispatchEvent(
            new CustomEvent("gps-data-updated", { detail: { pairId } }),
          );
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setGps(null);
          setError(e);
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [pairId, refreshToken]);

  const refresh = () => setRefreshToken((x) => x + 1);

  return { gps, loading, error, refresh };
}

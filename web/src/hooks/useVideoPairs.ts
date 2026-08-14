import { useCallback, useEffect, useState } from "react";
import { fetchPairs, type VideoPair } from "../api";

export interface UseVideoPairsResult {
  pairs: VideoPair[];
  loading: boolean;
  error: unknown;
  refresh: () => void;
  updatePair: (updatedPair: VideoPair) => void;
}

export function useVideoPairs(): UseVideoPairsResult {
  const [pairs, setPairs] = useState<VideoPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((x) => x + 1), []);

  const updatePair = useCallback((updatedPair: VideoPair) => {
    setPairs((currentPairs) =>
      currentPairs.map((pair) =>
        pair.id === updatedPair.id ? updatedPair : pair,
      ),
    );
  }, []);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);

    fetchPairs()
      .then((data) => {
        if (!canceled) setPairs(data);
      })
      .catch((e) => {
        if (!canceled) setError(e);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (
      !pairs.some(
        (pair) =>
          pair.overlayMetadataStatus === "pending" ||
          pair.audioStatus === "pending",
      )
    )
      return;
    let canceled = false;
    const timer = globalThis.setTimeout(() => {
      fetchPairs()
        .then((data) => {
          if (!canceled) setPairs(data);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      canceled = true;
      globalThis.clearTimeout(timer);
    };
  }, [pairs]);

  return { pairs, loading, error, refresh, updatePair };
}

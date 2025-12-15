import { useCallback, useEffect, useState } from "react";
import { type VideoPair } from "../api";
import axios from "axios";

export interface UseVideoPairResult {
  pair: VideoPair | null;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

export function useVideoPair(id: string | null): UseVideoPairResult {
  const [pair, setPair] = useState<VideoPair | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((x) => x + 1), []);

  useEffect(() => {
    if (!id) {
      setPair(null);
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);

    axios
      .get(`/api/videos/${encodeURIComponent(id)}`, {
        signal: abortController.signal,
      })
      .then((res) => {
        if (!abortController.signal.aborted) setPair(res.data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e);
          setPair(null);
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [id, refreshToken]);

  return { pair, loading, error, refresh };
}

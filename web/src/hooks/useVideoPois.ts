import { useCallback, useEffect, useState } from "react";
import {
  createVideoPoi,
  deleteVideoPoi,
  fetchVideoPois,
  type VideoPoi,
} from "../api";

export function useVideoPois(videoId: string | null) {
  const [pois, setPois] = useState<VideoPoi[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPois([]);
    if (!videoId) return;

    const controller = new AbortController();
    setLoading(true);
    fetchVideoPois(videoId, controller.signal)
      .then((loadedPois) => {
        setPois(loadedPois);
        globalThis.dispatchEvent(
          new CustomEvent("video-pois-updated", { detail: { videoId } }),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("Failed to load video POIs", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [videoId]);

  const addPoi = useCallback(
    async (timeSec: number, label: string) => {
      if (!videoId) throw new Error("No recording selected");
      const poi = await createVideoPoi(videoId, timeSec, label);
      setPois((current) =>
        [...current, poi].sort((a, b) => a.timeSec - b.timeSec),
      );
      globalThis.dispatchEvent(
        new CustomEvent("video-pois-updated", { detail: { videoId } }),
      );
      return poi;
    },
    [videoId],
  );

  const removePoi = useCallback(
    async (poiId: string) => {
      if (!videoId) throw new Error("No recording selected");
      await deleteVideoPoi(videoId, poiId);
      setPois((current) => current.filter((poi) => poi.id !== poiId));
      globalThis.dispatchEvent(
        new CustomEvent("video-pois-updated", { detail: { videoId } }),
      );
    },
    [videoId],
  );

  return { pois, loading, addPoi, removePoi };
}

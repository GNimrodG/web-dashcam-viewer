import { useCallback, useState, useEffect } from "react";
import Box from "@mui/joy/Box";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { VideoPair, fetchPair } from "../api";
import { useNavigate, Outlet, useLocation } from "react-router-dom";

export default function Layout() {
  const [activePair, setActivePair] = useState<VideoPair | null>(null);
  const [pendingSeekRequest, setPendingSeekRequest] = useState<{
    pairId: string;
    timeSec: number;
    requestId: number;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Load pair from URL hash on mount
  useEffect(() => {
    const hash = globalThis.location.hash.slice(1); // Remove # prefix
    if (hash) {
      fetchPair(hash)
        .then((pair) => {
          if (pair) {
            setActivePair(pair);
            if (location.pathname !== "/") {
              navigate("/");
            }
          }
        })
        .catch((err) => {
          console.error("Failed to load pair from hash:", err);
          // Clear invalid hash
          globalThis.history.replaceState(
            null,
            "",
            globalThis.location.pathname,
          );
        });
    }
  }, []);

  const handleSelectPair = (
    pair: VideoPair | null,
    initialTimeSec?: number,
  ) => {
    setActivePair(pair);
    setPendingSeekRequest(
      pair &&
        typeof initialTimeSec === "number" &&
        Number.isFinite(initialTimeSec)
        ? {
            pairId: pair.id,
            timeSec: Math.max(0, initialTimeSec),
            requestId: Date.now(),
          }
        : undefined,
    );

    // Update URL hash
    if (pair) {
      globalThis.location.hash = pair.id;
      if (location.pathname !== "/") {
        navigate("/");
      }
    } else {
      // Clear hash when no pair is selected
      globalThis.history.replaceState(
        null,
        "",
        globalThis.location.pathname + globalThis.location.search,
      );
    }
  };

  const consumePendingSeekRequest = useCallback((requestId: number) => {
    setPendingSeekRequest((currentRequest) =>
      currentRequest?.requestId === requestId ? undefined : currentRequest,
    );
  }, []);

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <Header />
      <Sidebar
        onSelectPair={handleSelectPair}
        selectedPairId={activePair?.id}
      />
      <Outlet
        context={{
          activePair,
          setActivePair,
          selectPair: handleSelectPair,
          pendingSeekRequest,
          consumePendingSeekRequest,
        }}
      />
    </Box>
  );
}

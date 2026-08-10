import { useState, useEffect } from "react";
import Box from "@mui/joy/Box";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { VideoPair, fetchPair } from "../api";
import { useNavigate, Outlet, useLocation } from "react-router-dom";

export default function Layout() {
  const [activePair, setActivePair] = useState<VideoPair | null>(null);
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

  const handleSelectPair = (pair: VideoPair | null) => {
    setActivePair(pair);

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
        }}
      />
    </Box>
  );
}

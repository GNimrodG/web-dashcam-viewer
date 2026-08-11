import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import MapView from "../components/MapView";
import { Player } from "../components/Player";
import Box from "@mui/joy/Box";
import { VideoPair } from "../api";
import { useVideoPois } from "../hooks/useVideoPois";

interface OutletContext {
  activePair: VideoPair | null;
  setActivePair: (pair: VideoPair | null) => void;
}

export default function MainPage() {
  const { activePair } = useOutletContext<OutletContext>();
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [seekRequest, setSeekRequest] = useState<{
    timeSec: number;
    requestId: number;
  }>();
  const {
    pois,
    loading: poisLoading,
    addPoi,
    removePoi,
  } = useVideoPois(activePair?.id || null);

  useEffect(() => {
    setCurrentTimeSec(0);
    setSeekRequest(undefined);
  }, [activePair?.id]);

  const handleMapSeek = useCallback((timeSec: number) => {
    setCurrentTimeSec(timeSec);
    setSeekRequest({ timeSec, requestId: Date.now() });
  }, []);

  return (
    <Box
      component="main"
      className="MainContent"
      sx={{
        px: { xs: 2, md: 6 },
        pt: {
          xs: "calc(12px + var(--Header-height))",
          sm: "calc(12px + var(--Header-height))",
          md: 3,
        },
        pb: { xs: 2, sm: 2, md: 3 },
        flex: 1,
        display: "grid",
        gridTemplateRows: "1fr 1fr",
        minWidth: 0,
        height: "100dvh",
        gap: 1,
      }}>
      <Player
        pair={activePair}
        onTimeUpdate={setCurrentTimeSec}
        seekRequest={seekRequest}
        pois={pois}
        poisLoading={poisLoading}
        onCreatePoi={addPoi}
        onDeletePoi={removePoi}
      />
      <MapView
        pair={activePair}
        currentTimeSec={currentTimeSec}
        onSeek={handleMapSeek}
        pois={pois}
      />
    </Box>
  );
}

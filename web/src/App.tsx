import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssVarsProvider } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import Box from "@mui/joy/Box";
import CircularProgress from "@mui/joy/CircularProgress";
import { getAuthStatus, loginUrl } from "./api";
import Layout from "./components/Layout";
import MainPage from "./pages/MainPage";
import SharePage from "./pages/SharePage";
import ClipsPage from "./pages/ClipsPage";
import RecordingsMapPage from "./pages/RecordingsMapPage";

export default function App() {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const isPublicShare = globalThis.location.pathname.startsWith("/share/");

  useEffect(() => {
    getAuthStatus()
      .then(({ user, authEnabled }) => {
        if (!authEnabled || user) {
          setIsAuthenticated(true);
          setIsCheckingAuth(false);
        } else if (isPublicShare) {
          setIsCheckingAuth(false);
        } else {
          // Not authenticated, redirect to login
          globalThis.location.href = loginUrl();
        }
      })
      .catch(() => {
        if (isPublicShare) {
          setIsCheckingAuth(false);
        } else {
          globalThis.location.href = loginUrl();
        }
      });
  }, [isPublicShare]);

  if (isCheckingAuth) {
    return (
      <CssVarsProvider>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
          }}>
          <CircularProgress />
        </Box>
      </CssVarsProvider>
    );
  }

  return (
    <CssVarsProvider>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<MainPage />} />
            <Route
              path="/recordings-map"
              element={isAuthenticated ? <RecordingsMapPage /> : null}
            />
            <Route
              path="/clips"
              element={isAuthenticated ? <ClipsPage /> : null}
            />
          </Route>
          <Route path="/share/:tokenId" element={<SharePage />} />
        </Routes>
      </BrowserRouter>
    </CssVarsProvider>
  );
}

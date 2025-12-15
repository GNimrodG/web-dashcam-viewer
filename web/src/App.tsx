import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CssVarsProvider } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import Box from "@mui/joy/Box";
import CircularProgress from "@mui/joy/CircularProgress";
import { getCurrentUser, loginUrl } from "./api";
import Layout from "./components/Layout";
import MainPage from "./pages/MainPage";
import SharePage from "./pages/SharePage";
import ClipsPage from "./pages/ClipsPage";

export default function App() {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        if (user) {
          setIsAuthenticated(true);
          setIsCheckingAuth(false);
        } else {
          // Not authenticated, redirect to login
          globalThis.location.href = loginUrl();
        }
      })
      .catch(() => {
        // Auth check failed, redirect to login
        globalThis.location.href = loginUrl();
      });
  }, []);

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
            <Route
              path="/"
              element={
                isAuthenticated ? <MainPage /> : <Navigate to="/share" />
              }
            />
            <Route path="/clips" element={<ClipsPage />} />
          </Route>
          <Route path="/share/:tokenId" element={<SharePage />} />
        </Routes>
      </BrowserRouter>
    </CssVarsProvider>
  );
}

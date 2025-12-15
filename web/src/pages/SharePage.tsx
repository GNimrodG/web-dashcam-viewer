import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CssVarsProvider } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import Button from "@mui/joy/Button";
import CircularProgress from "@mui/joy/CircularProgress";
import Alert from "@mui/joy/Alert";
import DownloadIcon from "@mui/icons-material/Download";
import { getShareToken } from "../api";

interface ShareToken {
  id: string;
  videoId: string;
  clipStartTime: number;
  clipEndTime: number;
  clipChannels: string;
  createdAt: number;
  expiresAt: number | null;
  createdBy: string | null;
  downloadUrl: string;
  filename: string;
}

export default function SharePage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [token, setToken] = useState<ShareToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId) return;

    getShareToken(tokenId)
      .then((data) => {
        setToken({
          id: tokenId,
          videoId: data.videoId,
          clipStartTime: data.clipStartTime,
          clipEndTime: data.clipEndTime,
          clipChannels: data.clipChannels,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt,
          createdBy: null,
          downloadUrl: data.downloadUrl,
          filename: data.filename,
        });
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load share token:", err);
        setError(
          err.response?.data?.error ||
            err.message ||
            "Failed to load share link",
        );
        setLoading(false);
      });
  }, [tokenId]);

  const handleDownload = () => {
    if (!token?.downloadUrl) return;
    globalThis.location.href = token.downloadUrl;
  };

  if (loading) {
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

  if (error || !token) {
    return (
      <CssVarsProvider>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            p: 2,
          }}>
          <Alert color="danger">{error || "Share link not found"}</Alert>
        </Box>
      </CssVarsProvider>
    );
  }

  const duration = token.clipEndTime - token.clipStartTime;
  const expiresDate = token.expiresAt
    ? new Date(token.expiresAt).toLocaleString()
    : "Never";

  return (
    <CssVarsProvider>
      <CssBaseline />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          p: 4,
          gap: 3,
        }}>
        <Typography level="h2">Shared Dashcam Clip</Typography>

        <Box
          sx={{
            maxWidth: 500,
            width: "100%",
            gap: 2,
            display: "flex",
            flexDirection: "column",
          }}>
          <Box>
            <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
              Video ID
            </Typography>
            <Typography>{token.videoId}</Typography>
          </Box>

          <Box>
            <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
              Duration
            </Typography>
            <Typography>{duration.toFixed(1)}s</Typography>
          </Box>

          <Box>
            <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
              Channels
            </Typography>
            <Typography>{token.clipChannels}</Typography>
          </Box>

          <Box>
            <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
              Expires
            </Typography>
            <Typography>{expiresDate}</Typography>
          </Box>
        </Box>

        <Button
          size="lg"
          startDecorator={<DownloadIcon />}
          onClick={handleDownload}>
          Download Clip
        </Button>
      </Box>
    </CssVarsProvider>
  );
}

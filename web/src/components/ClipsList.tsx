import { useEffect, useState } from "react";
import Box from "@mui/joy/Box";
import List from "@mui/joy/List";
import ListItem from "@mui/joy/ListItem";
import ListItemContent from "@mui/joy/ListItemContent";
import IconButton from "@mui/joy/IconButton";
import Typography from "@mui/joy/Typography";
import ShareIcon from "@mui/icons-material/Share";
import DownloadIcon from "@mui/icons-material/Download";
import CircularProgress from "@mui/joy/CircularProgress";
import Alert from "@mui/joy/Alert";
import axios from "axios";
import { createClipShareToken } from "../api";

interface Clip {
  filename: string;
  url: string;
}

export default function ClipsList() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharingClip, setSharingClip] = useState<string | null>(null);

  useEffect(() => {
    loadClips();
  }, []);

  const loadClips = async () => {
    try {
      // Get list of clips from the server
      const { data } = await axios.get<{ clips: Clip[] }>("/api/videos/clips");
      setClips(data.clips);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load clips:", err);
      setError("Failed to load clips");
      setLoading(false);
    }
  };

  const handleShare = async (filename: string) => {
    setSharingClip(filename);
    try {
      const { shareUrl } = await createClipShareToken(filename);
      await navigator.clipboard.writeText(shareUrl);
      alert("Public share link copied to clipboard! It expires in 7 days.");
    } catch (err) {
      console.error("Failed to share clip:", err);
      alert("Failed to copy URL");
    } finally {
      setSharingClip(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
        <CircularProgress size="sm" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert color="danger" size="sm">
          {error}
        </Alert>
      </Box>
    );
  }

  if (clips.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
          No clips created yet
        </Typography>
      </Box>
    );
  }

  return (
    <List size="sm" sx={{ maxHeight: 300, overflow: "auto" }}>
      {clips.map((clip) => (
        <ListItem
          key={clip.filename}
          endAction={
            <Box sx={{ display: "flex", gap: 0.5 }}>
              <IconButton
                size="sm"
                variant="plain"
                component="a"
                href={clip.url}
                download
                title="Download">
                <DownloadIcon />
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                loading={sharingClip === clip.filename}
                onClick={() => handleShare(clip.filename)}
                title="Copy share link">
                <ShareIcon />
              </IconButton>
            </Box>
          }>
          <ListItemContent>
            <Typography level="body-sm" noWrap>
              {clip.filename}
            </Typography>
          </ListItemContent>
        </ListItem>
      ))}
    </List>
  );
}

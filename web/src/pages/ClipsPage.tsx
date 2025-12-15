import { useEffect, useState } from "react";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import IconButton from "@mui/joy/IconButton";
import Chip from "@mui/joy/Chip";
import ShareIcon from "@mui/icons-material/Share";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import FourKIcon from "@mui/icons-material/FourK";
import HdIcon from "@mui/icons-material/Hd";
import SdIcon from "@mui/icons-material/Sd";
import CircularProgress from "@mui/joy/CircularProgress";
import Alert from "@mui/joy/Alert";
import Card from "@mui/joy/Card";
import CardContent from "@mui/joy/CardContent";
import CardOverflow from "@mui/joy/CardOverflow";
import AspectRatio from "@mui/joy/AspectRatio";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import DialogTitle from "@mui/joy/DialogTitle";
import DialogContent from "@mui/joy/DialogContent";
import DialogActions from "@mui/joy/DialogActions";
import Button from "@mui/joy/Button";
import Input from "@mui/joy/Input";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import FormHelperText from "@mui/joy/FormHelperText";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import axios from "axios";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getResolutionBadge(
  width?: number,
  height?: number,
): {
  icon?: React.ReactElement;
  label?: string;
  color: "success" | "primary" | "warning" | "neutral";
} | null {
  if (!width || !height) return null;

  // 4K (3840×2160 or 4096×2160)
  if (height >= 2100) {
    return { icon: <FourKIcon />, color: "success" };
  }
  // 2K (2560×1440)
  if (height >= 1400 && height < 2100) {
    return { label: "2K", color: "primary" };
  }
  // 1080p (1920×1080)
  if (height >= 1070 && height < 1100) {
    return { icon: <HdIcon />, color: "primary" };
  }
  // 720p (1280×720)
  if (height >= 710 && height < 730) {
    return { icon: <SdIcon />, color: "warning" };
  }
  // Other resolutions - show dimensions
  return { label: `${width}×${height}`, color: "neutral" };
}

interface Clip {
  filename: string;
  url: string;
  thumbnailUrl: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharingClip, setSharingClip] = useState<string | null>(null);
  const [deletingClip, setDeletingClip] = useState<string | null>(null);
  const [clipToDelete, setClipToDelete] = useState<string | null>(null);
  const [renamingClip, setRenamingClip] = useState<string | null>(null);
  const [clipToRename, setClipToRename] = useState<string | null>(null);
  const [newClipName, setNewClipName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    loadClips();
  }, []);

  const loadClips = async () => {
    try {
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
      const url = `${globalThis.location.origin}/api/videos/clips/${filename}`;
      await navigator.clipboard.writeText(url);
      alert("Clip URL copied to clipboard!");
    } catch (err) {
      console.error("Failed to share clip:", err);
      alert("Failed to copy URL");
    } finally {
      setSharingClip(null);
    }
  };

  const handleDeleteClick = (filename: string) => {
    setClipToDelete(filename);
  };

  const handleDeleteConfirm = async () => {
    if (!clipToDelete) return;

    setDeletingClip(clipToDelete);
    try {
      await axios.delete(`/api/videos/clips/${clipToDelete}`);
      setClips(clips.filter((c) => c.filename !== clipToDelete));
      setClipToDelete(null);
    } catch (err) {
      console.error("Failed to delete clip:", err);
      alert("Failed to delete clip");
    } finally {
      setDeletingClip(null);
    }
  };

  const handleDeleteCancel = () => {
    setClipToDelete(null);
  };

  const handleRenameClick = (filename: string) => {
    setClipToRename(filename);
    setNewClipName(filename.replace(/\.mp4$/, ""));
    setRenameError(null);
  };

  const handleRenameConfirm = async () => {
    if (!clipToRename || !newClipName.trim()) return;

    // Add .mp4 extension if not present
    const finalName = newClipName.trim().endsWith(".mp4")
      ? newClipName.trim()
      : `${newClipName.trim()}.mp4`;

    // Validate filename
    if (finalName.includes("/") || finalName.includes("\\")) {
      setRenameError("Filename cannot contain / or \\");
      return;
    }

    if (finalName === clipToRename) {
      setClipToRename(null);
      return;
    }

    setRenamingClip(clipToRename);
    setRenameError(null);

    try {
      await axios.patch(`/api/videos/clips/${clipToRename}`, {
        newFilename: finalName,
      });

      // Update clips list
      setClips(
        clips.map((c) =>
          c.filename === clipToRename
            ? {
                ...c,
                filename: finalName,
                url: `/api/videos/clips/${finalName}`,
                thumbnailUrl: `/api/videos/clips/${finalName}/thumbnail`,
              }
            : c,
        ),
      );
      setClipToRename(null);
      setNewClipName("");
    } catch (err: any) {
      console.error("Failed to rename clip:", err);
      const errorMsg = err.response?.data?.error || "Failed to rename clip";
      setRenameError(errorMsg);
    } finally {
      setRenamingClip(null);
    }
  };

  const handleRenameCancel = () => {
    setClipToRename(null);
    setNewClipName("");
    setRenameError(null);
  };

  if (loading) {
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
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}>
        <CircularProgress size="lg" />
      </Box>
    );
  }

  if (error) {
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
        }}>
        <Alert color="danger">{error}</Alert>
      </Box>
    );
  }

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
        overflow: "auto",
      }}>
      <Typography level="h2" sx={{ mb: 3 }}>
        Video Clips
      </Typography>

      {clips.length === 0 ? (
        <Alert color="neutral">
          No clips created yet. Create clips from the video player.
        </Alert>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            gap: 2,
          }}>
          {clips.map((clip) => (
            <Card key={clip.filename} variant="outlined">
              <CardOverflow>
                <AspectRatio ratio="16/9">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={clip.url}
                    controls
                    preload="metadata"
                    poster={clip.thumbnailUrl}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      backgroundColor: "#000",
                    }}
                  />
                </AspectRatio>
              </CardOverflow>
              <CardContent>
                <Typography level="title-sm" noWrap title={clip.filename}>
                  {clip.filename}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    mt: 0.5,
                  }}>
                  <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
                    {formatFileSize(clip.size)}
                    {clip.duration && ` • ${formatDuration(clip.duration)}`}
                  </Typography>
                  {getResolutionBadge(clip.width, clip.height) &&
                    (getResolutionBadge(clip.width, clip.height)!.icon ? (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          "& svg": {
                            color:
                              getResolutionBadge(clip.width, clip.height)!
                                .color === "success"
                                ? "success.500"
                                : getResolutionBadge(clip.width, clip.height)!
                                      .color === "primary"
                                  ? "primary.500"
                                  : getResolutionBadge(clip.width, clip.height)!
                                        .color === "warning"
                                    ? "warning.500"
                                    : "neutral.500",
                          },
                        }}>
                        {getResolutionBadge(clip.width, clip.height)!.icon}
                      </Box>
                    ) : (
                      <Chip
                        size="sm"
                        variant="soft"
                        color={
                          getResolutionBadge(clip.width, clip.height)!.color
                        }
                        sx={{
                          fontSize: "0.625rem",
                          minHeight: "18px",
                          py: 0,
                          px: 0.5,
                        }}>
                        {getResolutionBadge(clip.width, clip.height)!.label}
                      </Chip>
                    ))}
                </Box>
                <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="primary"
                    component="a"
                    href={clip.url}
                    download
                    sx={{ flex: 1, minWidth: 100, textDecoration: "none" }}
                    title="Download">
                    <DownloadIcon />
                    <Typography level="body-sm" sx={{ ml: 1 }}>
                      Download
                    </Typography>
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    loading={sharingClip === clip.filename}
                    onClick={() => handleShare(clip.filename)}
                    sx={{ flex: 1, minWidth: 100 }}
                    title="Copy share link">
                    <ShareIcon />
                    <Typography level="body-sm" sx={{ ml: 1 }}>
                      Share
                    </Typography>
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    disabled={renamingClip === clip.filename}
                    onClick={() => handleRenameClick(clip.filename)}
                    sx={{ flex: 1, minWidth: 100 }}
                    title="Rename clip">
                    <EditIcon />
                    <Typography level="body-sm" sx={{ ml: 1 }}>
                      Rename
                    </Typography>
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="danger"
                    disabled={deletingClip === clip.filename}
                    onClick={() => handleDeleteClick(clip.filename)}
                    sx={{ flex: 1, minWidth: 100 }}
                    title="Delete clip">
                    <DeleteIcon />
                    <Typography level="body-sm" sx={{ ml: 1 }}>
                      Delete
                    </Typography>
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Rename Modal */}
      <Modal open={!!clipToRename} onClose={handleRenameCancel}>
        <ModalDialog variant="outlined" role="dialog">
          <DialogTitle>Rename Clip</DialogTitle>
          <DialogContent>
            <FormControl error={!!renameError}>
              <FormLabel>New filename</FormLabel>
              <Input
                autoFocus
                placeholder="Enter new filename"
                value={newClipName}
                onChange={(e) => setNewClipName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameConfirm();
                  if (e.key === "Escape") handleRenameCancel();
                }}
                endDecorator={
                  <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
                    .mp4
                  </Typography>
                }
              />
              {renameError && <FormHelperText>{renameError}</FormHelperText>}
              {!renameError && (
                <FormHelperText>
                  The .mp4 extension will be added automatically if not included
                </FormHelperText>
              )}
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button
              variant="solid"
              color="primary"
              onClick={handleRenameConfirm}
              loading={!!renamingClip}
              disabled={!newClipName.trim()}>
              Rename
            </Button>
            <Button
              variant="plain"
              color="neutral"
              onClick={handleRenameCancel}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!clipToDelete} onClose={handleDeleteCancel}>
        <ModalDialog variant="outlined" role="alertdialog">
          <DialogTitle>
            <WarningRoundedIcon />
            Confirm Delete
          </DialogTitle>
          <DialogContent>
            Are you sure you want to delete this clip?
            <Typography level="body-sm" sx={{ mt: 1, fontWeight: "bold" }}>
              {clipToDelete}
            </Typography>
            <Typography level="body-sm" sx={{ mt: 1, color: "warning.500" }}>
              This action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              variant="solid"
              color="danger"
              onClick={handleDeleteConfirm}
              loading={!!deletingClip}>
              Delete
            </Button>
            <Button
              variant="plain"
              color="neutral"
              onClick={handleDeleteCancel}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

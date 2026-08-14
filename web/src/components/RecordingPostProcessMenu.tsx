import PendingActionsIcon from "@mui/icons-material/PendingActions";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import Box from "@mui/joy/Box";
import Chip from "@mui/joy/Chip";
import CircularProgress from "@mui/joy/CircularProgress";
import Divider from "@mui/joy/Divider";
import Dropdown from "@mui/joy/Dropdown";
import IconButton from "@mui/joy/IconButton";
import ListItemDecorator from "@mui/joy/ListItemDecorator";
import ListSubheader from "@mui/joy/ListSubheader";
import Menu from "@mui/joy/Menu";
import MenuButton from "@mui/joy/MenuButton";
import MenuItem from "@mui/joy/MenuItem";
import Typography from "@mui/joy/Typography";
import moment from "moment";
import { useCallback, useEffect, useState } from "react";
import {
  getRecordingPostProcessStatus,
  retryPostProcessJobs,
  type PostProcessKind,
  type RecordingPostProcessJobs,
} from "../api";
import {
  getPostProcessStatePresentation,
  POST_PROCESS_KINDS,
  POST_PROCESS_LABELS,
} from "../utils/post-process-jobs";

interface RecordingPostProcessMenuProps {
  recordingId: string;
}

export default function RecordingPostProcessMenu({
  recordingId,
}: Readonly<RecordingPostProcessMenuProps>) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RecordingPostProcessJobs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<PostProcessKind | "all" | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      setStatus(await getRecordingPostProcessStatus(recordingId));
      setError(null);
    } catch (refreshError) {
      console.error(
        "Failed to load recording post-processing jobs:",
        refreshError,
      );
      setError("Could not load post-processing jobs.");
    }
  }, [recordingId]);

  useEffect(() => {
    setOpen(false);
    setStatus(null);
    setError(null);
    setRetrying(null);
  }, [recordingId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(interval);
  }, [open, refresh]);

  const retry = async (job: PostProcessKind | "all") => {
    setRetrying(job);
    setError(null);
    try {
      await retryPostProcessJobs(recordingId, job);
      await refresh();
    } catch (retryError) {
      console.error(
        "Failed to retry recording post-processing job:",
        retryError,
      );
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Could not retry post-processing job.",
      );
    } finally {
      setRetrying(null);
    }
  };

  const canRetryAny =
    status && Object.values(status.jobs).some((job) => job.retryable);

  return (
    <Dropdown open={open} onOpenChange={(_, nextOpen) => setOpen(nextOpen)}>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{
          root: {
            "aria-label": "Post-processing jobs for this recording",
            title: "Post-processing jobs",
            size: "sm",
            color: "neutral",
            variant: "outlined",
          },
        }}>
        <PendingActionsIcon />
      </MenuButton>
      <Menu
        placement="bottom-end"
        sx={{ width: 370, maxWidth: "95vw", p: 0.75 }}>
        <ListSubheader
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minHeight: 38,
            pr: 0.5,
          }}>
          <Box sx={{ flex: 1 }}>
            <Typography level="title-sm">Post-processing jobs</Typography>
            <Typography level="body-xs" color="neutral">
              {recordingId}
            </Typography>
          </Box>
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Refresh post-processing jobs"
            onClick={(event) => {
              event.stopPropagation();
              void refresh();
            }}>
            <RefreshIcon />
          </IconButton>
        </ListSubheader>

        {!status && !error && (
          <MenuItem disabled>
            <ListItemDecorator>
              <CircularProgress size="sm" />
            </ListItemDecorator>
            Loading jobs…
          </MenuItem>
        )}
        {error && <MenuItem disabled>{error}</MenuItem>}

        {status &&
          POST_PROCESS_KINDS.map((kind) => {
            const job = status.jobs[kind];
            const presentation = getPostProcessStatePresentation(job.state);
            const busy = retrying !== null;
            return (
              <MenuItem
                key={kind}
                disabled={!job.retryable || busy}
                onClick={() => void retry(kind)}
                sx={{ alignItems: "flex-start", py: 1 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      mb: 0.25,
                    }}>
                    <Typography level="title-sm" sx={{ flex: 1 }}>
                      {POST_PROCESS_LABELS[kind]}
                    </Typography>
                    <Chip size="sm" variant="soft" color={presentation.color}>
                      {presentation.label}
                    </Chip>
                  </Box>
                  <Typography level="body-xs" color="neutral">
                    {job.message}
                    {job.updatedAt
                      ? ` · ${moment(job.updatedAt).fromNow()}`
                      : ""}
                  </Typography>
                </Box>
                {job.retryable && (
                  <ReplayIcon sx={{ ml: 1, mt: 0.25, fontSize: 18 }} />
                )}
              </MenuItem>
            );
          })}

        {status && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              disabled={!canRetryAny || retrying !== null}
              onClick={() => void retry("all")}>
              <ListItemDecorator>
                {retrying === "all" ? (
                  <CircularProgress size="sm" />
                ) : (
                  <ReplayIcon />
                )}
              </ListItemDecorator>
              Run all available jobs
            </MenuItem>
          </>
        )}
      </Menu>
    </Dropdown>
  );
}
